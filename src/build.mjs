/**
 * Compilar y firmar un APK de una app Expo/RN.
 *
 * **Qué es de acá y qué es de la app.** Este comando sabe *cómo se compila y se
 * firma bien un APK de Android*; no sabe nada de la app. La configuración que se
 * embebe —a qué servidor le habla, con qué credenciales— la fija el repo de cada
 * app, porque `EXPO_PUBLIC_*` se hornea al compilar y equivocarse ahí produce un
 * APK que se instala perfecto y falla en la mano del usuario.
 *
 * **Las tres guardas no se pueden saltear**, y las tres salen de errores reales:
 *
 * 1. **JDK 17.** Con el 21+ el build muere en CMake con «A restricted method in
 *    java.lang.System has been called» — la restricción de acceso nativo de JDK
 *    24 (JEP 472). Pasó el 18/08/2026 sin que nadie tocara nada: Android Studio
 *    actualizó su JBR a 25.
 * 2. **La firma no puede ser la de debug si se pidió release.** Un APK de debug
 *    se instala encima del de debug y parece que todo anda; el día que se pase a
 *    la firma real hay que desinstalar en cada teléfono.
 * 3. **La URL de release tiene que estar ADENTRO del binario.** Ya pasó al
 *    revés: un APK compilado con el `.env` de desarrollo se instaló perfecto y
 *    falló en la mano del chofer con «sin conexión» y el wifi funcionando.
 *
 *    Se comprueba que la URL declarada ESTÉ, y no que no estén `10.0.2.2` o
 *    `localhost`. La lista negra parece la comprobación obvia y **no sirve**:
 *    los dos APK de Timón que hoy andan en los teléfonos contienen las tres
 *    cadenas, porque el código de dev-support de React Native se empaqueta
 *    igual en release. Una guarda así rechaza todos los builds buenos.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, copyFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { rojo, verde, aviso, tenue, mb } from './consola.mjs';

const JDK17 = '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home';

/** El JDK con el que Gradle compila. `null` si no hay uno servible. */
function buscarJdk17() {
  if (existsSync(join(JDK17, 'bin', 'java'))) return JDK17;

  const delEntorno = process.env.JAVA_HOME;
  if (delEntorno && existsSync(join(delEntorno, 'bin', 'java'))) {
    const version = spawnSync(join(delEntorno, 'bin', 'java'), ['-version'], { encoding: 'utf8' });
    const mayor = /"(\d+)/.exec(`${version.stderr}${version.stdout}`)?.[1];
    if (mayor === '17') return delEntorno;
  }
  return null;
}

/**
 * El SDK de Android. **Se resuelve acá y no se hereda del entorno**, por lo
 * mismo que el JDK: Gradle falla con «SDK location not found» y ese mensaje
 * manda a editar `local.properties` —un archivo que `expo prebuild` regenera— en
 * vez de a decir que falta una variable.
 *
 * El orden es el de confianza: lo que declaró la persona, después las rutas
 * conocidas. En esta Mac el SDK NO está en `~/Library/Android/sdk`.
 */
function buscarSdk() {
  const candidatos = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    '/opt/homebrew/share/android-commandlinetools',
    join(process.env.HOME ?? '', 'Library', 'Android', 'sdk'),
  ];
  for (const ruta of candidatos) {
    if (ruta && existsSync(join(ruta, 'platform-tools'))) return ruta;
  }
  return null;
}

/** `apksigner` no queda en el PATH: vive adentro de las build-tools del SDK. */
function buscarApksigner(sdk) {
  const carpeta = join(sdk, 'build-tools');
  if (!existsSync(carpeta)) return null;
  const versiones = readdirSync(carpeta).sort().reverse();
  for (const version of versiones) {
    const ruta = join(carpeta, version, 'apksigner');
    if (existsSync(ruta)) return ruta;
  }
  return null;
}

/**
 * La configuración de build de la app, si la declara.
 *
 * **`EXPO_PUBLIC_*` se hornea en el binario al compilar.** El `.env` del repo
 * apunta al emulador para desarrollo, y un release que se lleve esa URL se
 * instala perfecto y falla en la mano del usuario con «sin conexión» y el wifi
 * funcionando. Por eso el valor de release se DECLARA en un archivo versionado,
 * que se revisa en un PR, en vez de depender de qué había en el entorno.
 *
 * ```json
 * { "build": { "env": { "EXPO_PUBLIC_API_URL": "https://www.constroad.com" } } }
 * ```
 */
const leerLilaJson = () => {
  try {
    return JSON.parse(readFileSync('lila.json', 'utf8'));
  } catch {
    return null;
  }
};

const leerAppJson = () => {
  try {
    return JSON.parse(readFileSync('app.json', 'utf8')).expo ?? null;
  } catch {
    return null;
  }
};

export function build(opciones) {
  const app = leerAppJson();
  if (!app) return rojo('No encontré app.json acá. Corré esto desde la raíz del repo de la app.');

  const sdk = buscarSdk();
  if (!sdk) {
    rojo('No encontré el SDK de Android.');
    console.error('\n  Instalalo con Android Studio, o «brew install --cask android-commandlinetools».');
    console.error('  Si ya lo tenés, exportá ANDROID_HOME apuntando a su carpeta.');
    return 1;
  }

  const jdk = buscarJdk17();
  if (!jdk) {
    rojo('Falta el JDK 17, que es con el que compila Gradle.');
    console.error('\n  brew install openjdk@17\n');
    console.error('El JDK que trae Android Studio (25) NO sirve: el build muere en');
    console.error('CMake con «A restricted method in java.lang.System has been called».');
    return 1;
  }

  const slug = app.slug ?? 'app';
  const version = app.version ?? '0.0.0';
  const versionCode = app.android?.versionCode ?? 0;
  console.log(`\nlila apk build  ${slug} ${version} (${versionCode}) · ${opciones.abi}`);
  tenue(`JDK 17 · ${jdk}`);
  tenue(`SDK    · ${sdk}`);

  const lila = leerLilaJson();
  const delRepo = lila?.build?.env ?? {};
  for (const [clave, valor] of Object.entries(delRepo)) tenue(`${clave}=${valor}`);

  const entorno = {
    ...process.env,
    // Lo declarado en lila.json PISA al entorno: el `.env` de desarrollo es
    // justamente de lo que hay que protegerse.
    ...delRepo,
    JAVA_HOME: jdk,
    ANDROID_HOME: sdk,
    ANDROID_SDK_ROOT: sdk,
    PATH: `${join(jdk, 'bin')}:${process.env.PATH}`,
  };

  console.log('\n1/4 Preparando el proyecto nativo…');
  const prebuild = spawnSync('npx', ['expo', 'prebuild', '--platform', 'android'], {
    stdio: 'inherit', env: entorno,
  });
  if (prebuild.status !== 0) return rojo('`expo prebuild` falló.');

  console.log('2/4 Compilando con Gradle y R8 (tarda unos minutos)…');
  const gradle = spawnSync(
    './android/gradlew',
    ['-p', 'android', 'assembleRelease', `-PreactNativeArchitectures=${opciones.abi}`],
    { stdio: 'inherit', env: entorno }
  );
  if (gradle.status !== 0) return rojo('Gradle falló.');

  const compilado = join('android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  if (!existsSync(compilado)) return rojo(`Gradle terminó bien pero no está ${compilado}.`);

  console.log('3/4 Verificando la firma…');
  const apksigner = buscarApksigner(sdk);
  if (!apksigner) {
    // No se aborta: el APK está y sirve. Pero se dice, porque sin esta
    // verificación nadie sabe con qué quedó firmado.
    aviso('No encontré apksigner: no puedo verificar con qué quedó firmado.');
  } else {
    // **`env: entorno` no es opcional.** `apksigner` es un script que lanza
    // `java`, y sin el JDK en el PATH no imprime nada — con lo cual el chequeo
    // de «no puede ser firma de debug» pasaba SIEMPRE, sobre cualquier APK.
    // Una guarda que no puede fallar es peor que no tenerla.
    const certs = spawnSync(apksigner, ['verify', '--print-certs', compilado], {
      encoding: 'utf8', env: entorno,
    });
    const dn = (certs.stdout ?? '').split('\n').find((l) => /certificate DN:/i.test(l)) ?? '';

    if (!dn) {
      rojo('No pude leer con qué está firmado el APK.');
      console.error(`  ${(certs.stderr ?? '').trim().split('\n')[0] ?? 'apksigner no imprimió nada.'}`);
      console.error('  No sigo: publicar sin saber la firma es lo que rompe la actualización.');
      return 1;
    }

    const esDebug = /Android Debug/i.test(dn);
    if (esDebug && opciones.signing === 'release') {
      rojo('Quedó firmado con DEBUG pese a pedir release.');
      console.error(`  ${dn.trim()}`);
      console.error(`  Declarás la keystore con: lila keystore crear ${slug}`);
      return 1;
    }
    if (esDebug) {
      aviso('Firma de DEBUG: se instala encima de la actual, pero al pasar a la keystore');
      aviso('propia habrá que desinstalar en cada teléfono.');
    } else {
      const huella = (certs.stdout ?? '').split('\n')
        .find((l) => /SHA-256 digest/i.test(l))?.replace(/.*digest:\s*/i, '').trim();
      verde(`Firmado con ${dn.replace(/.*DN:\s*/i, '').trim()}`);
      if (huella) tenue(`  huella: ${huella.toUpperCase()}`);
    }
  }

  console.log('4/4 Empaquetando…');
  mkdirSync(opciones.out, { recursive: true });
  const destino = join(opciones.out, `${slug}-${version}-${versionCode}.apk`);
  copyFileSync(compilado, destino);

  const esperada = urlDeclarada(delRepo);
  if (!esperada) {
    aviso('No puedo verificar a qué servidor apunta: lila.json no declara ninguna URL.');
    aviso('  { "build": { "env": { "EXPO_PUBLIC_API_URL": "https://…" } } }');
  } else if (!readFileSync(destino).includes(esperada)) {
    rojo(`La URL de release no quedó adentro del APK: ${esperada}`);
    console.error('  `EXPO_PUBLIC_*` se hornea al compilar. Un APK sin la URL buena se');
    console.error('  instala perfecto y falla con «sin conexión» y el wifi funcionando.');
    return 1;
  } else {
    verde(`Apunta a ${esperada}`);
  }

  verde(`${destino} · ${mb(statSync(destino).size)}`);
  console.log(`\nPara publicarlo:  lila apk publish ${destino}`);
  return 0;
}

/**
 * La URL que el repo declaró para release, si declaró alguna.
 *
 * Se busca entre las `EXPO_PUBLIC_*` porque son las que Expo hornea en el
 * bundle; una variable que no empiece así no llega al binario y comprobarla no
 * diría nada.
 */
function urlDeclarada(env) {
  for (const [clave, valor] of Object.entries(env)) {
    if (clave.startsWith('EXPO_PUBLIC_') && /^https?:\/\//.test(String(valor))) return valor;
  }
  return null;
}
