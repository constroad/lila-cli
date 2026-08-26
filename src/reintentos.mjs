/**
 * Reintentar una subida que no llegó — y solo esa.
 *
 * Subir ~36 MB con `fetch` falla de vez en cuando con «fetch failed» y funciona
 * al reintentar sin cambiar nada (25/08/2026). Se verificó que tras un fallo así
 * el catálogo NO queda con la versión publicada, así que reintentar es seguro:
 * no hay riesgo de publicar dos veces.
 *
 * **La distinción que importa:** un fallo de RED es un intento que no llegó; una
 * RESPUESTA del server —409 firma distinta, 422 manifiesto ilegible, 401— es una
 * decisión tomada. Repetirla no la cambia: solo sube 36 MB tres veces y esconde
 * el motivo detrás de tres intentos idénticos.
 */

/** Tres intentos en total: dos reintentos. Más es tapar un problema, no sortearlo. */
export const INTENTOS = 3;

const BASE_MS = 1500;
const TECHO_MS = 8000;

export function sePuedeReintentar({ intento, maximo, fueRespuesta }) {
  if (fueRespuesta) return false;
  return intento < maximo;
}

/** Espera creciente con techo: 1.5 s, 3 s, 6 s… y nunca más de 8. */
export function esperaDelIntento(intento) {
  return Math.min(BASE_MS * 2 ** (intento - 1), TECHO_MS);
}

export const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
