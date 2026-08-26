import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { esperaDelIntento, sePuedeReintentar } from './reintentos.mjs';

/**
 * Cuándo se reintenta una subida.
 *
 * Nace del 25/08/2026: subir ~36 MB fallaba con «fetch failed» una, dos y hasta
 * tres veces seguidas, y funcionaba al reintentar sin cambiar una línea. La
 * misma subida por `curl` nunca falló, así que el problema está del lado del
 * `fetch` de Node con un `FormData` grande, no del server.
 *
 * **Lo que NO se reintenta es lo importante.** Un fallo de RED es un intento que
 * no llegó; una RESPUESTA del server —409, 422, 401— es una decisión ya tomada,
 * y repetirla no la cambia: solo esconde el motivo detrás de tres intentos
 * idénticos y sube 36 MB tres veces para nada.
 */
describe('sePuedeReintentar', () => {
  test('un fallo de red sí', () => {
    assert.equal(sePuedeReintentar({ intento: 1, maximo: 3, fueRespuesta: false }), true);
  });

  test('una respuesta del server NO, aunque queden intentos', () => {
    assert.equal(sePuedeReintentar({ intento: 1, maximo: 3, fueRespuesta: true }), false);
  });

  test('agotados los intentos, no', () => {
    assert.equal(sePuedeReintentar({ intento: 3, maximo: 3, fueRespuesta: false }), false);
  });

  test('el último intento posible se toma', () => {
    assert.equal(sePuedeReintentar({ intento: 2, maximo: 3, fueRespuesta: false }), true);
  });
});

/**
 * La espera crece, y tiene techo.
 *
 * Sin espera se reintenta contra el mismo problema instantáneamente; sin techo,
 * el cuarto intento tardaría más que volver a correr el comando a mano.
 */
describe('esperaDelIntento', () => {
  test('crece con cada intento', () => {
    assert.ok(esperaDelIntento(1) < esperaDelIntento(2));
    assert.ok(esperaDelIntento(2) < esperaDelIntento(3));
  });

  test('el primer reintento es casi inmediato', () => {
    assert.ok(esperaDelIntento(1) <= 2000);
  });

  test('nunca pasa del techo', () => {
    assert.ok(esperaDelIntento(50) <= 8000);
  });
});
