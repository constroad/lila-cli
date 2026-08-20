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
import { existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { rojo, verde, aviso, tenue, mb } from './consola.mjs';
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

/**
 * «Sigue vivo», mientras dura la subida.
 *
 * En una terminal se reescribe la MISMA línea con `\r`. Fuera de una terminal
 * —el log de un runner— se imprime una sola línea y nada más: un contador con
 * `\r` en un log deja cientos de renglones que nadie puede leer.
 */
function latido(bytes) {
  const desde = Date.now();
  if (!process.stdout.isTTY) {
    console.log(`  subiendo ${mb(bytes)}…`);
    return { parar() {} };
  }
  const pintar = () => {
    const seg = Math.round((Date.now() - desde) / 1000);
    process.stdout.write(`\r  subiendo ${mb(bytes)}… ${seg}s`);
  };
  pintar();
  const reloj = setInterval(pintar, 1000);
  // `unref`: este intervalo no puede ser la razón por la que el proceso no
  // termina si algo más falla.
  reloj.unref?.();
  return {
    parar() {
      clearInterval(reloj);
      // Se borra la línea entera: dejar «subiendo… 47s» arriba del resultado se
      // lee como si todavía estuviera subiendo.
      process.stdout.write(`\r${' '.repeat(40)}\r`);
    },
  };
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
  if (!ruta) {
    // **Dos fallos distintos con la misma cara.** «No encontré ninguno en dist/»
    // suena a «compilá primero» aunque estés parado en ~/Downloads, y ahí no hay
    // nada que compilar. Se distingue mirando si esto es siquiera el repo de una
    // app: es el mismo `app.json` que exige `apk build`.
    if (!existsSync('app.json')) {
      rojo('Esta carpeta no es el repo de una app: no hay app.json.');
      console.error(`  Estás en ${process.cwd()}`);
      console.error('  Entrá al repo de la app y corré «lila apk build», o pasá la ruta del APK.');
      return 1;
    }
    rojo('No hay ningún APK en dist/.');
    console.error('  Compilalo primero con «lila apk build», o pasá la ruta a mano.');
    return 1;
  }

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
  if (opciones.enforce) console.log('  enforce : sí — los teléfonos con menos verán «actualizá»');
  console.log(`  sha256  : ${sha256.slice(0, 16)}…`);
  console.log(`  destino : ${base}`);
  tenue(`  token   : ${origen}`);

  const metadata = {
    sha256,
    channel: opciones.channel,
    notes,
    critical: opciones.critical,
    // Fijar la mínima en ESTA versión, en el mismo acto que la publicación.
    // Reemplaza al `set-timon-min-version.ts` que corría después del build:
    // dos pasos separados dejan el hueco de siempre —APK arriba, mínimo en la
    // anterior— y quien lo sufre es el chofer que no se entera de actualizar.
    obligar: opciones.enforce,
    // Trazabilidad: queda en la release y permite ver QUÉ corrida produjo un
    // binario que nadie reconoce.
    commitSha: process.env.GITHUB_SHA ?? null,
    runUrl:
      process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : null,
  };

  if (opciones.dryRun) {
    console.log(`\n(--dry-run) No se subió nada.\n${JSON.stringify(metadata, null, 2)}`);
    return 0;
  }

  const cuerpo = new FormData();
  cuerpo.append('apk', new Blob([bytes]), basename(ruta));
  cuerpo.append('metadata', JSON.stringify(metadata));

  // **Subir 30 MB por datos móviles son minutos de silencio.** Sin ninguna
  // señal, «tarda» es indistinguible de «se colgó», y quien lo mira corta con
  // Ctrl-C a mitad — que es la única forma de que esto salga mal de verdad.
  //
  // No se inventa un porcentaje: `fetch` no expone bytes enviados y un número
  // que no avanza miente peor que no tener ninguno. Se muestra el tiempo, que es
  // cierto y alcanza para saber que sigue vivo.
  const pulso = latido(bytes.length);
  let respuesta;
  try {
    respuesta = await fetch(`${base}/api/v1/releases`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: cuerpo,
    });
  } catch (fallo) {
    pulso.parar();
    return rojo(`No se pudo contactar a ${base}: ${fallo.message}`);
  }
  pulso.parar();

  const datos = await respuesta.json().catch(() => ({}));
  if (respuesta.status !== 201) {
    // El motivo EXACTO del server. Las validaciones existen para que quien
    // publica sepa qué arreglar sin abrir un log.
    return rojo(`${respuesta.status} ${datos.codigo ?? ''} — ${datos.error ?? 'sin detalle'}`);
  }

  // La versión que se imprime es la que LEYÓ el server del binario, no la que
  // alguien creyó estar subiendo. Es la confirmación de que son la misma cosa.
  verde(`Publicada ${datos.version} (${datos.versionCode}) · ${base}${datos.descarga}`);

  // Se pidió obligar y el server dice que no quedó fijada. **Se avisa fuerte y
  // NO se falla**: el binario está publicado y verificado, y salir con error
  // haría pensar que no se subió nada. Lo que falta es un aviso, y hay que
  // saberlo — si no, la flota se queda en la versión vieja sin que nadie note
  // que el paso se perdió, que es exactamente cómo se rompió con el Drive.
  if (opciones.enforce && datos.obligada !== true) {
    console.error('');
    aviso('Se publicó, pero NO quedó fijada como versión mínima.');
    console.error('  Los teléfonos con una versión anterior no van a ver «actualizá».');
    console.error(`  Fijala a mano en la consola: ${base}/console/apps`);
  }
  return 0;
}
