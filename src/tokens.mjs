/**
 * Qué token usar cuando hay más de una app en la misma máquina. PURO — sin
 * filesystem, sin `process`.
 *
 * **El problema que resuelve (20/08/2026).** Hasta la 0.5.0 el archivo de
 * credenciales guardaba UNO: `{token, url}`. Hacer `lila login` para Timón
 * pisaba en silencio el de LilaStore, y las dos apps viven en la misma laptop.
 *
 * Lo peor no era perderlo, era cómo se manifestaba. Publicar con el token de
 * otra app devuelve **el mismo `401 Token de publicación inválido`** que un
 * token vencido o revocado — el server no los distingue a propósito, para que
 * nadie pueda enumerar qué tokens existen. Así que el síntoma es
 * indistinguible de «caducó», y quien lo sufre genera otro token, que tampoco
 * anda porque el problema nunca fue ese.
 *
 * La regla: **con la app conocida, no se cae al token de otra.** Es mejor decir
 * «no tenés token para timon» que mandar uno que va a fallar sin explicar.
 */

/** El archivo, en cualquiera de sus dos formatos, normalizado a un mapa. */
export function leerMapa(crudo) {
  if (crudo === null || typeof crudo !== 'object') return { version: 2, tokens: {} };

  // Formato 0.4.0: `{token, url}`, sin app. Se conserva bajo la clave vacía —
  // sirve para cualquier repo porque no hay forma de saber de quién era, y
  // obligar a volver a hacer login por un cambio de formato sería gratuito.
  if (typeof crudo.token === 'string' && crudo.token) {
    return { version: 2, tokens: { '': { token: crudo.token, url: crudo.url ?? null } } };
  }

  const tokens = crudo.tokens;
  if (tokens === null || typeof tokens !== 'object' || Array.isArray(tokens)) {
    return { version: 2, tokens: {} };
  }
  return { version: 2, tokens };
}

/**
 * **El legado NO se borra al guardar el primero con nombre.**
 *
 * Sería lo prolijo y rompería a quien lo tenía funcionando: el token de la
 * 0.4.0 es el que hoy publica TODAS las apps de esa máquina, y hacer login para
 * una sola dejaría a las otras sin nada, sin que nadie lo pidiera. Se conserva
 * y se usa como último recurso, avisando; desaparece solo cuando alguien hace
 * login en ese repo.
 */
export function guardarEnMapa(mapa, app, token, url) {
  return { version: 2, tokens: { ...mapa.tokens, [app]: { token, url } } };
}

const nombres = (tokens) => Object.keys(tokens).filter(Boolean).sort();

export function elegirToken({ delEntorno, guardado, app }) {
  // Gana siempre: es lo que hace que el mismo comando funcione en un runner,
  // donde no hay `login` posible. Una cadena vacía —un secret mal cargado— NO
  // cuenta, o el fallo llega como 401 en vez de «falta el secret».
  if (typeof delEntorno === 'string' && delEntorno !== '') {
    return { token: delEntorno, origen: 'LILASTORE_TOKEN', app: null, url: null, motivo: null };
  }

  const { tokens } = guardado;
  const conNombre = nombres(tokens);
  const legado = tokens[''];

  if (app && tokens[app]) {
    return { token: tokens[app].token, origen: `guardado (${app})`, app, url: tokens[app].url, motivo: null };
  }

  // El legado: de app desconocida, guardado antes de que esto existiera. Se usa
  // cuando no hay uno propio, porque es lo que venía funcionando — pero se
  // AVISA, o el 401 de un token que resulta ser de otra app llega disfrazado de
  // «caducó» y manda a generar uno nuevo que tampoco va a andar.
  if (legado) {
    return {
      token: legado.token,
      origen: 'guardado (sin app)',
      app: null,
      url: legado.url,
      motivo: null,
      aviso: app
        ? `Este token se guardó antes de que el CLI separara por app, así que no sé si es de «${app}». Si falla con 401, corré «lila login» acá adentro.`
        : null,
    };
  }

  if (app) {
    return {
      token: null,
      origen: null,
      app: null,
      url: null,
      motivo:
        conNombre.length === 0
          ? `No hay token guardado. Corré «lila login» dentro de ${app}, o exportá LILASTORE_TOKEN.`
          : `No hay token para «${app}». Tenés de: ${conNombre.join(', ')}. Corré «lila login» acá adentro.`,
    };
  }

  if (conNombre.length === 1) {
    const solo = conNombre[0];
    return { token: tokens[solo].token, origen: `guardado (${solo})`, app: solo, url: tokens[solo].url, motivo: null };
  }

  return {
    token: null,
    origen: null,
    app: null,
    url: null,
    motivo:
      conNombre.length === 0
        ? 'No hay token guardado. Corré «lila login», o exportá LILASTORE_TOKEN.'
        : `Tenés tokens de ${conNombre.join(', ')} y no sé cuál usar: corré esto dentro del repo de la app, o exportá LILASTORE_TOKEN.`,
  };
}
