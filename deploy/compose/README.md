VIGENTE

# Compose de desarrollo

`docker-compose.dev.yml` levanta la infraestructura que el plan compra en vez de construir:

| Servicio                           | Imagen                                  | Puerto local           | Para qué                                                                                                             |
| ---------------------------------- | --------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| postgres                           | pgvector/pgvector:pg16-trixie           | 5432                   | Única fuente de verdad; bases `aiworkforce`, `langfuse`, `temporal` y `temporal_visibility`                          |
| temporal                           | temporalio/auto-setup:1.29.7            | 7233                   | Motor de ejecución durable                                                                                           |
| temporal-ui                        | temporalio/ui:2.54.1                    | 8080                   | Interfaz de Temporal                                                                                                 |
| centrifugo                         | centrifugo/centrifugo:v6.9.6            | 8000                   | Fan-out en tiempo real de la sala                                                                                    |
| silo                               | pgsty/silo:RELEASE.2026-09-16T00-00-00Z | 9000 API, 9001 consola | Almacén de objetos S3 (fork mantenido de MinIO, ADR-012): exportaciones, habilidades, adjuntos y eventos de Langfuse |
| silo-init                          | pgsty/silo:RELEASE.2026-09-16T00-00-00Z | sin puerto             | Crea los cubos `aiworkforce` y `langfuse` con `mcli` y termina                                                       |
| langfuse                           | langfuse/langfuse:4.38                  | 3001                   | Trazas, coste y datasets                                                                                             |
| langfuse-worker, clickhouse, redis | dependencias de Langfuse                | sin puerto             | Solo accesibles desde la red del Compose                                                                             |

Todos los puertos se publican en `127.0.0.1`. Los secretos llegan de `.env`, que `pnpm dev:up` genera a partir de `.env.example`. El fichero falla de forma explícita si falta un secreto.

El mismo esquema, con imágenes propias y sin Langfuse, será la base del bundle on-premise en la fase 3.

## Healthchecks: lo aprendido en la CI

- Temporal y Langfuse escuchan en la IP del contenedor, no en `127.0.0.1`: Temporal por `BIND_ON_IP` y Langfuse porque Next.js se ata al `HOSTNAME` que define Docker. Sus healthchecks consultan el nombre del servicio (`temporal:7233`, `langfuse:3000`), que la red del Compose resuelve desde el propio contenedor.
- La imagen de Langfuse no trae `wget` ni `curl`: la comprobación usa `node -e "fetch(...)"` contra `/api/public/health`.
- Redis con `--requirepass` responde `NOAUTH` a un `ping` sin contraseña y `redis-cli` sale con código 0, así que el check pasaría en vacío. Se autentica con `-a "$REDIS_PASSWORD"` y se exige `PONG`.
- Silo se comprueba con `mcli ready local`, el cliente que trae la propia imagen; `silo-init` crea los cubos con `mcli mb --ignore-existing` y Langfuse espera a que termine con éxito (`service_completed_successfully`).
- El mismo criterio vale para el bundle on-premise: comprobar por nombre de servicio y con una herramienta que la imagen tenga.

## Almacén de objetos: de MinIO a Silo

MinIO archivó su repositorio en abril de 2026. Desde el ADR-012 el almacén S3 es [Silo](https://github.com/pgsty/silo), fork mantenido por Pigsty que conserva la API S3, las variables `MINIO_*`, las rutas `/minio/*`, el formato de datos y el cliente (`mcli`). Las variables de `.env.example` pasan a llamarse `S3_*`; un `.env` anterior con nombres `MINIO_*` sigue funcionando porque el Compose acepta ambos. El volumen pasa de `minio_data` a `s3_data`: un entorno anterior se reinicia con `pnpm dev:down --volumes`. El bundle on-premise de la fase 3 hereda la misma imagen con la release fijada y la verificación de firmas Sigstore que publica el proyecto.
