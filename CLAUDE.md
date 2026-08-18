# lila-cli (Claude)

Las reglas de este repo están en [`AGENTS.md`](AGENTS.md) — mismo contenido,
aplica igual.

Antes de agregar un comando, leer el plan que le dio origen a este repo:
[`lilastore/specs/PLAN-PUBLICACION.spec.md`](https://github.com/constroad/lilastore/blob/main/specs/PLAN-PUBLICACION.spec.md).
Ahí están el orden de trabajo y los edge cases del flujo de publicación, que es
lo que este CLI toca.

La regla que más fácil se rompe sin querer: **este CLI no implementa nada, llama
APIs**. Si para hacer un comando hace falta escribir lógica que el servicio no
tiene, lo que falta es un endpoint.
