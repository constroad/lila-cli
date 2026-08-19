/**
 * Lo mínimo para hablarle a una persona en una terminal.
 *
 * Sin dependencias a propósito: este CLI corre en el runner de GitHub Actions de
 * cualquier repo, con `node` a secas. Cada paquete que sume es un paquete que
 * puede fallar al instalar justo cuando hay que publicar — y uno más en la
 * cadena de suministro de un proceso que tiene el token de publicación y la
 * keystore en el entorno.
 */
import { createInterface } from 'node:readline';

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
 * Pide algo sin mostrarlo mientras se tipea.
 *
 * Va contra `/dev/tty` y no contra stdin: así sigue funcionando cuando el CLI se
 * llama desde otro script con la entrada redirigida.
 */
export function preguntarOculto(prompt) {
  return new Promise((resolver, rechazar) => {
    if (!process.stdin.isTTY) {
      rechazar(new Error(`Hace falta ${prompt.toLowerCase()} y no hay terminal para pedirla.`));
      return;
    }
    const lectura = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(`${prompt}: `);

    // `_writeToOutput` vacío = no se dibuja lo tipeado. Es la forma de readline
    // de hacer un campo de contraseña; no hay una API pública para esto.
    lectura._writeToOutput = () => {};
    lectura.question('', (valor) => {
      lectura.close();
      process.stdout.write('\n');
      resolver(valor);
    });
  });
}

/** Pide algo visible — un número de menú, una ruta. */
export function preguntar(prompt) {
  return new Promise((resolver) => {
    const lectura = createInterface({ input: process.stdin, output: process.stdout });
    lectura.question(`${prompt}: `, (valor) => {
      lectura.close();
      resolver(valor.trim());
    });
  });
}

export const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
