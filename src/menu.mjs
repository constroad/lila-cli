/**
 * El menú que aparece al escribir `lila` a secas.
 *
 * **Es el pedido explícito de José y resuelve un problema real**: un CLI que se
 * usa cada dos semanas es un CLI cuyas banderas nadie recuerda. Contestar «uso:
 * …» a secas obliga a leer una ayuda entera para recordar una palabra.
 *
 * Sigue el mismo orden que la guía de la consola, y por el mismo motivo: el
 * proceso se lee como un círculo hasta que alguien dice que la huella sale de la
 * keystore y no del APK.
 */
import { preguntar, rojo } from './consola.mjs';

const OPCIONES = [
  { etiqueta: 'Crear la keystore de una app', comando: 'keystore create <app>', pideApp: true, clave: 'keystore:create' },
  { etiqueta: 'Respaldar una keystore', comando: 'keystore backup <app>', pideApp: true, clave: 'keystore:backup' },
  { etiqueta: 'Verificar que un respaldo sirva', comando: 'keystore verify <app>', pideApp: true, clave: 'keystore:verify' },
  { etiqueta: 'Ver la huella (para el alta en la consola)', comando: 'keystore fingerprint <app>', pideApp: true, clave: 'keystore:fingerprint' },
  { etiqueta: 'Compilar y firmar el APK', comando: 'apk build', pideApp: false, clave: 'apk:build' },
  { etiqueta: 'Publicar el APK en LilaStore', comando: 'apk publish', pideApp: false, clave: 'apk:publish' },
  { etiqueta: 'Guardar el token de publicación', comando: 'login', pideApp: false, clave: 'login' },
];

export async function menu() {
  if (!process.stdin.isTTY) {
    // Sin terminal —un runner, un pipe— el menú no tiene sentido y quedarse
    // esperando una respuesta que no va a llegar cuelga el job.
    return rojo('`lila` sin argumentos abre un menú, y acá no hay terminal. Usá «lila ayuda».');
  }

  console.log('\nlila — apps Android de ConstRoad\n');
  console.log('El orden del proceso, de punta a punta:\n');
  OPCIONES.forEach((opcion, i) => {
    console.log(`  ${i + 1}. ${opcion.etiqueta}`);
    console.log(`     lila ${opcion.comando}`);
  });
  console.log('');

  const elegido = await preguntar('Número (Enter para salir)');
  if (!elegido) return 0;

  const opcion = OPCIONES[Number(elegido) - 1];
  if (!opcion) return rojo(`«${elegido}» no está en la lista.`);

  // El menú NO ejecuta: imprime el comando armado. Así la próxima vez se corre
  // directo, que es el objetivo — el menú es para recordar, no para reemplazar.
  const app = opcion.pideApp ? await preguntar('Nombre de la app (ej: timon)') : '';
  if (opcion.pideApp && !app) return rojo('Sin nombre de app no hay comando que armar.');

  console.log(`\n  lila ${opcion.comando.replace('<app>', app)}\n`);
  return 0;
}
