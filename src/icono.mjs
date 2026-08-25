/**
 * Subir el ícono de una app a LilaStore.
 *
 * Existe porque el ícono era el ÚNICO dato de la ficha que solo se podía cargar
 * a mano desde la consola web, y por eso `lilastore` y `lilachat` estuvieron sin
 * ícono desde que se dieron de alta: nadie se acordó. Un paso manual que hay que
 * recordar, en la práctica, no se hace — y menos desde un runner de CI.
 *
 * Va por el MISMO token que publica las releases, así que quien puede subir el
 * binario puede subir su ícono, y nadie más.
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { rojo, verde, tenue } from './consola.mjs';
import { tokenActual, URL_POR_DEFECTO } from './credenciales.mjs';
import { avisarSiHayVersionNueva } from './actualizacion.mjs';

/** Tope del server. Se comprueba acá para no subir 3 MB y que los rechace. */
const MAX_BYTES = 512 * 1024;

/** Los ocho bytes con los que empieza todo PNG. */
const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export async function subirIcono(slug, ruta, opciones = {}) {
  if (!slug) return rojo('Falta el slug de la app: lila app icon <slug> <archivo.png>');
  if (!ruta) return rojo('Falta el archivo: lila app icon <slug> <archivo.png>');

  // `tokenActual()` devuelve un OBJETO, no la cadena. Tratarlo como cadena
  // manda «Bearer [object Object]» y el server contesta 401 — que se lee como
  // «tu token no sirve» cuando el token está perfecto. Pasó al estrenar este
  // comando.
  const { token, origen, motivo } = tokenActual();
  if (!token) {
    rojo(motivo ?? 'No hay token de publicación.');
    console.error('  Se crea en /console/tokens, y se muestra una sola vez.');
    return 1;
  }

  let bytes;
  try {
    bytes = await readFile(ruta);
  } catch {
    return rojo(`No pude leer ${ruta}.`);
  }

  // Se mira el CONTENIDO, no la extensión: un `.png` que en realidad es un JPG
  // lo rechaza el server con un 422 después de cruzar la red.
  if (!bytes.subarray(0, 8).equals(FIRMA_PNG)) {
    return rojo(`${basename(ruta)} no es un PNG. El ícono tiene que ser PNG.`);
  }
  if (bytes.length > MAX_BYTES) {
    return rojo(
      `${basename(ruta)} pesa ${Math.round(bytes.length / 1024)} KB; el tope es ${MAX_BYTES / 1024} KB.`
    );
  }

  const base = opciones.url ?? URL_POR_DEFECTO;
  console.log('lila app icon');
  console.log(`  app     : ${slug}`);
  console.log(`  archivo : ${basename(ruta)} (${Math.round(bytes.length / 1024)} KB)`);
  console.log(`  destino : ${base}`);
  console.log(`  token   : ${origen}`);

  let respuesta;
  try {
    respuesta = await fetch(`${base}/api/v1/apps/${encodeURIComponent(slug)}/icon`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png' },
      body: bytes,
    });
  } catch (fallo) {
    return rojo(`No se pudo contactar a ${base}: ${fallo.message}`);
  }

  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    rojo(`${respuesta.status} ${datos.codigo ?? ''} — ${datos.error ?? 'sin detalle'}`);
    await avisarSiHayVersionNueva();
    return 1;
  }

  verde(`Ícono actualizado · ${base}${datos.iconUrl}`);
  tenue('  Se ve en la consola y en el catálogo del teléfono al próximo refresco.');
  return 0;
}
