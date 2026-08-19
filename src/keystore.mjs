/**
 * Keystores de release: crear, respaldar y —sobre todo— VERIFICAR el respaldo.
 *
 * **Perder la keystore obliga a desinstalar y reinstalar la app en CADA
 * teléfono**: Android no deja actualizar una app instalada con una firma
 * distinta. Es la credencial más irreemplazable del proyecto.
 *
 * **Un respaldo que nadie probó no es un respaldo.** `respaldar` no termina
 * cuando escribe el archivo cifrado: lo descifra en un temporal, compara la
 * huella del certificado restaurado contra la del original, y recién ahí dice
 * que está.
 *
 * **Las contraseñas no pasan por `argv` ni por disco.** Van por variable de
 * entorno a `keytool` (`-storepass:env`) y por stdin a `openssl` (`-pass
 * stdin`). Un `-storepass miClave` queda en el historial del shell y a la vista
 * de `ps`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, appendFileSync, chmodSync, readFileSync, statSync, copyFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { rojo, verde, aviso, preguntarOculto } from './consola.mjs';

const RAIZ = join(homedir(), '.gradle', 'keystores');
const RESPALDOS = join(homedir(), 'Documents', 'constroad-keystores');
const PROPS = join(homedir(), '.gradle', 'gradle.properties');

/** Cifrado del respaldo. `pbkdf2` con muchas iteraciones no es opcional: sin eso
 *  `openssl enc` deriva la clave con UNA pasada de MD5. */
const CIFRA = ['-aes-256-cbc', '-pbkdf2', '-iter', '600000'];

export const rutaKeystore = (app) => join(RAIZ, `${app}-release.jks`);
export const rutaRespaldo = (app) => join(RESPALDOS, `${app}-release.jks.enc`);

/**
 * El `keytool` que sirve. **El de `/usr/bin` en macOS es un stub** que falla con
 * «Unable to locate a Java Runtime»; el JDK real viene adentro de Android
 * Studio, que además es el que usa Gradle.
 */
export function buscarKeytool() {
  const candidatos = [
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool',
    '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home/bin/keytool',
  ];
  for (const ruta of candidatos) if (existsSync(ruta)) return ruta;

  const hogar = spawnSync('/usr/libexec/java_home', [], { encoding: 'utf8' });
  if (hogar.status === 0) {
    const ruta = join(hogar.stdout.trim(), 'bin', 'keytool');
    if (existsSync(ruta)) return ruta;
  }
  return null;
}

/**
 * La huella sha256 del certificado, normalizada como la guarda la consola:
 * mayúsculas y sin los dos puntos. Cadena vacía si no se pudo leer — contraseña
 * equivocada, alias equivocado, o un archivo que no es una keystore.
 */
function huellaDe(keytool, archivo, app, clave) {
  const salida = spawnSync(
    keytool,
    ['-list', '-v', '-keystore', archivo, '-alias', app, '-storepass:env', 'LILA_KS'],
    { encoding: 'utf8', env: { ...process.env, LILA_KS: clave } }
  );
  const linea = (salida.stdout ?? '').split('\n').find((l) => /SHA256:/i.test(l));
  return linea ? linea.replace(/.*SHA256:\s*/i, '').replace(/[:\s]/g, '').toUpperCase() : '';
}

/**
 * La contraseña que YA está en `~/.gradle/gradle.properties`, si está.
 *
 * Gradle la necesita para compilar, así que ya vive ahí en claro: leerla no la
 * expone más de lo que está, y evita que tenga que pasar por una pantalla o un
 * portapapeles. `slice` desde el primer `=` y no `split('=')[1]`: una contraseña
 * con `=` adentro se cortaría al medio.
 */
function claveDeGradle(app) {
  if (!existsSync(PROPS)) return null;
  const clave = `${app.toUpperCase()}_UPLOAD_STORE_PASSWORD=`;
  const linea = readFileSync(PROPS, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(clave));
  return linea ? linea.slice(clave.length) : null;
}

/**
 * `openssl enc …`, con la contraseña por stdin.
 *
 * **No alcanza con mirar el código de salida.** LibreSSL —el openssl que trae
 * macOS— responde `0` ante un subcomando inválido y solo lo dice por stderr: sin
 * el `enc` adelante, esto «funcionaba» y dejaba un archivo que no existía, y el
 * error salía tres pasos después como «el respaldo está corrupto». Se comprueba
 * que el archivo de salida haya quedado escrito.
 */
function openssl(args, clave, salida) {
  const corrida = spawnSync('openssl', ['enc', ...args], { input: `${clave}\n`, encoding: 'utf8' });
  const escribio = existsSync(salida) && statSync(salida).size > 0;
  return {
    ok: corrida.status === 0 && escribio,
    stderr: (corrida.stderr ?? '').trim(),
  };
}

export function crear(app, { claveGenerada }) {
  const keytool = buscarKeytool();
  if (!keytool) return rojo('No hay ningún JDK. Instalá Android Studio, o «brew install openjdk@17».');

  const destino = rutaKeystore(app);
  if (existsSync(destino)) {
    rojo(`Ya existe ${destino}.`);
    return aviso('Generar otra encima cambia la firma: los teléfonos tendrían que desinstalar.');
  }
  mkdirSync(RAIZ, { recursive: true });

  // 4096 y no 2048: es una clave que va a vivir 27 años y firmar todo lo que se
  // instale en los teléfonos de la empresa. El costo son milisegundos por build.
  const comunes = ['-genkeypair', '-keystore', destino, '-alias', app,
    '-keyalg', 'RSA', '-keysize', '4096', '-validity', '10000'];

  if (!claveGenerada) {
    console.log(`Vas a crear la keystore de producción de «${app}».\n`);
    console.log('  · La contraseña la elegís vos y la guardás en tu gestor de contraseñas.');
    console.log('  · Perderla —o perder el archivo— obliga a desinstalar la app en CADA teléfono.');
    console.log(`  · Cuando termine, corré: lila keystore respaldar ${app}\n`);
    const salida = spawnSync(keytool, [...comunes, '-v'], { stdio: 'inherit' });
    if (salida.status !== 0) return rojo('keytool falló.');
    chmodSync(destino, 0o600);
    verde(`Creada: ${destino}`);
    return declararEnGradle(app, destino, null);
  }

  // La contraseña se genera acá y no la ve nadie: va directo a keytool por
  // entorno y a gradle.properties por escritura. 32 bytes al azar es mejor que
  // cualquier cosa tipeada, y como Gradle la lee del archivo nadie tiene que
  // recordarla. El precio es que perder gradle.properties pierde la clave — por
  // eso el respaldo corre a continuación y no «después».
  const clave = randomBytes(32).toString('base64');
  console.log(`Creando la keystore de «${app}» con una contraseña generada al azar.`);
  const salida = spawnSync(keytool, [
    ...comunes,
    '-storepass:env', 'LILA_KS', '-keypass:env', 'LILA_KS',
    '-dname', `CN=${app}, OU=movil, O=ConstRoad, L=Lima, ST=Lima, C=PE`,
  ], { env: { ...process.env, LILA_KS: clave }, stdio: 'inherit' });
  if (salida.status !== 0) return rojo('keytool falló.');

  chmodSync(destino, 0o600);
  verde(`Creada: ${destino}`);
  declararEnGradle(app, destino, clave);
  console.log('\nAhora el respaldo, que es la mitad que importa:');
  return respaldar(app);
}

function declararEnGradle(app, destino, clave) {
  const mayus = app.toUpperCase();
  if (clave === null) {
    console.log(`\nDeclarala en ${PROPS}:`);
    console.log(`  ${mayus}_UPLOAD_STORE_FILE=${destino}`);
    console.log(`  ${mayus}_UPLOAD_KEY_ALIAS=${app}`);
    console.log(`  ${mayus}_UPLOAD_STORE_PASSWORD=…`);
    console.log(`  ${mayus}_UPLOAD_KEY_PASSWORD=…`);
    return 0;
  }
  appendFileSync(PROPS,
    `\n# ${app} (app RN) — keystore de release. NO se versiona.\n` +
    `${mayus}_UPLOAD_STORE_FILE=${destino}\n` +
    `${mayus}_UPLOAD_KEY_ALIAS=${app}\n` +
    `${mayus}_UPLOAD_STORE_PASSWORD=${clave}\n` +
    `${mayus}_UPLOAD_KEY_PASSWORD=${clave}\n`);
  chmodSync(PROPS, 0o600);
  verde(`Declarada en ${PROPS}`);
  return 0;
}

/**
 * Las copias adicionales, cada una verificada de verdad.
 *
 * **El riesgo real no es el cifrado: es que haya una sola copia.** El original y
 * el respaldo por defecto viven en el MISMO disco, así que un disco que se rompe
 * se los lleva juntos. Por eso `--a` existe y por eso el comando avisa cuando no
 * se usó.
 */
function copiarA(destinos, cifrado) {
  const hechas = [];
  for (const destino of destinos) {
    try {
      mkdirSync(dirname(destino), { recursive: true });
      copyFileSync(cifrado, destino);
      chmodSync(destino, 0o600);
      hechas.push(destino);
    } catch (fallo) {
      rojo(`No pude copiar a ${destino}: ${fallo.message}`);
    }
  }
  return hechas;
}

export async function respaldar(app, opciones = {}) {
  const keytool = buscarKeytool();
  if (!keytool) return rojo('No hay ningún JDK.');
  const origen = rutaKeystore(app);
  if (!existsSync(origen)) return rojo(`No existe ${origen}.`);

  mkdirSync(RESPALDOS, { recursive: true });
  chmodSync(RESPALDOS, 0o700);
  const cifrado = rutaRespaldo(app);
  console.log(`Respaldo cifrado de «${app}» → ${cifrado}\n`);

  // Si Gradle ya la tiene, no se pregunta nada: un respaldo que cuesta es un
  // respaldo que no se corre.
  let clave = claveDeGradle(app);
  if (clave) verde(`Contraseña leída de ${PROPS}`);
  else clave = await preguntarOculto('Contraseña de la keystore');

  // La huella ANTES de cifrar: si la contraseña está mal se descubre acá, y no
  // después de escribir un respaldo que nadie puede abrir.
  if (!huellaDe(keytool, origen, app, clave)) {
    return rojo(`No pude abrir ${origen}: revisá la contraseña o el alias «${app}».`);
  }

  // El respaldo se cifra con la MISMA contraseña de la keystore. Una segunda no
  // agrega nada contra el riesgo real, que es perderla: quien pierde una pierde
  // las dos. Contra el robo tampoco — quien se lleva las dos cosas se habría
  // llevado la keystore igual.
  const cifrar = openssl([...CIFRA, '-salt', '-in', origen, '-out', cifrado, '-pass', 'stdin'], clave, cifrado);
  if (!cifrar.ok) return rojo(`No pude cifrar el respaldo. ${cifrar.stderr}`);
  chmodSync(cifrado, 0o600);
  verde(`Cifrado: ${cifrado}`);

  console.log('\nVerificando que el respaldo abra de verdad…');
  const codigo = verificarCon(keytool, app, clave);
  if (codigo !== 0) return codigo;

  const copias = copiarA(opciones.copias ?? [], cifrado);
  for (const destino of copias) {
    // Se verifica CADA copia, no se asume que copiar salió bien. Un archivo a
    // medias en un disco externo es exactamente el respaldo que falla el día que
    // hace falta.
    if (verificarArchivo(keytool, app, clave, destino, true) !== 0) return 1;
    verde(`Copia verificada: ${destino}`);
  }

  console.log('');
  if (copias.length === 0) {
    aviso('Hay UNA sola copia, y está en el mismo disco que el original.');
    console.log('   Un disco que se rompe se lleva las dos. Agregá al menos una:');
    console.log(`     lila keystore respaldar ${app} --a=/Volumes/USB/${app}.enc`);
  } else {
    verde(`${copias.length + 1} copias, todas verificadas.`);
    aviso('Que al menos una esté fuera de esta computadora.');
  }
  console.log('');
  aviso('Y lo que ningún comando puede hacer por vos:');
  console.log('   Guardá la contraseña en tu gestor, anotando a qué archivo abre.');
  console.log(`   Hoy vive solo en ${PROPS}, que NO está respaldado.`);
  return 0;
}

export async function verificar(app, opciones = {}) {
  const keytool = buscarKeytool();
  if (!keytool) return rojo('No hay ningún JDK.');
  if (!existsSync(rutaKeystore(app))) return rojo(`No existe ${rutaKeystore(app)}.`);
  const clave = claveDeGradle(app) ?? (await preguntarOculto('Contraseña de la keystore'));

  const codigo = verificarCon(keytool, app, clave);
  if (codigo !== 0) return codigo;

  // Cada copia declarada, una por una. Que exista el archivo no alcanza: lo que
  // se comprueba es que RESTAURE la misma clave.
  let fallaron = 0;
  for (const destino of opciones.copias ?? []) {
    if (!existsSync(destino)) {
      rojo(`Falta la copia ${destino}`);
      fallaron += 1;
    } else if (verificarArchivo(keytool, app, clave, destino, true) !== 0) {
      fallaron += 1;
    } else {
      verde(`Copia verificada: ${destino}`);
    }
  }
  return fallaron === 0 ? 0 : 1;
}

const verificarCon = (keytool, app, clave) =>
  verificarArchivo(keytool, app, clave, rutaRespaldo(app));

/**
 * Descifra UN archivo de respaldo y confirma que trae la misma clave.
 *
 * `silencioso` para las copias adicionales: cada una ya se anuncia con su ruta,
 * y repetir «el respaldo restaura la misma clave» por copia convierte una lista
 * de tres en seis líneas donde no se ve cuál falló.
 */
function verificarArchivo(keytool, app, clave, cifrado, silencioso = false) {
  if (!existsSync(cifrado)) return rojo(`No existe el respaldo ${cifrado}.`);

  // La copia en claro vive en un temporal que se borra pase lo que pase: si
  // sobreviviera, el respaldo cifrado no habría servido de nada.
  const temporal = mkdtempSync(join(tmpdir(), 'lila-'));
  try {
    const restaurada = join(temporal, 'restaurada.jks');
    const descifrar = openssl([...CIFRA, '-d', '-in', cifrado, '-out', restaurada, '-pass', 'stdin'], clave, restaurada);
    if (!descifrar.ok) {
      return rojo(`No pude descifrar el respaldo: la contraseña no es esa. ${descifrar.stderr}`);
    }

    const original = huellaDe(keytool, rutaKeystore(app), app, clave);
    const copia = huellaDe(keytool, restaurada, app, clave);

    if (!original) return rojo(`No pude abrir la keystore: revisá la contraseña o el alias «${app}».`);
    if (!copia) return rojo('El respaldo se descifró pero no es una keystore legible. Está corrupto.');
    if (original !== copia) {
      rojo('El respaldo NO restaura la misma clave.');
      console.error(`  original   : ${original}\n  restaurada : ${copia}`);
      return 1;
    }

    if (!silencioso) {
      verde('El respaldo restaura la misma clave.');
      console.log(`  huella: ${original}`);
    }
    return 0;
  } finally {
    rmSync(temporal, { recursive: true, force: true });
  }
}

export async function huella(app) {
  const keytool = buscarKeytool();
  if (!keytool) return rojo('No hay ningún JDK.');
  const archivo = rutaKeystore(app);
  if (!existsSync(archivo)) return rojo(`No existe ${archivo}.`);
  const clave = claveDeGradle(app) ?? (await preguntarOculto('Contraseña de la keystore'));
  const valor = huellaDe(keytool, archivo, app, clave);
  if (!valor) return rojo(`No pude abrir ${archivo}: revisá la contraseña o el alias «${app}».`);
  console.log(valor);
  return 0;
}
