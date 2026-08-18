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

**El metadata sale del repo, no de la mano.** En un proyecto Expo, versión,
`versionCode` y `package` se leen de `app.json`. El servidor no parsea el
`AndroidManifest`, así que un número tipeado a mano puede mentirle a la tienda
sin que nada lo detecte.

## Estructura de comandos

Sustantivo y después verbo: `lila <área> <acción>`. Un área nueva no obliga a
renombrar nada de lo anterior. Las áreas de hoy: `apk`. Las previstas: `torre`,
`auth`, `store`.

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
npm test          # node --test
npm run lint
```

## Definition of done

- `npm test` en verde.
- El comando nuevo tiene su test del parser de argumentos: es donde aparecen los
  errores que llegan a producción, porque el resto es una llamada HTTP.
- El `README.md` lista el comando en la tabla y explica **por qué** existe si no
  es obvio.
- Probado corriéndolo como subproceso real, igual que lo haría el CI — no
  importando la función desde un test.
