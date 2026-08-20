import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { elegirToken, guardarEnMapa, leerMapa } from './tokens.mjs';

/**
 * Elegir CUÁL token usar cuando hay más de una app en la misma máquina.
 *
 * Hasta la 0.5.0 el archivo guardaba uno solo: `lila login` para Timón pisaba en
 * silencio el de LilaStore. Y el fallo aparecía después y disfrazado — publicar
 * con el token de otra app devuelve el mismo `401 Token de publicación inválido`
 * que un token vencido, porque el server no distingue a propósito. Quien lo
 * sufre cree que su token caducó y genera otro, que tampoco anda.
 */

const guardado = (tokens) => ({ version: 2, tokens });

describe('elegirToken', () => {
  test('la variable de entorno gana sobre todo', () => {
    // Es lo que hace que el mismo comando funcione en un runner, donde no hay
    // login posible y el token llega como secret.
    const elegido = elegirToken({
      delEntorno: 'del-entorno',
      guardado: guardado({ timon: { token: 'de-timon', url: 'u' } }),
      app: 'timon',
    });

    assert.equal(elegido.token, 'del-entorno');
    assert.equal(elegido.origen, 'LILASTORE_TOKEN');
  });

  test('con la app conocida usa el suyo, aunque haya otros', () => {
    const elegido = elegirToken({
      delEntorno: undefined,
      guardado: guardado({
        lilastore: { token: 'de-lilastore', url: 'u' },
        timon: { token: 'de-timon', url: 'u' },
      }),
      app: 'timon',
    });

    assert.equal(elegido.token, 'de-timon');
    assert.equal(elegido.app, 'timon');
  });

  // LA razón de este archivo: antes acá se usaba el único que hubiera, que podía
  // ser el de otra app, y el 401 llegaba disfrazado de token vencido.
  test('con la app conocida y sin token para ELLA, no se cae al de otra', () => {
    const elegido = elegirToken({
      delEntorno: undefined,
      guardado: guardado({ lilastore: { token: 'de-lilastore', url: 'u' } }),
      app: 'timon',
    });

    assert.equal(elegido.token, null);
    assert.match(elegido.motivo, /timon/);
    // Se nombran los que SÍ hay: saber que tenés el de lilastore explica por qué
    // «ya hice login» no alcanza.
    assert.match(elegido.motivo, /lilastore/);
  });

  // El legado sí se usa, porque es lo que venía funcionando — pero avisando: un
  // 401 de un token que resulta ser de otra app llega disfrazado de «caducó».
  test('el legado se usa como último recurso, con aviso', () => {
    const elegido = elegirToken({
      delEntorno: undefined,
      guardado: { version: 2, tokens: { '': { token: 'viejo', url: 'u' }, lilastore: { token: 'a', url: 'u' } } },
      app: 'timon',
    });

    assert.equal(elegido.token, 'viejo');
    assert.match(elegido.aviso, /timon/);
  });

  test('sin saber la app, si hay uno solo se usa ese', () => {
    const elegido = elegirToken({
      delEntorno: undefined,
      guardado: guardado({ timon: { token: 'de-timon', url: 'u' } }),
      app: null,
    });

    assert.equal(elegido.token, 'de-timon');
  });

  test('sin saber la app y con varios, se pide que se diga cuál', () => {
    const elegido = elegirToken({
      delEntorno: undefined,
      guardado: guardado({
        lilastore: { token: 'a', url: 'u' },
        timon: { token: 'b', url: 'u' },
      }),
      app: null,
    });

    assert.equal(elegido.token, null);
    assert.match(elegido.motivo, /lilastore/);
    assert.match(elegido.motivo, /timon/);
  });

  test('sin nada guardado y sin entorno, no hay token', () => {
    const elegido = elegirToken({ delEntorno: undefined, guardado: guardado({}), app: 'timon' });

    assert.equal(elegido.token, null);
    assert.match(elegido.motivo, /login/i);
  });

  test('una cadena vacía en el entorno NO cuenta como token', () => {
    // Un secret mal cargado en un runner llega como ''. Tomarlo por bueno da un
    // 401 en vez de «falta el secret», que es lo que de verdad pasó.
    const elegido = elegirToken({
      delEntorno: '',
      guardado: guardado({ timon: { token: 'de-timon', url: 'u' } }),
      app: 'timon',
    });

    assert.equal(elegido.token, 'de-timon');
  });
});

describe('leerMapa — el formato viejo se sigue leyendo', () => {
  test('un archivo de la 0.4.0 no obliga a volver a hacer login', () => {
    // `{token, url}` sin app: se conserva bajo una clave vacía y sirve para
    // cualquier repo, porque no hay forma de saber de quién era.
    const mapa = leerMapa({ token: 'viejo', url: 'https://x' });

    assert.equal(mapa.tokens[''].token, 'viejo');
  });

  test('un archivo corrupto se lee como vacío, no revienta', () => {
    assert.deepEqual(leerMapa(null).tokens, {});
    assert.deepEqual(leerMapa({ tokens: 'no es un objeto' }).tokens, {});
  });

  test('el token legado sirve aunque se pida una app concreta', () => {
    const elegido = elegirToken({
      delEntorno: undefined,
      guardado: leerMapa({ token: 'viejo', url: 'https://x' }),
      app: 'timon',
    });

    assert.equal(elegido.token, 'viejo');
  });
});

describe('guardarEnMapa', () => {
  test('agrega sin borrar los otros', () => {
    const antes = guardado({ lilastore: { token: 'a', url: 'u' } });
    const despues = guardarEnMapa(antes, 'timon', 'b', 'u');

    assert.equal(despues.tokens.lilastore.token, 'a');
    assert.equal(despues.tokens.timon.token, 'b');
  });

  test('vuelve a hacer login de la misma app y la pisa a ella sola', () => {
    const antes = guardado({ timon: { token: 'viejo', url: 'u' } });
    const despues = guardarEnMapa(antes, 'timon', 'nuevo', 'u');

    assert.equal(despues.tokens.timon.token, 'nuevo');
  });

  // **El legado se conserva.** Borrarlo sería lo prolijo y rompería a quien lo
  // tenía andando: es el que hoy publica TODAS sus apps, y hacer login para una
  // sola dejaría a las otras sin nada sin que nadie lo pidiera.
  test('guardar uno con nombre NO borra el legado', () => {
    const antes = leerMapa({ token: 'viejo', url: 'u' });
    const despues = guardarEnMapa(antes, 'timon', 'nuevo', 'u');

    assert.equal(despues.tokens[''].token, 'viejo');
    assert.equal(despues.tokens.timon.token, 'nuevo');
  });
});
