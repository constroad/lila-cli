# lila-cli

La herramienta de línea de comandos de ConstRoad. Hoy cubre el ciclo de vida de
una app Android —la keystore con la que se firma, el build, y la publicación en
[LilaStore](https://lilastore.constroad.com)— y está armada para que mañana haga
más sin renombrar nada de lo de hoy.

```bash
npx @constroad/lila-cli
```

---

## Por qué existe este repo y no vive dentro de `lilastore`

El CLI **nació** adentro de `constroad/lilastore` (`bin/lilastore.mjs`), y ahí no
se podía usar. Tres razones concretas, las tres verificadas el 18/08/2026:

1. `package.json` de lilastore es `private: true` y sin campo `files`: `npx
   lilastore` no resuelve porque no hay nada publicado en npm.
2. `npx github:constroad/lilastore` tampoco: ese repo es **privado**, así que
   `npx` no se autentica — y arrastraría el Next entero con sus 16 dependencias
   y los 34 PNG de diseño para correr un archivo de 200 líneas.
3. `bin/lilastore.mjs` importa `../src/cli/args.mjs`, así que empaquetarlo
   obligaba a publicar medio Next.

O sea: el `npx lilastore publish` que documentaban los specs **no funcionaba**.
Un CLI cuyo propósito es correr en el CI de OTROS repos tiene que poder
instalarse desde afuera, y para eso tiene que ser su propio paquete.

**Este repo es público a propósito.** El CLI no lleva ningún secreto adentro: el
secreto es el token de publicación, que viaja por variable de entorno o por el
archivo de credenciales de quien lo usa. Un paquete privado en npm se cobra por
usuario y no compraría nada.

---

## Instalación

No hace falta instalarlo. **A mano, sin versión** — `npx` resuelve `latest` en
cada corrida, así que siempre corrés lo último sin acordarte de nada:

```bash
npx @constroad/lila-cli apk publish
```

Para usarlo seguido, `npm i -g @constroad/lila-cli` y queda como `lila` (pero
ojo: instalado global **no se actualiza solo**, hace falta `npm update -g`).

**En un script de release o en CI va con la versión fija.** No es una
incoherencia con lo de arriba, son dos necesidades distintas:

| | Versión | Por qué |
| --- | --- | --- |
| A mano, la doc, el asistente de la consola | **sin fijar** | Un comando escrito con número envejece: instala una vieja y encima se ve autorizado. Nadie actualiza la doc en cada release. |
| `scripts/build-apk.sh`, el workflow de Actions | **fija** | Un release tiene que poder repetirse dentro de un año y dar el mismo binario. Subirla deja un diff que alguien revisa. |

**Lo que reproduce, fija; lo que enseña, no.**

> **`npx` no funciona desde ESTE repo**, y no es un bug del paquete: adentro de
> `lila-cli/` npx ve el `package.json` local que declara el bin `lila`, asume que
> lo provee el proyecto y busca `node_modules/.bin/lila`, que no existe porque no
> hay dependencias que instalar. Da `sh: lila: command not found`. Desde
> cualquier otra carpeta anda. Para desarrollar acá: `npm link`.

Requiere **Node 20 o mayor**. No tiene dependencias: solo builtins y `fetch`.
Eso también es a propósito — corre en el runner de otro repo, donde no hay
`node_modules` de nada nuestro, y un CLI que exige compilarse es un CLI que un
día no corre.

---

## Autenticación

Dos caminos que resuelven el mismo problema para dos usuarios distintos.

**En el CI**, la variable de entorno:

```yaml
- run: npx @constroad/lila-cli apk publish
  env:
    LILASTORE_TOKEN: ${{ secrets.LILASTORE_TOKEN }}
```

**En una laptop**, una vez y no se vuelve a tocar:

```bash
lila login          # pide el token y lo guarda en ~/.config/lila-cli/ (modo 600)
lila whoami         # a qué app publica y cuándo vence
```

La variable de entorno **gana** sobre el archivo guardado. Es lo que hace que el
mismo comando funcione sin cambios en un runner, donde no hay `login` posible.

### De dónde sale el token, y qué puede hacer

Se crea en la consola de LilaStore, en **Tokens de publicación**, y se muestra
**una sola vez**: en la base queda hasheado.

Un token está atado a **una** app. Eso no es una limitación, es el diseño: el
servidor no acepta que le digan a qué app subir — busca el token, saca su app y
esa es. Un token filtrado del repo de Timón compromete Timón y nada más. Y ni
siquiera eso alcanza para publicar algo malicioso: la firma del APK se compara
contra la que quedó fijada al dar de alta la app, así que hace falta además la
keystore.

**Un repo, un secret, una app.**

### Varias apps en la misma máquina

`lila login` guarda el token **bajo el nombre de la app**, no en un único
espacio: tener Timón y LilaStore en la misma laptop ya no se pisan. Hasta la
0.5.0 se guardaba uno solo y hacer login para una borraba en silencio el de la
otra — y el fallo llegaba disfrazado, porque publicar con el token de otra app
devuelve **el mismo `401` que un token vencido**. El server no los distingue a
propósito, así que quien lo sufría creía que había caducado y generaba otro, que
tampoco andaba.

Cuál se usa lo decide el **directorio**: el CLI lee `expo.slug` de `app.json` y
busca el de esa app. Por eso todos los comandos se corren dentro del repo.

- Con la app conocida y sin token para ELLA, **no se cae al de otra**: lo dice y
  nombra los que sí tenés.
- Desde una carpeta cualquiera, si hay uno solo lo usa; si hay varios pide que
  te pares en el repo o exportes `LILASTORE_TOKEN`.
- Un token guardado con la 0.4.0 no tiene app conocida. Se conserva y se sigue
  usando —borrarlo dejaría sin publicar a quien lo tenía andando— pero avisa que
  no sabe de quién es.

---

## Comandos

Sustantivo y después verbo. No es estética: es lo que permite sumar un área nueva
sin renombrar lo que ya existe.

```
lila                              menú interactivo
lila login                        guarda el token
lila whoami                       a qué app publica este token y cuándo vence

lila keystore create <app>         genera la keystore de producción
lila keystore backup <app>     copia cifrada + verifica que restaure
lila keystore verify <app>     confirma que el respaldo sigue sirviendo
lila keystore fingerprint <app>        la huella sha256, para el alta en la consola

lila apk build                    compila y firma
lila apk publish [ruta]           sube; sin ruta busca en dist/
```

**Todavía no existen**, y se listan para que nadie los busque: `apk check`
(¿el versionCode supera al vigente?, antes de compilar), `apk promote`, `apk
withdraw` y `apk list`. Los tres últimos necesitan endpoints que el servidor no
expone — son APIs que faltan, no comandos que falten acá. Lo mismo `whoami`, que
hoy contesta a medias porque `GET /api/v1/token` no existe.

Lo que venga después entra como área nueva sin tocar lo anterior: `lila torre
deploy`, `lila auth keys`, `lila store devices`.

**El menú interactivo** se abre al llamarlo sin argumentos, y no es un adorno:
esta herramienta se usa cada dos semanas y nadie recuerda las banderas de algo
que corrió por última vez hace quince días.

### `apk publish` no declara nada

La versión, el `versionCode` y el `package` **los lee el servidor del
`AndroidManifest.xml`** del binario que se sube. El CLI solo manda el archivo y
el `sha256`.

Este apartado decía otra cosa hasta el 18/08/2026 —que el CLI los leyera de
`app.json`— y esa solución no alcanzaba, por dos razones que aparecieron al
implementarla:

1. `app.json` **no tiene** `minSdk` ni `targetSdk`: los pone el `prebuild` de
   Expo, en una carpeta que está gitignoreada.
2. Un chequeo del lado del cliente lo saltea cualquiera que no use el cliente.
   `curl` publicaba igual, declarando lo que quisiera.

El agujero que cerraba era real: se podía publicar un APK que dice 10 declarando
11, el teléfono instalaba, seguía reportando la vieja, y la tienda le ofrecía
actualizar para siempre. Se cerró **en el servidor**, que ahora lee el manifest y
rechaza con `422 metadata_no_coincide` si lo declarado no coincide.

Las banderas `--version`, `--version-code` y `--package` siguen aceptándose como
chequeo cruzado, pero el camino normal es no pasarlas.

### La keystore va primero, y no hace falta compilar para dar de alta

El proceso se lee como un círculo —«necesito la huella para dar de alta, el APK
para la huella, y el alta para publicar el APK»— y no lo es: **la huella sale de
la keystore**, que se crea antes que todo lo demás.

```bash
lila keystore create timon --generated-key   # 1. el sello con el que se firma
lila keystore fingerprint timon              # 2. la huella, para el alta
#                                              3. dar de alta en /console/apps/new
lila login                                   # 4. el token de publicación
lila apk build && lila apk publish           # 5.
```

**Usá `--generated-key`.** Genera una contraseña de 32 bytes al azar, la deja en
`~/.gradle/gradle.properties` para que Gradle la lea sola, **y hace el respaldo a
continuación** — por eso el paso de `backup` no aparece arriba: ya corrió. Sin la
bandera, la contraseña la escribís vos y el respaldo queda pendiente.

Los datos del certificado —nombre, organización, ciudad— **no se preguntan**:
son la identidad de la empresa y salen de una constante. Hasta la 0.6.0 el
camino interactivo dejaba que `keytool` los pidiera, y con todo en blanco su
confirmación por defecto es «no»: volvía a preguntar **para siempre**, sin más
salida que Ctrl-C.

### El paso que falta en casi todas las apps: la firma de release

`android/` lo regenera `expo prebuild`, y su plantilla deja
`release { signingConfig signingConfigs.debug }`. O sea que **declarar la
keystore en `gradle.properties` no alcanza**: el APK sale firmado con la de
debug, se instala perfecto, y el problema aparece el día del primer release de
verdad — Android rechaza la actualización y hay que desinstalar en todos los
teléfonos.

La solución es un plugin de Expo que reescribe ese bloque en cada prebuild.
Copiá `plugins/withReleaseSigning.js` de LilaStore o de Lilachat, cambiá el
prefijo, y agregalo a `plugins` en `app.json`. `lila apk build` verifica la firma
antes de empaquetar y **se niega a seguir** si quedó la de debug: esa guarda
existe porque este error no se ve mirando el APK.

### La versión vive en `app.json`

`expo.version` y `expo.android.versionCode`. Editar `android/app/build.gradle`
**no cambia nada** —`prebuild` lo regenera— y el APK sale con la versión vieja
aunque el nombre del archivo diga otra. Antes de publicar:

```bash
aapt2 dump badging dist/<app>-<version>-<code>.apk | head -1
```

**El token no va adentro del APK.** Es la credencial para *subir* a la tienda, no
algo que la app use. Si viajara en el binario, cualquiera que lo descomprima
podría publicar releases de esa app.

**Un respaldo que nadie probó no es un respaldo.** `keystore backup` descifra
lo que acaba de escribir y compara la huella del certificado restaurado contra la
del original.

**Y una copia sola no es un respaldo tampoco.** El original y la copia por
defecto viven en el MISMO disco: uno que se rompe se lleva los dos. `--a` se
repite, y **cada copia se verifica de verdad** — que el archivo exista no
alcanza, se comprueba que restaure la misma clave.

```bash
lila keystore backup timon --to=/Volumes/USB/timon.enc --to=~/Drive/timon.enc
lila keystore verify timon --to=/Volumes/USB/timon.enc   # ¿sigue sirviendo?
```

Sin `--a`, el comando avisa que hay una sola copia. `verificar` sale con código 1
si falta una o está corrupta, así que se puede poner en un recordatorio.

### Las tres guardas del build

Salen de errores que ya pasaron, no de una lista de buenas prácticas:

1. **JDK 17.** Con el 21+ Gradle muere en CMake con «A restricted method in
   java.lang.System has been called» — la restricción de acceso nativo de JDK 24
   (JEP 472). Pasó el 18/08/2026 sin que nadie tocara nada: Android Studio
   actualizó su JBR a 25. El JDK y el SDK **se resuelven acá**, no se heredan.
2. **Firma de debug con `--signing=release` aborta.** Y si `apksigner` no puede
   leer la firma, también: una guarda que no puede fallar es peor que no tenerla.
3. **La URL de release tiene que estar adentro del binario.** Se comprueba que la
   declarada **esté**, no que no estén `10.0.2.2` o `localhost`. La lista negra
   parece lo obvio y **no sirve**: los dos APK de Timón que hoy andan en los
   teléfonos contienen las tres cadenas, porque el dev-support de React Native se
   empaqueta igual en release. Medido antes de creerlo.

Por eso el repo de cada app declara su URL de release en `lila.json`, versionado
y revisable en un PR:

```json
{ "build": { "env": { "EXPO_PUBLIC_API_URL": "https://www.constroad.com" } } }
```

---

## La regla que mantiene esto sano

**`lila-cli` es un cliente de las APIs que ya existen. Nunca una segunda
implementación.**

Y la simétrica, que costó lo mismo: **un repo de app no reimplementa lo que hace
el CLI.** El 20/08/2026 `lilastore-app` tenía 170 líneas y `timon` 294 haciendo
lo mismo que `apk build` — elegir el JDK, correr Gradle, verificar la firma,
buscar la URL en el bundle. Cada arreglo había que hacerlo tres veces, y cuando
divergieron el resultado fue una publicación que se vio verde sin subir nada.
Ahora los dos son envoltorios: llaman al CLI y le suman lo suyo (el `--bump` de
Timón, a qué tienda subir). 464 líneas → 177.

Un comando que hace algo que la consola no puede hacer es una API que falta, no
lógica que vive acá. El día que el CLI tenga reglas de negocio propias hay dos
sistemas que se contradicen, y el que pierde es el que no se está mirando.

Viene de un caso real y del mismo mes: la pregunta «¿está sana esta app?» estaba
contestada en cinco lugares de Torre con tres criterios distintos, y el resultado
fue un panel que mostraba «Sin responder» de una aplicación que funcionaba
perfecto. Dos formas de publicar se desincronizan igual — solo que el síntoma
aparece en el teléfono de otra persona.

---

## Dónde se compila

**En GitHub Actions, no en la Mac mini.** Un build de Gradle es lo más pesado del
workspace y la mini corre cinco servicios en 8 GB; ya hubo un OOM con el build de
Portal que pareció un cuelgue de 38 minutos. La mini no tiene ni el SDK de
Android instalado, y así se queda.

Cuando lo corrés vos desde tu máquina **es el mismo comando**: no es un segundo
camino, es el mismo con otro operador. Actions es el operador normal; la laptop
es para cuando el CI está caído.

---

## Los nombres son todos en inglés (0.5.0)

Hasta la 0.4.0 el CLI mezclaba idiomas: `keystore crear` al lado de `apk build`,
`--obligar` al lado de `--channel`. Quien lo usa tiene que acordarse de cuál
palabra va en cuál idioma, y eso es memoria gastada en nada.

| Antes | Ahora |
| --- | --- |
| `keystore crear` | `keystore create` |
| `keystore respaldar` | `keystore backup` |
| `keystore verificar` | `keystore verify` |
| `keystore huella` | `keystore fingerprint` |
| `--obligar` | `--enforce` |
| `--seco` | `--dry-run` |
| `--firma=` | `--signing=` |
| `--salida=` | `--out=` |
| `--a=` | `--to=` |
| `--clave-generada` | `--generated-key` |

Los nombres viejos **no funcionan**, pero tampoco dan «no existe» a secas:
dicen cómo se llama ahora. Están escritos en specs, en este README y en el
historial de la terminal de quien los usó, y un error genérico manda a leer el
`--help` para descubrir que lo único que cambió es el idioma.

Los **mensajes** siguen en español, como el resto del workspace. Lo que se
unificó es la superficie que se teclea.

---

## Publicar este CLI a npm

Quien usa el CLI **nunca corre la copia de este repo**: corre la publicada. Es la
misma versión que ejecuta el runner de GitHub Actions, y esa es toda la gracia —
lo que probás en la laptop es lo que va a correr en CI. Un alias que apunte a
`bin/lila.mjs` rompe esa garantía sin avisar.

**Los dos comandos se corren en la raíz de ESTE repo** (`lila-cli/`), que es
donde está el `package.json` que se publica. Desde otra carpeta, `npm publish`
sube lo que sea que haya ahí.

Una vez por máquina:

```bash
npm login
```

Cada release del CLI, con la versión ya subida en `package.json` y los tests en
verde:

```bash
npm publish --access public
```

Con 2FA en la cuenta, npm pide el código del autenticador y **falla si no se lo
pasás en el mismo comando** — no lo pregunta de forma interactiva:

```bash
npm publish --access public --otp=123456
```

`--access public` no es opcional: un paquete con scope (`@constroad/…`) sale
**privado por defecto**, y en una cuenta sin plan pago eso falla con un 402 que
no menciona el scope. El scope es de **usuario**, no de organización.

Antes de publicar, `npm pack --dry-run` muestra qué archivos entran. Los tests
quedan fuera por el `!src/*.test.mjs` de `files`.

### Cómo se entera quien lo usa

Depende de cómo lo invoques, y por eso las dos formas conviven:

| Cómo lo corrés | ¿Trae la nueva al publicar en npm? |
| --- | --- |
| `npx @constroad/lila-cli` (a mano, la doc) | **Sí**, resuelve `latest` en cada corrida |
| `npx @constroad/lila-cli@0.6.0` (scripts, CI) | **No.** Hay que subir el número |
| `npm i -g @constroad/lila-cli` | No, hasta un `npm update -g` |

Que la automatización **no** se entere es el punto: un CLI que se actualiza solo
cambia cómo se compila un binario que va a treinta teléfonos, entre dos corridas
del mismo comando y sin dejar diff. El día que un release salga raro, la pregunta
«¿con qué se compiló?» tiene que tener una respuesta escrita en el repo.

Para saber qué hay y qué estás corriendo:

```bash
lila --version                       # qué estás corriendo
npm view @constroad/lila-cli version # qué hay publicado
```

Y el CLI avisa solo en **dos momentos**: en `whoami` —el de «¿está todo bien?»,
que ya hace red— y cuando **`apk publish` falla**, que es justo cuando importa
saber si estás con una versión vieja y cuando nadie se acuerda de preguntarlo.
En la publicación que sale bien no dice nada: sería ruido sobre algo que ya
salió. Nunca falla por esto: si el registry no contesta, se calla.

### Las tres versiones que se suben A MANO

Ninguna es automática, y son de tres cosas distintas. Confundirlas es la fuente
más común de «publiqué y no cambió nada»:

| Qué | Dónde | Cuándo |
| --- | --- | --- |
| **La app** (Timón, LilaStore) | `app.json` del repo de la app: `expo.version` y `expo.android.versionCode` | Antes de compilar. Si el `versionCode` ya está publicado → `409 version_no_avanza` |
| **Este CLI** | `package.json` de este repo | Antes de `npm publish` |
| **El pin del CLI** | `scripts/build-apk.sh` de cada app y el workflow de Actions | Después de publicar el CLI, si querés que lo usen |

Timón trae un atajo para la primera: `npm run release -- --bump=minor` edita las
dos líneas de `app.json` y sigue. LilaStore no lo tiene; se edita a mano.

`apk build` y `apk publish` **no tocan ninguna**: el server lee la versión del
`AndroidManifest.xml` del binario, así que subir el número mal produce un APK que
declara lo que declara, y nadie lo corrige por atrás.

### Después de publicar, subir el pin donde esté fijado

Solo donde reproduce. **La doc y el asistente de la consola no llevan número**,
así que no hay que tocarlos — ese es el punto de no ponérselo.

- `lilastore-app/scripts/build-apk.sh` → `CLI_VERSION`
- `timon/scripts/build-apk.sh` → `CLI_VERSION`
- `timon/.github/workflows/release.yml` → los dos `npx @constroad/lila-cli@…`

---

## Referencias

- Plan completo, con el orden de trabajo y los edge cases:
  [`lilastore/specs/PLAN-PUBLICACION.spec.md`](https://github.com/constroad/lilastore/blob/main/specs/PLAN-PUBLICACION.spec.md)
- API de publicación: `lilastore/specs/API.spec.md` §4
- Reglas del repo: [`AGENTS.md`](AGENTS.md)
