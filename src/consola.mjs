/**
 * Lo mínimo para hablarle a una persona en una terminal.
 *
 * Sin dependencias a propósito: este CLI corre en el runner de GitHub Actions de
 * cualquier repo, con `node` a secas. Cada paquete que sume es un paquete que
 * puede fallar al instalar justo cuando hay que publicar — y uno más en la
 * cadena de suministro de un proceso que tiene el token de publicación y la
 * keystore en el entorno.
 */
import { closeSync, openSync, writeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/** Los colores se apagan solos si la salida no es una terminal. */
const tty = process.stdout.isTTY === true;
const con = (codigo, texto) => (tty ? `[${codigo}m${texto}[0m` : texto);

/** Devuelven código de salida: `rojo` es 1, el resto 0. Así el comando hace `return rojo(...)`. */
export const rojo = (mensaje) => {
  process.stderr.write(`${con(31, '✗')} ${mensaje}\n`);
  return 1;
};
export const verde = (mensaje) => {
  process.stdout.write(`${con(32, '✓')} ${mensaje}\n`);
  return 0;
};
export const aviso = (mensaje) => {
  process.stdout.write(`${con(33, '!')} ${mensaje}\n`);
  return 0;
};
export const tenue = (mensaje) => process.stdout.write(`${con(2, mensaje)}\n`);

/**
 * Leer una línea de la TERMINAL, en modo síncrono.
 *
 * **Por qué no `readline` (19/08/2026).** `lila login` colgaba sin leer nada y
 * salía con «Detected unsettled top-level await»: readline con `terminal: true`
 * borra la línea con secuencias ANSI —así que el prompt desaparece— y su
 * `question()` nunca disparaba el callback, dejando la promesa viva mientras el
 * event loop se vaciaba. El síntoma no se parece a la causa: parece que el CLI
 * no pide nada, cuando en realidad está esperando para siempre.
 *
 * Síncrono y contra `/dev/tty`, que además es lo que la versión anterior decía
 * hacer en su comentario y no hacía:
 *
 * - **Síncrono no puede colgar el event loop**, porque no lo usa. La clase de
 *   bug de arriba deja de poder existir.
 * - **`/dev/tty` y no `stdin`** para que siga funcionando cuando el CLI se llama
 *   desde otro script con la entrada redirigida — que es exactamente cómo lo
 *   invoca `build-apk.sh`.
 *
 * Sin dependencias, como todo este archivo: `stty` viene con el sistema y este
 * CLI ya asume un Unix con `keytool` y `gradle` al lado.
 */
function leerDeLaTerminal(prompt, { oculto }) {
  let fd;
  try {
    // `r+`: el MISMO descriptor sirve para escribir el prompt y para leer. Con
    // dos, el prompt puede salir después de la respuesta por el buffer de salida.
    fd = openSync('/dev/tty', 'r+');
  } catch {
    // El mensaje NO interpola el prompt: es un imperativo («Pegá el token») y
    // metido en un hueco de sustantivo daba «Hace falta pegá el token y no hay
    // terminal para pedirla». Además dice la SALIDA, que es lo que hace falta
    // cuando esto pasa: en CI o en un script no hay terminal, y el token va por
    // variable de entorno.
    // Se NOMBRA lo que se estaba pidiendo —en medio de un build largo, «no hay
    // terminal» a secas no dice cuál de los prompts fue— pero entre comillas y
    // no interpolado en la frase: «Hace falta pegá el token y no hay terminal
    // para pedirla» era lo que salía antes, con el imperativo metido en un
    // hueco de sustantivo.
    //
    // Y se dice la SALIDA, que es lo que hace falta cuando esto pasa.
    throw new Error(
      `No se pudo pedir «${prompt}»: este paso necesita una terminal y acá no hay.\n` +
        '  En CI o en un script, pasá el token por entorno: LILASTORE_TOKEN=lsp_…'
    );
  }

  const stty = (args) =>
    execFileSync('stty', args, { stdio: [fd, 'pipe', 'ignore'] }).toString().trim();

  // El estado del terminal ANTES de tocarlo, para devolverlo tal cual. `stty -g`
  // lo serializa entero: restaurar «lo que había» es más seguro que acordarse de
  // apagar cada bandera que se encendió.
  let estadoPrevio = null;
  const restaurar = () => {
    if (estadoPrevio === null) return;
    try {
      stty([estadoPrevio]);
    } catch {
      // El terminal ya no está. No hay nada que restaurar ni a quién avisarle.
    }
    estadoPrevio = null;
  };

  // **Ctrl-C: quién bloquea y quién escucha tienen que ser procesos distintos.**
  //
  // Dos intentos fallaron antes de este (19/08/2026):
  //
  // 1. `readSync` sobre el tty + handler de SIGINT en Node. El `readSync` bloquea
  //    el hilo y no lo desbloquea una señal, así que el handler no podía correr;
  //    y tenerlo registrado le quitaba a SIGINT su efecto por defecto. Ctrl-C no
  //    hacía nada y la única salida era cerrar la terminal.
  // 2. Delegar en `sh` con `trap "stty echo" EXIT INT`. El `sh` sí muere con la
  //    señal, pero el trap no llegó a devolver el eco — medido: quedaba apagado,
  //    o sea la terminal muda después de cortar.
  //
  // Lo que sí funciona: **`sh` bloquea, Node escucha.** El hijo se lleva la
  // señal y muere, `execFileSync` devuelve el control, y recién ahí Node procesa
  // la SIGINT pendiente. El handler existe solo para que Node NO se muera en ese
  // instante — la limpieza la hace el `finally`, que es el único lugar por el que
  // se pasa siempre.
  let interrumpido = false;
  const alInterrumpir = () => {
    interrumpido = true;
  };

  try {
    if (oculto) {
      try {
        estadoPrevio = stty(['-g']);
        stty(['-echo']);
      } catch {
        // Sin `stty` no se puede apagar el eco. **Se aborta**: seguir dejaría el
        // token escrito a la vista y en el scrollback de la terminal.
        throw new Error(
          `No pude apagar el eco de la terminal, y ${prompt.toLowerCase()} quedaría a la vista.`
        );
      }
    }

    process.on('SIGINT', alInterrumpir);
    writeSync(fd, `${prompt}: `);

    // El valor vuelve por una TUBERÍA, nunca por argumentos: lo que va en argv lo
    // ve cualquiera con un `ps`, y acá lo que se lee es un token de publicación.
    try {
      return execFileSync('/bin/sh', ['-c', 'IFS= read -r linea; printf "%s" "$linea"'], {
        stdio: [fd, 'pipe', 'ignore'],
        // Un token entra de sobra; el tope evita que una tubería trabada crezca
        // sin límite.
        maxBuffer: 1024 * 1024,
      }).toString('utf8');
    } catch (fallo) {
      if (interrumpido || fallo.signal === 'SIGINT' || fallo.status === 130) {
        interrumpido = true;
        // No se lanza: salir se hace en el `finally`, DESPUÉS de devolver el eco.
        return '';
      }
      // `read` devuelve distinto de cero cuando la entrada se cerró sin línea.
      // **Es un error explícito y no una cadena vacía**: devolver '' haría que el
      // comando siguiente diga «no pegaste nada» cuando lo cierto es que nadie
      // pudo pegar nada.
      throw new Error(`No llegó ${prompt.toLowerCase()}: se cerró la entrada.`);
    }
  } finally {
    process.off('SIGINT', alInterrumpir);
    restaurar();
    if (oculto) {
      // El salto que el eco apagado se tragó: sin esto la respuesta siguiente se
      // imprime pegada al prompt.
      try {
        writeSync(fd, '\n');
      } catch {
        // La terminal ya no está.
      }
    }
    closeSync(fd);
    // Al final de la limpieza, no antes: 130 es lo que se espera de un proceso
    // cortado con Ctrl-C, y sale sin traza — una pila de Node sobre un «me
    // arrepentí» hace dudar de si algo se rompió.
    if (interrumpido) process.exit(130);
  }
}

/**
 * Pide algo sin mostrarlo mientras se tipea: un token, la clave de la keystore.
 *
 * Devuelve una promesa aunque por dentro sea síncrono: es lo que esperan los
 * comandos que la usan, y cambiarlos a todos no aporta nada.
 */
export function preguntarOculto(prompt) {
  return new Promise((resolver, rechazar) => {
    try {
      resolver(leerDeLaTerminal(prompt, { oculto: true }));
    } catch (fallo) {
      rechazar(fallo);
    }
  });
}

/** Pide algo visible — un número de menú, una ruta. */
export function preguntar(prompt) {
  return new Promise((resolver, rechazar) => {
    try {
      resolver(leerDeLaTerminal(prompt, { oculto: false }).trim());
    } catch (fallo) {
      rechazar(fallo);
    }
  });
}

export const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
