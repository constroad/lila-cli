/**
 * Dónde vive el token de publicación.
 *
 * **La variable de entorno GANA sobre el archivo.** Es lo que hace que el mismo
 * comando funcione sin cambios en un runner de GitHub Actions, donde no hay
 * `lila login` posible y el token llega como secret.
 *
 * El archivo existe para la otra mitad: una persona que publica cada dos
 * semanas y no quiere exportar una variable cada vez.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CARPETA = join(homedir(), '.config', 'lila-cli');
const ARCHIVO = join(CARPETA, 'credentials.json');

export const URL_POR_DEFECTO = 'https://lilastore.constroad.com';

/** El token a usar, y de dónde salió — el origen se imprime para que nadie se
 *  pregunte cuál de los dos ganó. */
export function tokenActual() {
  const delEntorno = process.env.LILASTORE_TOKEN;
  if (delEntorno) return { token: delEntorno, origen: 'LILASTORE_TOKEN' };

  if (!existsSync(ARCHIVO)) return { token: null, origen: null };
  try {
    const guardado = JSON.parse(readFileSync(ARCHIVO, 'utf8'));
    return guardado.token
      ? { token: guardado.token, origen: ARCHIVO, url: guardado.url ?? null }
      : { token: null, origen: null };
  } catch {
    // Un archivo corrupto no puede tumbar el comando: se ignora y se cae al
    // camino de «no hay token», que ya explica qué hacer.
    return { token: null, origen: null };
  }
}

export function guardarToken(token, url) {
  mkdirSync(CARPETA, { recursive: true });
  writeFileSync(ARCHIVO, `${JSON.stringify({ token, url }, null, 2)}\n`);
  // 600: es una credencial que publica código ejecutable a teléfonos ajenos.
  chmodSync(ARCHIVO, 0o600);
  return ARCHIVO;
}

export const rutaCredenciales = () => ARCHIVO;
