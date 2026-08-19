/**
 * Subir un APK a LilaStore.
 *
 * **No manda la versión, el versionCode ni el paquete.** El server los lee del
 * `AndroidManifest.xml` del propio binario, que es lo único que no miente: antes
 * se podía publicar un APK que dice 10 declarando 11, y el teléfono quedaba
 * pidiendo actualizar para siempre.
 *
 * Lo único que sí se declara es el `sha256`, y se calcula ANTES de cruzar la
 * red: es lo que detecta una subida truncada.
 */
import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { rojo, verde, tenue, mb } from './consola.mjs';
import { tokenActual, URL_POR_DEFECTO } from './credenciales.mjs';

/** Sin ruta, el APK más nuevo de `dist/`. Es lo que acaba de compilar `apk build`. */
function buscarEnDist(carpeta = 'dist') {
  let apks;
  try {
    apks = readdirSync(carpeta, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.apk'))
      .map((e) => join(carpeta, e.name));
  } catch {
    return null;
  }
  if (apks.length === 0) return null;
  // Por versionCode al final del nombre y no por fecha: `timon-0.4.0-11.apk`
  // recompilado ayer sigue siendo posterior a la 10.
  const codigo = (ruta) => Number(/-(\d+)\.apk$/.exec(ruta)?.[1] ?? 0);
  return apks.sort((a, b) => codigo(b) - codigo(a))[0];
}

export async function publish(opciones) {
  const { token, origen } = tokenActual();
  if (!token) {
    rojo('No hay token de publicación.');
    console.error('  Corré «lila login», o exportá LILASTORE_TOKEN.');
    console.error('  Se crea en /console/tokens, y se muestra una sola vez.');
    return 1;
  }

  const ruta = opciones.apk ?? buscarEnDist();
  if (!ruta) return rojo('No pasaste un APK y no encontré ninguno en dist/.');

  let bytes;
  try {
    bytes = await readFile(ruta);
  } catch {
    return rojo(`No pude leer ${ruta}`);
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  let notes = '';
  if (opciones.notes) {
    try {
      notes = await readFile(opciones.notes, 'utf8');
    } catch {
      return rojo(`No pude leer las notas en ${opciones.notes}`);
    }
  }

  const base = opciones.url ?? URL_POR_DEFECTO;
  console.log('lila apk publish');
  console.log(`  archivo : ${basename(ruta)} (${mb(bytes.length)})`);
  console.log(`  channel : ${opciones.channel}`);
  console.log(`  sha256  : ${sha256.slice(0, 16)}…`);
  console.log(`  destino : ${base}`);
  tenue(`  token   : ${origen}`);

  const metadata = {
    sha256,
    channel: opciones.channel,
    notes,
    critical: opciones.critical,
    // Trazabilidad: queda en la release y permite ver QUÉ corrida produjo un
    // binario que nadie reconoce.
    commitSha: process.env.GITHUB_SHA ?? null,
    runUrl:
      process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : null,
  };

  if (opciones.seco) {
    console.log(`\n(--seco) No se subió nada.\n${JSON.stringify(metadata, null, 2)}`);
    return 0;
  }

  const cuerpo = new FormData();
  cuerpo.append('apk', new Blob([bytes]), basename(ruta));
  cuerpo.append('metadata', JSON.stringify(metadata));

  let respuesta;
  try {
    respuesta = await fetch(`${base}/api/v1/releases`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: cuerpo,
    });
  } catch (fallo) {
    return rojo(`No se pudo contactar a ${base}: ${fallo.message}`);
  }

  const datos = await respuesta.json().catch(() => ({}));
  if (respuesta.status !== 201) {
    // El motivo EXACTO del server. Las validaciones existen para que quien
    // publica sepa qué arreglar sin abrir un log.
    return rojo(`${respuesta.status} ${datos.codigo ?? ''} — ${datos.error ?? 'sin detalle'}`);
  }

  // La versión que se imprime es la que LEYÓ el server del binario, no la que
  // alguien creyó estar subiendo. Es la confirmación de que son la misma cosa.
  return verde(`Publicada ${datos.version} (${datos.versionCode}) · ${base}${datos.descarga}`);
}
