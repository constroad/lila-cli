/**
 * Dónde vive el token de publicación, y cuál se usa.
 *
 * **Un token por app** desde la 0.5.1. Antes había uno solo y `lila login` para
 * Timón pisaba en silencio el de LilaStore — las dos apps viven en la misma
 * laptop. Quién decide cuál usar es `tokens.mjs`, que es puro y tiene test; acá
 * solo está el disco.
 *
 * **La variable de entorno gana sobre el archivo.** Es lo que hace que el mismo
 * comando funcione sin cambios en un runner de GitHub Actions, donde no hay
 * `lila login` posible y el token llega como secret.
 *
 * El archivo existe para la otra mitad: una persona que publica cada dos
 * semanas y no quiere exportar una variable cada vez.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { elegirToken, guardarEnMapa, leerMapa } from './tokens.mjs';

const CARPETA = join(homedir(), '.config', 'lila-cli');
const ARCHIVO = join(CARPETA, 'credentials.json');

export const URL_POR_DEFECTO = 'https://lilastore.constroad.com';

function mapaGuardado() {
  if (!existsSync(ARCHIVO)) return leerMapa(null);
  try {
    return leerMapa(JSON.parse(readFileSync(ARCHIVO, 'utf8')));
  } catch {
    // Un archivo corrupto no puede tumbar el comando: se lee como vacío y el
    // camino de «no hay token» ya explica qué hacer.
    return leerMapa(null);
  }
}

/**
 * Qué app es este directorio, según su `app.json`.
 *
 * **El `slug` de Expo, no el nombre de la carpeta.** Es el mismo identificador
 * con el que la app está dada de alta en la tienda (verificado: `lilastore` y
 * `timon` coinciden), y una carpeta se renombra sin que nadie lo note.
 */
export function appDelDirectorio() {
  try {
    const slug = JSON.parse(readFileSync('app.json', 'utf8'))?.expo?.slug;
    return typeof slug === 'string' && slug ? slug : null;
  } catch {
    return null;
  }
}

/**
 * El token a usar, y de dónde salió — el origen se imprime para que nadie se
 * pregunte cuál de los dos ganó. `motivo` explica por qué NO hay, cuando no hay.
 */
export function tokenActual({ app } = {}) {
  return elegirToken({
    delEntorno: process.env.LILASTORE_TOKEN,
    guardado: mapaGuardado(),
    app: app ?? appDelDirectorio(),
  });
}

export function guardarToken(token, url, app) {
  mkdirSync(CARPETA, { recursive: true });
  const mapa = guardarEnMapa(mapaGuardado(), app, token, url);
  writeFileSync(ARCHIVO, `${JSON.stringify(mapa, null, 2)}\n`);
  // 600: es una credencial que publica código ejecutable a teléfonos ajenos.
  chmodSync(ARCHIVO, 0o600);
  return ARCHIVO;
}

export const rutaCredenciales = () => ARCHIVO;
