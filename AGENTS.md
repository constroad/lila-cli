# lila-cli — reglas del repo

> Qué es y por qué existe: [`README.md`](README.md).
> Calidad de código: `/projects/QUALITY-CODE-SHORT.SPEC.md`.

## Lo que no se discute

**Cero dependencias.** Solo builtins de Node y `fetch`. Este CLI corre en el
runner de OTRO repo, donde no hay `node_modules` nuestros; y corre en la laptop
de alguien que no clonó nada. Una dependencia es un día en que no corre. Si algo
parece necesitar una librería, casi siempre es que el comando está haciendo de
más — ver la regla de abajo.

**Es un cliente, no un sistema.** Todo lo que hace tiene que existir como API en
el servicio correspondiente. Un comando con lógica de negocio propia es un
segundo sistema que se contradice con el primero, y el que pierde es el que nadie
está mirando.

**Sin paso de build.** Se publica el `.mjs` tal cual. Un CLI que exige
compilarse antes de correr es un CLI que un día no corre.

**Una bandera desconocida aborta.** `--canall=beta` mal tipeada no puede publicar
a `stable` en silencio. Es la diferencia entre un error y un incidente.

**Nada de secretos en el repo.** El token viaja por entorno o por el archivo de
credenciales del usuario (modo 600). Este repo es público.

**El metadata sale del BINARIO, y no lo lee este CLI.** Desde el 18/08/2026 el
servidor parsea el `AndroidManifest.xml` del APK que se sube: la versión, el
`versionCode`, el `package`, el `minSdk` y el `targetSdk` salen de ahí. `publish`
manda el archivo y el `sha256`, nada más. Esta regla decía lo contrario —que se
leyeran de `app.json`— y no alcanzaba: ahí no están `minSdk` ni `targetSdk`, y un
chequeo del lado del cliente lo saltea cualquiera que use `curl`.

**Las herramientas se RESUELVEN, no se heredan.** El entorno de quien corre esto
no es confiable, y los tres errores que costaron una tarde cada uno fueron eso:

- **El JDK.** Android Studio actualizó su JBR a 25 y Gradle empezó a morir en
  CMake con «A restricted method in java.lang.System has been called» (JEP 472).
  Se busca el 17 y se aborta con el `brew install` exacto.
- **El SDK.** Gradle falla con «SDK location not found», y ese mensaje manda a
  editar `local.properties`, que `expo prebuild` regenera.
- **`keytool` de `/usr/bin` en macOS es un stub** que responde «Unable to locate
  a Java Runtime». El bueno viene adentro de Android Studio.

**Los códigos de salida tampoco se creen.** LibreSSL —el `openssl` de macOS—
devuelve `0` ante un subcomando inválido: sin el `enc` adelante el cifrado
«funcionaba» y dejaba un archivo que no existía, y el error salía tres pasos
después como «el respaldo está corrupto». Se comprueba el efecto, no el status.

**Ninguna contraseña por `argv`.** Van por variable de entorno a `keytool`
(`-storepass:env`) y por stdin a `openssl` (`-pass stdin`). Un `-storepass
miClave` queda en el historial del shell y a la vista de `ps`.

## Estructura de comandos

Sustantivo y después verbo: `lila <área> <acción>`. Un área nueva no obliga a
renombrar nada de lo anterior. Las áreas de hoy: `keystore` y `apk`. Las
previstas: `torre`, `auth`, `store`.

Los comandos sueltos (`login`, `whoami`) son los transversales, y son pocos a
propósito.

## Salida

Cada paso se anuncia **antes** de tardar, no después: un `assembleRelease` son
dos minutos de silencio y sin eso parece colgado.

Un error dice **qué** falló y **qué hacer**, y nombra la variable o el archivo
concreto. «No autorizado» no es un mensaje; «el token venció el 3/9, generá otro
en /console/tokens» sí.

Nunca se imprime el token, ni entero ni parcial: esta salida termina en el log de
un runner que queda guardado.

## Comandos del repo

```bash
npm test          # node --test, sin dependencias
```

## Definition of done

- `npm test` en verde.
- El comando nuevo tiene su test del parser de argumentos: es donde aparecen los
  errores que llegan a producción, porque el resto es una llamada HTTP.
- El `README.md` lista el comando en la tabla y explica **por qué** existe si no
  es obvio.
- Probado corriéndolo como subproceso real, igual que lo haría el CI — no
  importando la función desde un test. Lo que toca disco, red o procesos se
  prueba contra una keystore descartable y contra el server local, no con mocks
  que confirman lo que uno ya creía.
