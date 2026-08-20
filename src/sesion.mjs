/**
 * `lila login` y `lila whoami`.
 *
 * `whoami` existe por una razón concreta: **un token vencido tiene que
 * descubrirse antes de una compilación de quince minutos, no después.**
 */
import { rojo, verde, tenue, aviso, preguntarOculto } from './consola.mjs';
import { guardarToken, tokenActual, URL_POR_DEFECTO } from './credenciales.mjs';
import { avisarSiHayVersionNueva } from './actualizacion.mjs';


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

  // **Se guarda bajo la app que dijo el SERVER**, no bajo el directorio en el
  // que estás parado. Es la única fuente que no puede equivocarse: el token
  // lleva su app adentro, y guardarlo con otro nombre —porque hiciste login
  // desde la carpeta equivocada— produciría exactamente el fallo que este
  // cambio vino a arreglar.
  const archivo = guardarToken(token.trim(), base, quien.app);
  verde(`Guardado en ${archivo} para «${quien.app}»`);
  return imprimirQuien(quien);
}

export async function whoami(opciones) {
  const { token, origen, url, motivo, aviso: avisoToken } = tokenActual();
  if (!token) return rojo(motivo);
  const base = opciones.url ?? url ?? URL_POR_DEFECTO;
  tenue(`token de ${origen}`);
  if (avisoToken) aviso(avisoToken);

  const quien = await consultar(base, token);
  if (!quien.ok) return rojo(quien.mensaje);
  imprimirQuien(quien);
  await avisarSiHayVersionNueva();
  return 0;
}

function imprimirQuien(quien) {
  console.log(`app    : ${quien.app}${quien.name ? ` (${quien.name})` : ''}`);
  // El identificador público, para poder cruzarlo con la lista de
  // /console/tokens. Es la mitad que no es secreta —viaja en cada publicación—
  // y sin ella, con varios tokens vivos de la misma app, no hay forma de saber
  // cuál tenés cargado ni cuál se puede revocar sin romper nada.
  if (quien.publicId) console.log(`token  : lsp_${quien.publicId}…`);
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
      // Puede faltar contra una LilaStore anterior al 19/08/2026: se imprime solo
      // si vino, en vez de mostrar «lsp_undefined…».
      publicId: datos.publicId ?? null,
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
