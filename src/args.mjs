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

export const AREAS = ['keystore', 'apk', 'app'];
export const CHANNELS = ['stable', 'beta', 'legacy'];
export const VERBOS_KEYSTORE = ['create', 'backup', 'verify', 'fingerprint'];
export const VERBOS_APK = ['build', 'publish'];
export const FIRMAS = ['release', 'debug'];

/**
 * Lo que se llamaba en español hasta la 0.4.0.
 *
 * **No es compatibilidad, es un mensaje.** Los nombres viejos NO funcionan; lo
 * que hacen es decir cómo se llaman ahora. Un «no existe ese comando» a secas
 * manda a leer el `--help` para descubrir que lo único que cambió es el idioma,
 * y esos nombres están escritos en specs, en un README y en el historial de la
 * terminal de quien los usó.
 */
const RENOMBRES = {
  crear: 'create',
  respaldar: 'backup',
  verificar: 'verify',
  huella: 'fingerprint',
  obligar: 'enforce',
  seco: 'dry-run',
  firma: 'signing',
  salida: 'out',
  'clave-generada': 'generated-key',
  a: 'to',
};

/** Las cuatro ABIs. `all` pesa el cuádruple y solo hace falta con teléfonos viejos. */
const TODAS_LAS_ABI = 'armeabi-v7a,arm64-v8a,x86,x86_64';
const ABI_POR_DEFECTO = 'arm64-v8a';

/** Qué banderas admite cada comando. Lo que no está acá, se rechaza. */
const BANDERAS = {
  'keystore:create': ['generated-key'],
  // `--to` se puede repetir: cada una es una copia MÁS, fuera de esta máquina.
  'keystore:backup': ['to'],
  'keystore:verify': ['to'],
  'keystore:fingerprint': [],
  'apk:build': ['abi', 'signing', 'out'],
  'apk:publish': ['channel', 'notes', 'critical', 'enforce', 'dry-run', 'url'],
  'app:icon': ['url'],
  login: ['url'],
  whoami: ['url'],
};

/** Las que son interruptores: `--critical` sin `=algo`. */
const BOOLEANAS = new Set(['critical', 'dry-run', 'enforce', 'generated-key']);

const USO = `Uso:
  lila                             menú interactivo
  lila login                       guarda el token de publicación
  lila whoami                      a qué app publica este token y cuándo vence

  lila keystore create <app>       genera la keystore de producción
     --generated-key               la contraseña la genera el CLI y la deja en
                                   gradle.properties; no te pide nada y hace
                                   el respaldo solo. Recomendado.
  lila keystore backup <app>       copia cifrada + verifica que restaure
     --to=/ruta/otra/copia.enc     copia adicional; se puede repetir
  lila keystore verify <app>       confirma que TODAS las copias sirven
  lila keystore fingerprint <app>  la huella sha256, para el alta en la consola

  lila app icon <slug> <a.png>     sube el ícono de la app a la tienda
     --url=https://…               otra instancia de LilaStore

  lila apk build                   compila y firma
     --signing=release|debug       con qué se firma (release por defecto)
     --abi=all                     las 4 arquitecturas; pesa el cuádruple
     --out=dist                    dónde queda el APK
  lila apk publish [ruta.apk]      sube a LilaStore; sin ruta busca en dist/
     --enforce                     la fija además como versión MÍNIMA:
                                   quien tenga menos verá «actualizá»
     --dry-run                     muestra qué se subiría, sin subir nada`;

const error = (mensaje) => ({ error: `${mensaje}\n\n${USO}`, comando: undefined, opciones: undefined });


/**
 * @param {string[]} argv argumentos después del name del programa
 */
export function parseArgs(argv) {
  const sueltos = argv.filter((a) => !a.startsWith('--'));
  const banderas = new Map();
  // `--a` se ACUMULA en vez de pisarse: cada repetición es otra copia del
  // respaldo, y que la última ganara en silencio dejaría al resto sin escribir.
  const repetidas = [];

  for (const arg of argv.filter((a) => a.startsWith('--'))) {
    const [clave, ...partes] = arg.slice(2).split('=');
    const valor = partes.join('=');
    if (!BOOLEANAS.has(clave) && partes.length > 0 && valor === '') {
      return error(`--${clave} está vacía.`);
    }
    if (clave === 'to') repetidas.push(valor);
    // Antes de todo lo demás: una bandera renombrada se explica, no se lista
    // como «no existe» entre otras diez.
    if (RENOMBRES[clave]) {
      return error(`--${clave} ahora se llama --${RENOMBRES[clave]}. El CLI es todo en inglés desde la 0.5.0.`);
    }
    banderas.set(clave, partes.length > 0 ? valor : true);
  }

  // **Antes que nada, y ganando sobre cualquier comando.** Saber qué versión
  // estás corriendo importa MÁS cuando algo falla, y ahí no hay margen para
  // escribir tres palabras. Además el mensaje de «sin argumentos» mandaba a
  // «lila --help», que caía en el mismo menú y volvía a fallar — un CLI que
  // recomienda un comando inexistente gasta el poco crédito que le queda.
  // `-h` y `-v` con un solo guion: el parser solo mira `--`, así que caerían en
  // los argumentos sueltos. Son las dos únicas formas cortas que existen —
  // agregar más sería inventar un dialecto — y son las que todo el mundo tipea
  // por costumbre antes de leer nada.
  const cortas = new Set(argv.filter((a) => a === '-h' || a === '-v'));

  if (banderas.has('version') || cortas.has('-v')) {
    return { error: undefined, comando: 'version', opciones: {} };
  }
  if (banderas.has('help') || cortas.has('-h')) {
    return { error: undefined, comando: 'ayuda', opciones: {} };
  }

  if (sueltos.length === 0) return { error: undefined, comando: 'menu', opciones: {} };

  const [primero, ...resto] = sueltos;

  /**
   * Los comandos sin área. `ayuda` y `version` estaban implementados en
   * `bin/lila.mjs` pero el parser no los dejaba pasar: `lila ayuda` contestaba
   * «No existe el área «ayuda»» —contradiciendo al propio texto de uso que
   * imprime—. Se vio probando el CLI publicado.
   */
  if (primero === 'ayuda' || primero === 'version') {
    return { error: undefined, comando: primero, opciones: {} };
  }

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

  /**
   * `lila app icon <slug> <archivo.png>`.
   *
   * Área propia y no `apk icon`: el ícono es de la APP, no de un binario. Un
   * `apk icon` sugeriría que sale del APK, que es justo lo que NO pasa.
   */
  if (primero === 'app') {
    if (resto[0] !== 'icon') {
      return error(`«${resto[0] ?? '(nada)'}» no es un comando de app. Los que hay: icon.`);
    }
    const malas = validarBanderas('app:icon', banderas);
    if (malas) return error(malas);
    const url = banderas.get('url');
    if (url !== undefined && !esUrl(url)) return error('--url tiene que ser http:// o https://');
    return {
      error: undefined,
      comando: 'app:icon',
      opciones: { app: resto[1], archivo: resto[2], url: url ?? null },
    };
  }

  const verbo = resto[0];
  const verbos = primero === 'keystore' ? VERBOS_KEYSTORE : VERBOS_APK;
  if (verbo && RENOMBRES[verbo]) {
    return error(`«${verbo}» ahora se llama «${RENOMBRES[verbo]}». El CLI es todo en inglés desde la 0.5.0.`);
  }
  if (!verbo || !verbos.includes(verbo)) {
    return error(`«${verbo ?? '(nada)'}» no es un comando de ${primero}. Los que hay: ${verbos.join(', ')}.`);
  }

  const comando = `${primero}:${verbo}`;
  const malas = validarBanderas(comando, banderas);
  if (malas) return error(malas);

  if (repetidas.length > 0) banderas.set('__copias', repetidas);

  return primero === 'keystore'
    ? keystore(comando, resto[1], banderas)
    : apk(comando, resto[1], banderas);
}

function keystore(comando, app, banderas) {
  // No se adivina desde el directorio actual: una keystore creada con el name
  // equivocado no se puede deshacer sin desinstalar en todos los teléfonos.
  if (!app) return error('Falta el nombre de la app. Ejemplo: lila keystore create timon');
  return {
    error: undefined,
    comando,
    opciones: {
      app,
      generatedKey: banderas.get('generated-key') === true,
      copies: banderas.get('__copias') ?? [],
    },
  };
}

function apk(comando, ruta, banderas) {
  if (comando === 'apk:build') {
    const signing = banderas.get('signing') ?? 'release';
    if (!FIRMAS.includes(signing)) {
      return error(`--signing tiene que ser una de: ${FIRMAS.join(', ')}.`);
    }
    const abiPedida = banderas.get('abi') ?? ABI_POR_DEFECTO;
    return {
      error: undefined,
      comando,
      opciones: {
        signing,
        abi: abiPedida === 'all' ? TODAS_LAS_ABI : abiPedida,
        out: banderas.get('out') ?? 'dist',
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
      enforce: banderas.get('enforce') === true,
      dryRun: banderas.get('dry-run') === true,
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
