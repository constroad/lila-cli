/**
 * ¿La publicada es más nueva que la mía? PURO.
 *
 * Comparar por `!==` avisaría también cuando la local va ADELANTE — que es el
 * caso normal mientras se prepara un release, y un «hay una versión más nueva:
 * 0.5.0 (tenés 0.5.1)» se lee como un bug del CLI.
 *
 * Sin dependencias de semver: acá las versiones son `x.y.z` de números y nada
 * más. Un formato que no entienda devuelve `false`, que es el lado seguro — un
 * aviso de más molesta, uno de menos no rompe nada.
 */
const partes = (v) =>
  typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null;

export function hayVersionMasNueva(mia, publicada) {
  const a = partes(mia);
  const b = partes(publicada);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (b[i] !== a[i]) return b[i] > a[i];
  }
  return false;
}
