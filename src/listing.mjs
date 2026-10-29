/**
 * Upload the texts of an app's listing (summary and description) to LilaStore with the publish
 * token, like `app icon` and `app screenshots`: the text lives in the app repo
 * (`store/listing.json`) and ships with each release. The server validates the lengths; this
 * only refuses a file that could erase the text (a missing field).
 *
 *   PUT /api/v1/apps/<slug>/listing  {summary, description}  (lilastore specs/API.spec.md)
 */
import { readFile } from 'node:fs/promises';
import { rojo, verde, tenue } from './consola.mjs';
import { tokenActual, URL_POR_DEFECTO } from './credenciales.mjs';
import { avisarSiHayVersionNueva } from './actualizacion.mjs';

const FIELDS = ['summary', 'description'];

/** The request body from the file text, or why it cannot be sent. */
export function listingBody(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'El archivo no es JSON.' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { error: 'El archivo tiene que ser un objeto {"summary": …, "description": …}.' };
  for (const field of FIELDS) {
    if (typeof parsed[field] !== 'string') return { error: `Falta «${field}» como texto (la descripción puede ser "", pero tiene que estar).` };
  }
  return { body: { summary: parsed.summary, description: parsed.description } };
}

/** What to say when the server refuses: every rejected field on a 422, the code and text otherwise. */
export function listingFailure(status, data) {
  if (status === 422 && data?.errores) {
    return `${status} ${data.codigo ?? ''} — ${Object.entries(data.errores).map(([field, problem]) => `${field}: ${problem}`).join(' · ')}`;
  }
  return `${status} ${data?.codigo ?? ''} — ${data?.error ?? 'sin detalle'}`;
}

export async function uploadListing(slug, path, options = {}) {
  if (!slug || !path) return rojo('Uso: lila app listing <slug> <listing.json>');
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return rojo(`No pude leer ${path}.`);
  }
  const { body, error } = listingBody(raw);
  if (error) return rojo(error);

  const { token, origen, motivo } = tokenActual();
  if (!token) {
    rojo(motivo ?? 'No hay token de publicación.');
    console.error('  Se crea en /console/tokens, y se muestra una sola vez.');
    return 1;
  }
  const base = options.url ?? URL_POR_DEFECTO;
  console.log('lila app listing');
  console.log(`  app     : ${slug}`);
  console.log(`  resumen : ${body.summary.trim().length} caracteres · descripción: ${body.description.trim().length}`);
  console.log(`  destino : ${base}`);
  console.log(`  token   : ${origen}`);

  let response;
  try {
    response = await fetch(`${base}/api/v1/apps/${encodeURIComponent(slug)}/listing`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (failure) {
    return rojo(`No se pudo contactar a ${base}: ${failure.message}`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    rojo(listingFailure(response.status, data));
    await avisarSiHayVersionNueva();
    return 1;
  }
  verde(data.changed ? `Texto de la ficha de «${slug}» actualizado.` : `El texto de «${slug}» ya era ese: no se escribió nada.`);
  tenue('  Se ve en la tienda en hasta un minuto.');
  return 0;
}
