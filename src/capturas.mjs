/**
 * Subir las capturas de pantalla de una app a LilaStore.
 *
 * Mismo motivo que `app icon`: la consola ya las aceptaba a mano y ninguna app
 * tuvo una sola captura en un mes (16/09/2026). Lo que publica el binario
 * publica también su ficha. Va por el MISMO token de publicación.
 *
 * La tanda REEMPLAZA las capturas de la ficha: la primera va con
 * `?reemplazar=1` y las siguientes se suman, en el orden en que se pasan.
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { rojo, verde, tenue } from './consola.mjs';
import { tokenActual, URL_POR_DEFECTO } from './credenciales.mjs';
import { avisarSiHayVersionNueva } from './actualizacion.mjs';

/** Topes del server. */
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CAPTURAS = 6;

const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FIRMA_JPG = Buffer.from([0xff, 0xd8, 0xff]);

function tipoDe(bytes) {
  if (bytes.subarray(0, 8).equals(FIRMA_PNG)) return 'image/png';
  if (bytes.subarray(0, 3).equals(FIRMA_JPG)) return 'image/jpeg';
  return null;
}

export async function subirCapturas(slug, rutas, opciones = {}) {
  if (!slug) return rojo('Falta el slug de la app: lila app screenshots <slug> <a.png> [b.png …]');
  if (!rutas || rutas.length === 0) return rojo('Faltan los archivos: lila app screenshots <slug> <a.png> [b.png …]');
  if (rutas.length > MAX_CAPTURAS) return rojo(`Son ${rutas.length} capturas; el tope es ${MAX_CAPTURAS}.`);

  const { token, origen, motivo } = tokenActual();
  if (!token) {
    rojo(motivo ?? 'No hay token de publicación.');
    console.error('  Se crea en /console/tokens, y se muestra una sola vez.');
    return 1;
  }

  const archivos = [];
  for (const ruta of rutas) {
    let bytes;
    try {
      bytes = await readFile(ruta);
    } catch {
      return rojo(`No pude leer ${ruta}.`);
    }
    const tipo = tipoDe(bytes);
    if (!tipo) return rojo(`${basename(ruta)} no es PNG ni JPG.`);
    if (bytes.length > MAX_BYTES) {
      return rojo(`${basename(ruta)} pesa ${Math.round(bytes.length / 1024)} KB; el tope es ${MAX_BYTES / 1024} KB.`);
    }
    archivos.push({ ruta, bytes, tipo });
  }

  const base = opciones.url ?? URL_POR_DEFECTO;
  console.log('lila app screenshots');
  console.log(`  app      : ${slug}`);
  console.log(`  capturas : ${archivos.length} (reemplazan las de la ficha)`);
  console.log(`  destino  : ${base}`);
  console.log(`  token    : ${origen}`);

  let ultimas = [];
  for (const [indice, archivo] of archivos.entries()) {
    const reemplazar = indice === 0 ? '?reemplazar=1' : '';
    let respuesta;
    try {
      respuesta = await fetch(`${base}/api/v1/apps/${encodeURIComponent(slug)}/screenshots${reemplazar}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': archivo.tipo },
        body: archivo.bytes,
      });
    } catch (fallo) {
      return rojo(`No se pudo contactar a ${base}: ${fallo.message}`);
    }
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) {
      rojo(`${basename(archivo.ruta)}: ${respuesta.status} ${datos.codigo ?? ''} — ${datos.error ?? 'sin detalle'}`);
      await avisarSiHayVersionNueva();
      return 1;
    }
    ultimas = datos.screenshots ?? ultimas;
    tenue(`  ✓ ${basename(archivo.ruta)} (${Math.round(archivo.bytes.length / 1024)} KB)`);
  }

  verde(`Capturas actualizadas: ${ultimas.length} en la ficha de «${slug}».`);
  tenue('  Se ven en la consola y en el teléfono al abrir la app.');
  return 0;
}
