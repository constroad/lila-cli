import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, AREAS } from './args.mjs';

describe('sin argumentos', () => {
  test('pide el menú interactivo, no un error', () => {
    // Un CLI que se usa cada dos semanas y contesta «uso: …» a secas obliga a
    // recordar banderas que nadie recuerda. Sin argumentos se abre el menú.
    assert.equal(parseArgs([]).comando, 'menu');
  });
});

describe('keystore', () => {
  test('los cuatro verbos con su app', () => {
    for (const verbo of ['crear', 'respaldar', 'verificar', 'huella']) {
      const salida = parseArgs(['keystore', verbo, 'timon']);
      assert.equal(salida.error, undefined);
      assert.deepEqual(salida.comando, `keystore:${verbo}`);
      assert.equal(salida.opciones.app, 'timon');
    }
  });

  test('sin app no se adivina', () => {
    // Adivinar el nombre desde el directorio actual crearía una keystore con el
    // name equivocado, y eso no se puede deshacer sin desinstalar en todos los
    // teléfonos.
    assert.match(parseArgs(['keystore', 'crear']).error, /app/i);
  });

  test('un verbo que no existe lo dice y lista los que sí', () => {
    const { error } = parseArgs(['keystore', 'borrar', 'timon']);
    assert.match(error, /borrar/);
    assert.match(error, /crear/);
  });

  test('--clave-generada solo vale para crear', () => {
    assert.equal(parseArgs(['keystore', 'crear', 'x', '--clave-generada']).opciones.claveGenerada, true);
    assert.match(parseArgs(['keystore', 'huella', 'x', '--clave-generada']).error, /clave-generada/);
  });
});

describe('apk publish', () => {
  test('la ruta al APK alcanza', () => {
    // El server lee el AndroidManifest: la versión, el versionCode y el paquete
    // salen del binario, no de banderas.
    const { comando, opciones, error } = parseArgs(['apk', 'publish', 'dist/app.apk']);
    assert.equal(error, undefined);
    assert.equal(comando, 'apk:publish');
    assert.equal(opciones.apk, 'dist/app.apk');
    assert.equal(opciones.channel, 'stable');
  });

  test('sin ruta busca en dist/', () => {
    assert.equal(parseArgs(['apk', 'publish']).opciones.apk, null);
  });

  test('--channel valida contra la lista', () => {
    assert.equal(parseArgs(['apk', 'publish', '--channel=beta']).opciones.channel, 'beta');
    assert.match(parseArgs(['apk', 'publish', '--channel=produccion']).error, /channel/i);
  });

  test('banderas booleanas', () => {
    const { opciones } = parseArgs(['apk', 'publish', 'x.apk', '--critical', '--seco']);
    assert.equal(opciones.critical, true);
    assert.equal(opciones.seco, true);
  });
});

describe('apk build', () => {
  test('firma release por defecto', () => {
    // Al revés que el script de Timón, que default a debug por la migración
    // pendiente. Un CLI nuevo no arrastra esa deuda: lo normal es firmar.
    assert.equal(parseArgs(['apk', 'build']).opciones.firma, 'release');
  });

  test('--firma=debug se acepta y nada más', () => {
    assert.equal(parseArgs(['apk', 'build', '--firma=debug']).opciones.firma, 'debug');
    assert.match(parseArgs(['apk', 'build', '--firma=ninguna']).error, /firma/i);
  });

  test('--abi por defecto arm64 y «all» se expande', () => {
    assert.equal(parseArgs(['apk', 'build']).opciones.abi, 'arm64-v8a');
    assert.match(parseArgs(['apk', 'build', '--abi=all']).opciones.abi, /armeabi-v7a,arm64-v8a/);
  });
});

describe('errores generales', () => {
  test('un área que no existe lista las que sí', () => {
    const { error } = parseArgs(['torre', 'deploy']);
    assert.match(error, /torre/);
    for (const area of AREAS) assert.match(error, new RegExp(area));
  });

  test('una bandera desconocida NO se ignora', () => {
    // Un `--canall=beta` mal tipeado publicaría a stable sin que nadie se
    // entere. Es peor que fallar.
    assert.match(parseArgs(['apk', 'publish', 'x.apk', '--canall=beta']).error, /canall/);
  });

  test('una bandera con valor vacío es un typo, no un dato', () => {
    assert.match(parseArgs(['apk', 'publish', 'x.apk', '--channel=']).error, /channel/i);
  });

  test('login y whoami no llevan área', () => {
    assert.equal(parseArgs(['login']).comando, 'login');
    assert.equal(parseArgs(['whoami']).comando, 'whoami');
  });

  test('--url solo en publish, y tiene que ser una URL', () => {
    assert.equal(parseArgs(['apk', 'publish', '--url=http://127.0.0.1:4001']).opciones.url, 'http://127.0.0.1:4001');
    assert.match(parseArgs(['apk', 'publish', '--url=localhost']).error, /url/i);
  });
});
