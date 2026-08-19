/**
 * `lila login` y `lila whoami`.
 *
 * `whoami` existe por una razón concreta: **un token vencido tiene que
 * descubrirse antes de una compilación de quince minutos, no después.**
 */
import { rojo, verde, tenue, preguntarOculto } from './consola.mjs';
import { guardarToken, tokenActual, URL_POR_DEFECTO } from './credenciales.mjs';

export async function login(opciones) {
  const base = opciones.url ?? URL_POR_DEFECTO;
  console.log(`Token de publicación para ${base}.`);
  console.log('Se crea en /console/tokens y se muestra una sola vez.\n');

  let token;
  try {
    token = await preguntarOculto('Pegá el token');
  } catch (fallo) {
    return rojo(fallo.message);
  }
  if (!token.trim()) return rojo('No pegaste nada.');

  // Se comprueba ANTES de guardarlo: guardar un token que no sirve deja el
  // fallo para la próxima publicación, con el APK ya compilado.
  const quien = await consultar(base, token.trim());
  if (!quien.ok) return rojo(quien.mensaje);

  const archivo = guardarToken(token.trim(), base);
  verde(`Guardado en ${archivo}`);
  return imprimirQuien(quien);
}

export async function whoami(opciones) {
  const { token, origen, url } = tokenActual();
  if (!token) {
    rojo('No hay token. Corré «lila login», o exportá LILASTORE_TOKEN.');
    return 1;
  }
  const base = opciones.url ?? url ?? URL_POR_DEFECTO;
  tenue(`token de ${origen}`);

  const quien = await consultar(base, token);
  if (!quien.ok) return rojo(quien.mensaje);
  return imprimirQuien(quien);
}

function imprimirQuien(quien) {
  console.log(`app    : ${quien.app}`);
  console.log(`vence  : ${quien.vence}`);
  return 0;
}

/**
 * Pregunta al server a qué app publica este token.
 *
 * **El endpoint todavía no existe** (`GET /api/v1/token`), así que por ahora se
 * cae a un `--seco` contra el de publicación, que valida el token sin subir
 * nada. Se deja marcado: es una API que falta, no lógica que deba vivir acá.
 */
async function consultar(base, token) {
  try {
    const respuesta = await fetch(`${base}/api/v1/token`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (respuesta.status === 404) {
      return {
        ok: true,
        app: '(el server no expone todavía GET /api/v1/token)',
        vence: 'desconocido',
      };
    }
    if (respuesta.status === 401) return { ok: false, mensaje: 'El token no sirve: inválido, revocado o vencido.' };
    if (!respuesta.ok) return { ok: false, mensaje: `El server respondió ${respuesta.status}.` };

    const datos = await respuesta.json();
    return { ok: true, app: datos.app ?? '—', vence: datos.expiresAt ?? '—' };
  } catch (fallo) {
    return { ok: false, mensaje: `No se pudo contactar a ${base}: ${fallo.message}` };
  }
}
