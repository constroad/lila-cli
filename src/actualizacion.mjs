import { createRequire } from 'node:module';
import { aviso } from './consola.mjs';
import { hayVersionMasNueva } from './version.mjs';

/**
 * «Hay una versión más nueva del CLI».
 *
 * **Fijar la versión implica que nadie se entera solo**, y ese es el precio
 * correcto: un CLI que se actualiza entre dos corridas del mismo comando cambia
 * cómo se compila un binario que va a treinta teléfonos, sin dejar diff. Pero
 * había que compensarlo, y este es el compensador.
 *
 * Se llama en **dos momentos y ninguno más**:
 *
 * - `whoami`, que es el de «¿está todo bien?» y ya hace red.
 * - Cuando `apk publish` **falla**. Ahí es justo cuando importa saber si estás
 *   corriendo una versión vieja, y cuando nadie se acuerda de preguntarlo.
 *
 * En la publicación que sale bien, NO: sumaría una llamada al registry para
 * decir algo que no cambia lo que acaba de pasar, justo cuando la persona se va
 * a hacer otra cosa.
 *
 * **Nunca falla por esto.** Si el registry no contesta, o tarda, o devuelve algo
 * raro, no se dice nada: un rojo porque npm estaba lento haría dudar de lo único
 * que el comando vino a hacer.
 */
export const VERSION = createRequire(import.meta.url)('../package.json').version;

export async function avisarSiHayVersionNueva() {
  try {
    const control = new AbortController();
    const corte = setTimeout(() => control.abort(), 2_000);
    const r = await fetch('https://registry.npmjs.org/@constroad/lila-cli/latest', {
      signal: control.signal,
      headers: { accept: 'application/vnd.npm.install-v1+json' },
    });
    clearTimeout(corte);
    if (!r.ok) return;
    const { version } = await r.json();
    if (hayVersionMasNueva(VERSION, version)) {
      aviso(`Hay una versión más nueva del CLI: ${version} (estás con ${VERSION}).`);
      console.log('  Las versiones van FIJAS: subila donde esté declarada (ver el README).');
    }
  } catch {
    // Sin red, o npm lento. No es asunto de este comando.
  }
}
