# lila-cli

La herramienta de línea de comandos de ConstRoad. Hoy hace una cosa —compilar,
firmar y publicar un APK en [LilaStore](https://lilastore.constroad.com)— y está
armada para que mañana haga más sin renombrar nada de lo de hoy.

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

No hace falta instalarlo. En un runner o en una laptop:

```bash
npx @constroad/lila-cli apk publish
```

Para usarlo seguido, `npm i -g @constroad/lila-cli` y queda como `lila`.

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

---

## Comandos

Sustantivo y después verbo. No es estética: es lo que permite sumar un área nueva
sin renombrar lo que ya existe.

```
lila                              menú interactivo
lila login                        guarda el token
lila whoami                       a qué app publica este token y cuándo vence

lila apk build                    compila y firma
lila apk check                    ¿el versionCode de app.json supera al publicado?
lila apk publish [ruta]           sube; sin ruta busca en dist/
lila apk promote <versionCode>    beta → producción
lila apk withdraw <versionCode>   retira una release
lila apk list                     qué versión hay en cada canal
```

Lo que venga después entra como área nueva sin tocar lo anterior: `lila torre
deploy`, `lila auth keys`, `lila store devices`.

**El menú interactivo** se abre al llamarlo sin argumentos, y no es un adorno:
esta herramienta se usa cada dos semanas y nadie recuerda las banderas de algo
que corrió por última vez hace quince días.

### `apk publish` no pide banderas

En un repo Expo, la versión, el `versionCode` y el `package` ya están en
`app.json`. El CLI los lee de ahí.

**No es comodidad, es una guarda.** El servidor de LilaStore **no parsea el
`AndroidManifest`**: se cree lo que le declara el cliente, y solo verifica contra
el binario el `sha256` y el certificado de firma. Con las banderas a mano se
puede publicar un APK declarando `versionCode` 11 cuando el binario dice 10 — y
nadie lo detecta. El teléfono instala, sigue reportando la versión vieja, y la
tienda le ofrece actualizar para siempre. Que el número salga del mismo archivo
que usó Gradle cierra esa puerta.

Las banderas siguen existiendo para pisar el valor cuando haga falta, pero el
camino normal es no pasarlas.

### `apk check` antes de compilar

Pregunta si el `versionCode` que está por publicarse supera al vigente. Son
veinte segundos que evitan enterarse **después** de quince minutos de Gradle de
que ese número ya estaba tomado.

---

## La regla que mantiene esto sano

**`lila-cli` es un cliente de las APIs que ya existen. Nunca una segunda
implementación.**

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

## Referencias

- Plan completo, con el orden de trabajo y los edge cases:
  [`lilastore/specs/PLAN-PUBLICACION.spec.md`](https://github.com/constroad/lilastore/blob/main/specs/PLAN-PUBLICACION.spec.md)
- API de publicación: `lilastore/specs/API.spec.md` §4
- Reglas del repo: [`AGENTS.md`](AGENTS.md)
