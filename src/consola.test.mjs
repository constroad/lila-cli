import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { preguntarOculto, preguntar } from './consola.mjs';

/**
 * Lo que se prueba acá es **que no se cuelgue**.
 *
 * El 19/08/2026 `lila login` salía con «Detected unsettled top-level await» sin
 * haber leído nada: la implementación anterior usaba `readline` con
 * `terminal: true`, cuyo `question()` nunca disparaba el callback, y de paso
 * borraba el prompt con secuencias ANSI. Desde afuera el CLI parecía no pedir
 * nada; por dentro esperaba para siempre.
 *
 * Un test que confirme que se lee bien haría falta un pseudo-terminal, que
 * `node --test` no da. Lo que sí se puede afirmar sin uno es el invariante que
 * importa: **sin terminal, falla rápido y con motivo**. Es el mismo camino que
 * recorre el CI, donde `/dev/tty` no existe — y donde colgarse significa un
 * workflow trabado hasta el timeout de seis horas en vez de un rojo en veinte
 * segundos.
 *
 * El camino feliz se comprueba a mano, con un pty de verdad:
 *
 *     (printf 'tok\\n'; sleep 2) | script -q /dev/null lila login
 */

const SIN_TERMINAL = { timeout: 5_000 };

test('sin terminal, preguntarOculto rechaza en vez de colgarse', SIN_TERMINAL, async () => {
  await assert.rejects(() => preguntarOculto('Pegá el token'), (fallo) => {
    // El mensaje nombra QUÉ se estaba pidiendo. «No hay terminal» a secas, en
    // medio de un build de quince minutos, no dice cuál de los tres prompts fue.
    assert.match(fallo.message, /pegá el token/i);
    return true;
  });
});

test('sin terminal, preguntar rechaza en vez de colgarse', SIN_TERMINAL, async () => {
  await assert.rejects(() => preguntar('Número'), /número/i);
});
