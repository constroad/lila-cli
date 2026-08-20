import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { hayVersionMasNueva } from './version.mjs';

describe('hayVersionMasNueva', () => {
  test('avisa cuando la publicada va adelante', () => {
    assert.equal(hayVersionMasNueva('0.5.0', '0.5.1'), true);
    assert.equal(hayVersionMasNueva('0.5.0', '0.6.0'), true);
    assert.equal(hayVersionMasNueva('0.9.0', '1.0.0'), true);
  });

  test('no avisa cuando son iguales', () => {
    assert.equal(hayVersionMasNueva('0.5.0', '0.5.0'), false);
  });

  // El caso que rompía con `!==`: mientras se prepara un release, la local va
  // adelante y el aviso salía al revés — «hay una más nueva: 0.5.0 (tenés
  // 0.5.1)», que se lee como un bug del CLI.
  test('no avisa cuando la local va ADELANTE', () => {
    assert.equal(hayVersionMasNueva('0.5.1', '0.5.0'), false);
    assert.equal(hayVersionMasNueva('1.0.0', '0.9.9'), false);
  });

  // 10 > 9 comparando números; comparando texto, '0.10.0' < '0.9.0'. Es el mismo
  // error que el CLI evita en los versionCode de Android.
  test('compara números, no texto', () => {
    assert.equal(hayVersionMasNueva('0.9.0', '0.10.0'), true);
    assert.equal(hayVersionMasNueva('0.10.0', '0.9.0'), false);
  });

  test('un formato raro no dispara ningún aviso', () => {
    assert.equal(hayVersionMasNueva('0.5.0', '1.0.0-beta.1'), false);
    assert.equal(hayVersionMasNueva('0.5.0', undefined), false);
    assert.equal(hayVersionMasNueva('', '1.0.0'), false);
  });
});
