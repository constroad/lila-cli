/**
 * Las URLs que van a quedar horneadas en el APK. PURO.
 *
 * **Dos incidentes distintos, la misma causa: nadie miró lo que quedó adentro.**
 *
 * 1. Un release compilado con el `.env` de desarrollo salió apuntando a
 *    `10.0.2.2` —como el emulador ve a la Mac—, se instaló perfecto y falló en
 *    la mano del chofer con «Sin conexión» y el wifi andando. El mensaje es
 *    honesto y acusa al lugar equivocado.
 * 2. El script de Timón declaraba DOS URLs (el Portal y la tienda) y el CLI
 *    verificaba solo la primera: la segunda se compilaba sin que nadie
 *    comprobara nada.
 *
 * Por eso son dos preguntas separadas y las dos se hacen: **cuáles se declararon
 * todas**, y **cuáles le sirven a un teléfono ajeno**.
 */

/**
 * Las `EXPO_PUBLIC_*` que son URLs. Todas, no la primera.
 *
 * Solo esas: una variable que no empiece así no la hornea Expo, así que buscarla
 * dentro del APK fallaría sobre algo que nunca debió estar ahí.
 */
export function urlsDeclaradas(env) {
  return Object.entries(env ?? {}).filter(
    ([clave, valor]) => clave.startsWith('EXPO_PUBLIC_') && /^https?:\/\//.test(String(valor))
  );
}

/** Los rangos que solo existen dentro de una red, y no en la de un chofer. */
const PRIVADA = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  // 172.16–172.31, no 172.0–172.255: rechazar de más bloquearía un release
  // legítimo por una regla escrita a ojo.
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
];

/**
 * ¿Esta URL le sirve al teléfono de otra persona?
 *
 * **Tailscale es el caso peligroso**, y por eso está: el host existe y responde
 * desde esta máquina, así que todo el build sale verde. Lo que queda mal es lo
 * que se guardó adentro del binario, y se descubre en el teléfono de un tercero.
 */
export function sirveAUnTelefono(url) {
  let host;
  let protocolo;
  try {
    const parseada = new URL(String(url));
    host = parseada.hostname.toLowerCase();
    protocolo = parseada.protocol;
  } catch {
    return false;
  }

  // Android bloquea el tráfico en claro en release desde el API 28: el APK
  // compila, se instala, y cada request falla sin decir por qué.
  if (protocolo !== 'https:') return false;

  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (host.endsWith('.ts.net')) return false;
  return !PRIVADA.some((rango) => rango.test(host));
}
