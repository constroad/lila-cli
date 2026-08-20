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
    for (const verbo of ['create', 'backup', 'verify', 'fingerprint']) {
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
    assert.match(parseArgs(['keystore', 'create']).error, /app/i);
  });

  test('un verbo que no existe lo dice y lista los que sí', () => {
    const { error } = parseArgs(['keystore', 'delete', 'timon']);
    assert.match(error, /delete/);
    assert.match(error, /create/);
  });

  test('--generated-key solo vale para crear', () => {
    assert.equal(parseArgs(['keystore', 'create', 'x', '--generated-key']).opciones.generatedKey, true);
    assert.match(parseArgs(['keystore', 'fingerprint', 'x', '--generated-key']).error, /generated-key/);
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
    const { opciones } = parseArgs(['apk', 'publish', 'x.apk', '--critical', '--dry-run']);
    assert.equal(opciones.critical, true);
    assert.equal(opciones.dryRun, true);
  });
});

describe('apk build', () => {
  test('signing release por defecto', () => {
    // Al revés que el script de Timón, que default a debug por la migración
    // pendiente. Un CLI nuevo no arrastra esa deuda: lo normal es firmar.
    assert.equal(parseArgs(['apk', 'build']).opciones.signing, 'release');
  });

  test('--signing=debug se acepta y nada más', () => {
    assert.equal(parseArgs(['apk', 'build', '--signing=debug']).opciones.signing, 'debug');
    assert.match(parseArgs(['apk', 'build', '--signing=none']).error, /signing/i);
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

describe('los nombres son todos en inglés (v0.5.0)', () => {
  test('los verbos de keystore', () => {
    for (const verbo of ['create', 'backup', 'verify', 'fingerprint']) {
      assert.equal(parseArgs(['keystore', verbo, 'timon']).error, undefined, verbo);
    }
  });

  // **El verbo viejo no puede dar «no existe» a secas.** Está escrito en specs,
  // en un README y en el historial de la terminal de quien lo usó tres meses;
  // un error genérico manda a leer el `--help` para descubrir que solo cambió
  // de idioma. Decirlo en una línea cuesta nada y ahorra el viaje.
  test('un verbo en español dice cuál es el nuevo, no «no existe»', () => {
    assert.match(parseArgs(['keystore', 'crear', 'timon']).error, /crear.*create/is);
    assert.match(parseArgs(['keystore', 'respaldar', 'timon']).error, /respaldar.*backup/is);
    assert.match(parseArgs(['keystore', 'huella', 'timon']).error, /huella.*fingerprint/is);
  });

  test('una bandera en español también', () => {
    assert.match(parseArgs(['apk', 'publish', '--obligar']).error, /obligar.*enforce/is);
    assert.match(parseArgs(['apk', 'build', '--firma=debug']).error, /firma.*signing/is);
    assert.match(parseArgs(['apk', 'publish', '--seco']).error, /seco.*dry-run/is);
  });

  test('las banderas nuevas de publish', () => {
    const { opciones } = parseArgs(['apk', 'publish', 'x.apk', '--enforce', '--dry-run']);
    assert.equal(opciones.enforce, true);
    assert.equal(opciones.dryRun, true);
  });

  test('las banderas nuevas de build', () => {
    const { opciones } = parseArgs(['apk', 'build', '--signing=debug', '--out=salida']);
    assert.equal(opciones.signing, 'debug');
    assert.equal(opciones.out, 'salida');
  });

  test('la copia adicional del respaldo es --to y se acumula', () => {
    const { opciones } = parseArgs(['keystore', 'backup', 'timon', '--to=/a.enc', '--to=/b.enc']);
    assert.deepEqual(opciones.copies, ['/a.enc', '/b.enc']);
  });
});

describe('--help y --version', () => {
  // El mensaje de «sin argumentos» mandaba a usar «lila --help»… que caía en el
  // mismo menú y volvía a fallar. Un CLI que recomienda un comando inexistente
  // gasta el poco crédito que tiene justo cuando alguien está perdido.
  test('--help pide la ayuda, no el menú', () => {
    for (const bandera of ['--help', '-h']) {
      assert.equal(parseArgs([bandera]).comando, 'ayuda', bandera);
    }
  });

  test('--version pide la versión', () => {
    for (const bandera of ['--version', '-v']) {
      assert.equal(parseArgs([bandera]).comando, 'version', bandera);
    }
  });

  // Saber qué versión estás corriendo importa MÁS cuando algo falla, y ahí no
  // hay margen para escribir un comando de tres palabras.
  test('ganan sobre cualquier otro comando', () => {
    assert.equal(parseArgs(['apk', 'publish', '--version']).comando, 'version');
    assert.equal(parseArgs(['keystore', 'create', 'x', '--help']).comando, 'ayuda');
  });

  test('sin argumentos sigue siendo el menú', () => {
    assert.equal(parseArgs([]).comando, 'menu');
  });
});
