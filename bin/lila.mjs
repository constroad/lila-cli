#!/usr/bin/env node
/**
 * `lila` — keystores, builds y publicación de las apps Android de ConstRoad.
 *
 * **Sin dependencias y sin paso de build.** Corre en el runner de GitHub Actions
 * de OTRO repo, donde no hay `node_modules` de nada ni TypeScript. Un CLI que
 * exige compilarse es un CLI que un día no corre — y es un paquete más en la
 * cadena de suministro de un job que tiene el token de publicación y la keystore
 * en el entorno.
 *
 * **Es un cliente de las APIs que ya existen, nunca una segunda
 * implementación.** Un comando que hace algo que la consola no puede hacer es
 * una API que falta, no lógica que vive acá. Si el CLI empieza a tener reglas de
 * negocio propias, hay dos sistemas que se contradicen y el síntoma aparece en
 * el teléfono de alguien.
 */
import { createRequire } from 'node:module';
import { parseArgs, USO } from '../src/args.mjs';
import { crear, respaldar, verificar, huella } from '../src/keystore.mjs';
import { build } from '../src/build.mjs';
import { publish } from '../src/publish.mjs';
import { subirIcono } from '../src/icono.mjs';
import { login, whoami } from '../src/sesion.mjs';
import { menu } from '../src/menu.mjs';

/** La versión propia, del `package.json` de al lado. No se escribe a mano. */
const VERSION = createRequire(import.meta.url)('../package.json').version;

const { error, comando, opciones } = parseArgs(process.argv.slice(2));

if (error) {
  process.stderr.write(`${error}\n`);
  process.exit(1);
}

const comandos = {
  menu: () => menu(),
  ayuda: () => {
    console.log(USO);
    return 0;
  },
  version: () => {
    console.log(VERSION);
    return 0;
  },
  login: () => login(opciones),
  whoami: () => whoami(opciones),
  'keystore:create': () => crear(opciones.app, opciones),
  'keystore:backup': () => respaldar(opciones.app, opciones),
  'keystore:verify': () => verificar(opciones.app, opciones),
  'keystore:fingerprint': () => huella(opciones.app),
  'apk:build': () => build(opciones),
  'apk:publish': () => publish(opciones),
  'app:icon': () => subirIcono(opciones.app, opciones.archivo, opciones),
};

const ejecutar = comandos[comando];
if (!ejecutar) {
  process.stderr.write(`${USO}\n`);
  process.exit(1);
}

// Todos devuelven código de salida: 0 bien, 1 mal. Un CLI que siempre sale 0
// hace que un `&&` en un workflow siga adelante después de fallar.
process.exit((await ejecutar()) ?? 0);
