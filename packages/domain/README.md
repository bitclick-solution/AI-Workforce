VIGENTE

# @aiw/domain

Vocabulario del negocio: enumeraciones, esquemas Zod de las cargas `jsonb` y los
tipos que se derivan de ellos. Aquí no hay Drizzle, ni SQL, ni conexión; el esquema
de PostgreSQL y sus migraciones viven en [`@aiw/db`](../db/README.md), que depende
de este paquete.

- `src/enumeraciones.ts`: los valores de cada enumeración, una sola vez. `@aiw/db`
  construye con ellos los tipos `enum` de PostgreSQL y los esquemas Zod los validan,
  así que el tipo de la base y la validación no pueden separarse.
- `src/esquemas/`: esquemas Zod de lo que va en `jsonb`, más `validarCarga`, que
  lanza diciendo qué campo falla y en qué columna se iba a escribir.

Este paquete no depende de ningún otro paquete del monorepo (frontera de `CLAUDE.md`).

## El plan de la organización

`esquemas.planOrganizacion` valida la columna `organizacion.plan`, que en la base es
`text` y no un tipo `enum`. Los planes del ADR-011 son una hipótesis que se revisa al
cierre de la fase 1: cambiar la lista se hace aquí, en una línea, y no cuesta una
migración de tipo en una zona crítica.
