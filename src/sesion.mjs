/**
 * `lila login` y `lila whoami`.
 *
 * `whoami` existe por una razón concreta: **un token vencido tiene que
 * descubrirse antes de una compilación de quince minutos, no después.**
 */
import { rojo, verde, tenue, aviso, preguntarOculto } from './consola.mjs';
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
  console.log(`app    : ${quien.app}${quien.name ? ` (${quien.name})` : ''}`);
  console.log(`repo   : ${quien.repo || '—'}`);
  console.log(`vence  : ${quien.vence}`);
  console.log(`uso    : ${quien.lastUsed ?? 'nunca'}`);

  // El aviso va DESPUÉS de los datos y en amarillo: es lo único accionable de
  // toda la salida, y arriba se pierde entre líneas que nadie lee dos veces.
  if (quien.porVencer) {
    aviso(`Vence en ${quien.diasRestantes} días. Generá otro en /console/tokens.`);
  }
  return 0;
}

/**
 * Pregunta al server a qué app publica este token.
 *
 * **La respuesta la arma el server, no este CLI.** Los días que faltan, si está
 * por vencer y si sigue vigente salen de `GET /api/v1/token`: calcularlos acá
 * sería una segunda implementación de la misma regla, y el día que difieran el
 * `whoami` diría «vigente» sobre algo que el `publish` rechaza.
 */
async function consultar(base, token) {
  try {
    const respuesta = await fetch(`${base}/api/v1/token`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (respuesta.status === 404) {
      // Un server viejo, de antes de que existiera la ruta. Se dice, en vez de
      // inventar un «desconocido» que parece un dato.
      return { ok: false, mensaje: `${base} no expone GET /api/v1/token: está desactualizado.` };
    }
    if (respuesta.status === 401) {
      return { ok: false, mensaje: 'El token no sirve: inválido, revocado o vencido.' };
    }
    if (!respuesta.ok) return { ok: false, mensaje: `El server respondió ${respuesta.status}.` };

    const datos = await respuesta.json();
    if (!datos.vigente) {
      const porque = datos.motivo === 'revocado' ? 'lo revocaron' : 'venció';
      return { ok: false, mensaje: `El token de «${datos.app}» ya no sirve: ${porque}.` };
    }

    return {
      ok: true,
      app: datos.app,
      name: datos.name,
      repo: datos.repo,
      vence: `${fecha(datos.expiresAt)} (en ${datos.diasRestantes} días)`,
      diasRestantes: datos.diasRestantes,
      porVencer: datos.porVencer === true,
      lastUsed: datos.lastUsed ? fecha(datos.lastUsed) : null,
    };
  } catch (fallo) {
    return { ok: false, mensaje: `No se pudo contactar a ${base}: ${fallo.message}` };
  }
}

/** Una fecha que se lee, no un ISO con milisegundos. */
const fecha = (iso) =>
  new Date(iso).toLocaleDateString('es-PE', { year: 'numeric', month: 'short', day: 'numeric' });
