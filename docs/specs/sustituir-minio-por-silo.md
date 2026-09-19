VIGENTE

# Especificación · Sustituir MinIO por Silo como almacén de objetos S3 en el Compose de desarrollo

- Rebanada: [Notion](https://app.notion.com/p/3e0530661898817082a8f5215ec10fb1) · Ciclo 0 · Tipo Plataforma · Paquetes deploy, docs · P1
- Rama: `rebanada/sustituir-minio-por-silo`
- Plan de referencia: [Plan de construcción v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn), _Stack_ ("Objetos S3: exportaciones, habilidades, adjuntos") y _Una imagen para todo_; ADR-002 y [ADR-012](../adr/ADR-012.md) (Propuesto).
- Zona crítica: no. Solo `deploy/compose`, scripts de arranque y documentación.

## Objetivo

Retirar la imagen de MinIO, cuyo proyecto upstream está archivado desde abril de 2026, y dejar el almacén de objetos S3 del entorno de desarrollo sobre Silo, fork mantenido por Pigsty con la misma API S3, las mismas variables `MINIO_*` y el mismo formato de datos. El resto del Compose no cambia de comportamiento.

## Paquetes tocados

`deploy/compose` (fichero del Compose y README), `scripts/dev-up.mjs`, `.env.example`, `README.md`, `apps/web/lib/cimientos.ts` (texto de la página de inicio), `docs/adr/ADR-012.md`.

## Criterios de hecho

1. El servicio `silo` usa `pgsty/silo` con release fijada y su healthcheck es `mcli ready local`.
2. Un servicio de inicialización `silo-init` crea los cubos `aiworkforce` y `langfuse` con `mcli mb --ignore-existing` y termina; Langfuse arranca solo cuando ha terminado con éxito.
3. `.env.example` usa `S3_ROOT_USER`, `S3_ROOT_PASSWORD`, `S3_PORT` y `S3_CONSOLE_PORT`; un `.env` anterior con nombres `MINIO_*` sigue funcionando.
4. `docker compose config` valida con un `.env` nuevo y con uno antiguo; el job `Compose de desarrollo arranca` de la CI termina en verde con todos los contenedores sanos.
5. `deploy/compose/README.md` documenta la imagen, la inicialización de cubos, el healthcheck y la nota para el bundle on-premise; `README.md` y la página de inicio nombran Silo.
6. `docs/adr/ADR-012.md` reproduce la fila de la base **Decisiones** con su estado.

## Casos de prueba

- `docker compose config --quiet` con `.env` generado desde el nuevo `.env.example` y con un `.env` que solo tenga los nombres antiguos `MINIO_*`.
- `pnpm lint`, `pnpm format:check` y `pnpm --filter @aiw/web test` (la prueba de `cimientos.ts` sigue contando cuatro piezas).
- CI: `Compose de desarrollo arranca` con `silo` sano, `silo-init` terminado con código 0 y `langfuse` sano.

## Fuera de alcance

Migrar datos de un volumen `minio_data` existente (el entorno de desarrollo se reinicia con `pnpm dev:down --volumes`), el bundle on-premise de la fase 3 y cualquier cliente S3 del código de producto, que todavía no existe.

## Presupuesto de tokens

Presupuesto: 15 €. Consumo real estimado al abrir el PR: ver la rebanada en Notion.
