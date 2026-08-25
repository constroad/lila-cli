import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dnameDe, argumentosDeCreacion } from './keystore.mjs';

/**
 * Los argumentos con los que se llama a `keytool`.
 *
 * Existe por un bucle infinito real (24/08/2026): el camino interactivo NO
 * pasaba `-dname`, así que `keytool` preguntaba el nombre, la organización, la
 * ciudad… y al dejar todo en blanco, la confirmación por defecto es **«no»** —
 * con lo cual vuelve a preguntar. Para siempre. El usuario no tenía forma de
 * salir salvo Ctrl-C, y nada en pantalla decía qué escribir.
 *
 * El DN **no es una decisión de quien crea la keystore**: es la identidad de la
 * empresa y sale de una constante. Lo único que se le pide es la contraseña.
 */
describe('dnameDe', () => {
  test('lleva el nombre de la app y los datos de la empresa', () => {
    assert.equal(dnameDe('lilachat'), 'CN=lilachat, OU=movil, O=ConstRoad, L=Lima, ST=Lima, C=PE');
  });

  /**
   * Una coma dentro de un componente parte el DN en dos y `keytool` falla con
   * un error de sintaxis que no nombra la causa.
   */
  test('un nombre con coma no rompe el DN', () => {
    assert.ok(!dnameDe('app, rara').includes('CN=app, rara,'));
    assert.match(dnameDe('app, rara'), /CN=app rara/);
  });

  test('el país son DOS letras: keytool rechaza cualquier otra cosa', () => {
    assert.match(dnameDe('x'), /C=[A-Z]{2}$/);
  });
});

describe('argumentosDeCreacion', () => {
  const base = { destino: '/tmp/x.jks', app: 'lilachat' };

  /** LA regla: los DOS caminos pasan `-dname`. Ninguno deja preguntar. */
  test('el camino interactivo también pasa -dname', () => {
    const args = argumentosDeCreacion({ ...base, generatedKey: false });

    assert.ok(args.includes('-dname'));
    assert.equal(args[args.indexOf('-dname') + 1], dnameDe('lilachat'));
  });

  test('el camino con clave generada pasa -dname y la clave por entorno', () => {
    const args = argumentosDeCreacion({ ...base, generatedKey: true });

    assert.ok(args.includes('-dname'));
    assert.ok(args.includes('-storepass:env'));
    assert.equal(args[args.indexOf('-storepass:env') + 1], 'LILA_KS');
  });

  /**
   * En el camino interactivo la contraseña la escribe la persona, así que NO
   * puede ir por entorno: si fuera, `keytool` no la pediría y la clave saldría
   * de un lado que el usuario no eligió.
   */
  test('el interactivo NO pasa la clave por entorno', () => {
    const args = argumentosDeCreacion({ ...base, generatedKey: false });

    assert.ok(!args.includes('-storepass:env'));
  });

  test('la clave es RSA de 4096 y dura 10000 días en los dos caminos', () => {
    for (const generatedKey of [true, false]) {
      const args = argumentosDeCreacion({ ...base, generatedKey });
      assert.equal(args[args.indexOf('-keysize') + 1], '4096');
      assert.equal(args[args.indexOf('-validity') + 1], '10000');
    }
  });

  test('el alias es el nombre de la app', () => {
    const args = argumentosDeCreacion({ ...base, generatedKey: false });

    assert.equal(args[args.indexOf('-alias') + 1], 'lilachat');
  });
});
