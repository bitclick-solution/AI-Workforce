VIGENTE

# Compose de desarrollo

`docker-compose.dev.yml` levanta la infraestructura que el plan compra en vez de construir:

| Servicio                           | Imagen                        | Puerto local           | Para qué                                                                                    |
| ---------------------------------- | ----------------------------- | ---------------------- | ------------------------------------------------------------------------------------------- |
| postgres                           | pgvector/pgvector:pg16-trixie | 5432                   | Única fuente de verdad; bases `aiworkforce`, `langfuse`, `temporal` y `temporal_visibility` |
| temporal                           | temporalio/auto-setup:1.29.7  | 7233                   | Motor de ejecución durable                                                                  |
| temporal-ui                        | temporalio/ui:2.54.1          | 8080                   | Interfaz de Temporal                                                                        |
| centrifugo                         | centrifugo/centrifugo:v6.9.6  | 8000                   | Fan-out en tiempo real de la sala                                                           |
| minio                              | cgr.dev/chainguard/minio      | 9000 API, 9001 consola | Objetos S3: exportaciones, habilidades, adjuntos y eventos de Langfuse                      |
| langfuse                           | langfuse/langfuse:4.38        | 3001                   | Trazas, coste y datasets                                                                    |
| langfuse-worker, clickhouse, redis | dependencias de Langfuse      | sin puerto             | Solo accesibles desde la red del Compose                                                    |

Todos los puertos se publican en `127.0.0.1`. Los secretos llegan de `.env`, que `pnpm dev:up` genera a partir de `.env.example`. El fichero falla de forma explícita si falta un secreto.

El mismo esquema, con imágenes propias y sin Langfuse, será la base del bundle on-premise en la fase 3.

## Healthchecks: lo aprendido en la CI

- Temporal y Langfuse escuchan en la IP del contenedor, no en `127.0.0.1`: Temporal por `BIND_ON_IP` y Langfuse porque Next.js se ata al `HOSTNAME` que define Docker. Sus healthchecks consultan el nombre del servicio (`temporal:7233`, `langfuse:3000`), que la red del Compose resuelve desde el propio contenedor.
- La imagen de Langfuse no trae `wget` ni `curl`: la comprobación usa `node -e "fetch(...)"` contra `/api/public/health`.
- Redis con `--requirepass` responde `NOAUTH` a un `ping` sin contraseña y `redis-cli` sale con código 0, así que el check pasaría en vacío. Se autentica con `-a "$REDIS_PASSWORD"` y se exige `PONG`.
- El mismo criterio vale para el bundle on-premise: comprobar por nombre de servicio y con una herramienta que la imagen tenga.
