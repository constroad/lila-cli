/**
 * Parseo de argumentos. PURO — sin filesystem, sin red, sin `process`.
 *
 * **Sustantivo y después verbo** (`lila apk publish`, no `lila publish-apk`).
 * No es preferencia de estilo: permite sumar un área nueva —`lila torre deploy`,
 * `lila auth keys`— sin renombrar nada de lo que ya existe.
 *
 * Dos reglas que valen más que la gramática:
 *
 * 1. **Una bandera desconocida falla.** Un `--canall=beta` mal tipeado
 *    publicaría a `stable` sin que nadie se entere.
 * 2. **Una bandera vacía falla.** `--channel=` es un typo, no «el valor por
 *    defecto»: tratarla como ausente esconde el error hasta que algo sale al
 *    canal equivocado.
 */

export const AREAS = ['keystore', 'apk'];
export const CHANNELS = ['stable', 'beta', 'legacy'];
export const VERBOS_KEYSTORE = ['crear', 'respaldar', 'verificar', 'huella'];
export const VERBOS_APK = ['build', 'publish'];
export const FIRMAS = ['release', 'debug'];

/** Las cuatro ABIs. `all` pesa el cuádruple y solo hace falta con teléfonos viejos. */
const TODAS_LAS_ABI = 'armeabi-v7a,arm64-v8a,x86,x86_64';
const ABI_POR_DEFECTO = 'arm64-v8a';

/** Qué banderas admite cada comando. Lo que no está acá, se rechaza. */
const BANDERAS = {
  'keystore:crear': ['clave-generada'],
  'keystore:respaldar': [],
  'keystore:verificar': [],
  'keystore:huella': [],
  'apk:build': ['abi', 'firma', 'salida'],
  'apk:publish': ['channel', 'notes', 'critical', 'seco', 'url'],
  login: ['url'],
  whoami: ['url'],
};

/** Las que son interruptores: `--critical` sin `=algo`. */
const BOOLEANAS = new Set(['critical', 'seco', 'clave-generada']);

const USO = `Uso:
  lila                             menú interactivo
  lila login                       guarda el token de publicación
  lila whoami                      a qué app publica este token y cuándo vence

  lila keystore crear <app>        genera la keystore de producción
  lila keystore respaldar <app>    copia cifrada + verifica que restaure
  lila keystore verificar <app>    confirma que el respaldo sigue sirviendo
  lila keystore huella <app>       la huella sha256, para el alta en la consola

  lila apk build                   compila y firma
  lila apk publish [ruta.apk]      sube a LilaStore; sin ruta busca en dist/`;

const error = (mensaje) => ({ error: `${mensaje}\n\n${USO}`, comando: undefined, opciones: undefined });

/**
 * @param {string[]} argv argumentos después del name del programa
 */
export function parseArgs(argv) {
  const sueltos = argv.filter((a) => !a.startsWith('--'));
  const banderas = new Map();

  for (const arg of argv.filter((a) => a.startsWith('--'))) {
    const [clave, ...partes] = arg.slice(2).split('=');
    const valor = partes.join('=');
    if (!BOOLEANAS.has(clave) && partes.length > 0 && valor === '') {
      return error(`--${clave} está vacía.`);
    }
    banderas.set(clave, partes.length > 0 ? valor : true);
  }

  if (sueltos.length === 0) return { error: undefined, comando: 'menu', opciones: {} };

  const [primero, ...resto] = sueltos;

  if (primero === 'login' || primero === 'whoami') {
    const malas = validarBanderas(primero, banderas);
    if (malas) return error(malas);
    const url = banderas.get('url');
    if (url !== undefined && !esUrl(url)) return error('--url tiene que ser http:// o https://');
    return { error: undefined, comando: primero, opciones: { url: url ?? null } };
  }

  if (!AREAS.includes(primero)) {
    return error(`No existe el área «${primero}». Las que hay: ${AREAS.join(', ')}.`);
  }

  const verbo = resto[0];
  const verbos = primero === 'keystore' ? VERBOS_KEYSTORE : VERBOS_APK;
  if (!verbo || !verbos.includes(verbo)) {
    return error(`«${verbo ?? '(nada)'}» no es un comando de ${primero}. Los que hay: ${verbos.join(', ')}.`);
  }

  const comando = `${primero}:${verbo}`;
  const malas = validarBanderas(comando, banderas);
  if (malas) return error(malas);

  return primero === 'keystore'
    ? keystore(comando, resto[1], banderas)
    : apk(comando, resto[1], banderas);
}

function keystore(comando, app, banderas) {
  // No se adivina desde el directorio actual: una keystore creada con el name
  // equivocado no se puede deshacer sin desinstalar en todos los teléfonos.
  if (!app) return error('Falta el nombre de la app. Ejemplo: lila keystore crear timon');
  return {
    error: undefined,
    comando,
    opciones: { app, claveGenerada: banderas.get('clave-generada') === true },
  };
}

function apk(comando, ruta, banderas) {
  if (comando === 'apk:build') {
    const firma = banderas.get('firma') ?? 'release';
    if (!FIRMAS.includes(firma)) {
      return error(`--firma tiene que ser una de: ${FIRMAS.join(', ')}.`);
    }
    const abiPedida = banderas.get('abi') ?? ABI_POR_DEFECTO;
    return {
      error: undefined,
      comando,
      opciones: {
        firma,
        abi: abiPedida === 'all' ? TODAS_LAS_ABI : abiPedida,
        salida: banderas.get('salida') ?? 'dist',
      },
    };
  }

  const channel = banderas.get('channel') ?? 'stable';
  if (!CHANNELS.includes(channel)) {
    return error(`--channel tiene que ser uno de: ${CHANNELS.join(', ')}.`);
  }
  const url = banderas.get('url');
  if (url !== undefined && !esUrl(url)) return error('--url tiene que ser http:// o https://');

  return {
    error: undefined,
    comando,
    opciones: {
      // `null` y no un default: quién busca en `dist/` es el comando, que sí
      // puede mirar el disco. Este módulo no toca el filesystem.
      apk: ruta ?? null,
      channel,
      notes: banderas.get('notes') ?? null,
      critical: banderas.get('critical') === true,
      seco: banderas.get('seco') === true,
      url: url ?? null,
    },
  };
}

function validarBanderas(comando, banderas) {
  const permitidas = BANDERAS[comando] ?? [];
  for (const clave of banderas.keys()) {
    if (!permitidas.includes(clave)) {
      return permitidas.length === 0
        ? `«${comando.replace(':', ' ')}» no admite banderas, y le pasaste --${clave}.`
        : `--${clave} no existe en «${comando.replace(':', ' ')}». Las que hay: ${permitidas.map((b) => `--${b}`).join(', ')}.`;
    }
  }
  return null;
}

const esUrl = (valor) => typeof valor === 'string' && /^https?:\/\/.+/.test(valor);

export { USO };
