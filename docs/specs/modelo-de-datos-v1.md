VIGENTE

# Especificación · Modelo de datos v1: diagrama, migración inicial, pruebas de aislamiento y de carga

- Rebanada: [Notion](https://app.notion.com/p/3e053066189881bdadbbeae3a753defd) · Ciclo 0 · Tipo Datos · Paquetes db (nuevo), domain, ledger · P0
- Rama: `rebanada/modelo-de-datos-v1`
- Plan de referencia: [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn), sección «Cimientos de datos» (principios, entidades y relaciones clave, cómo se valida). ADR-007 (modelo de datos), ADR-002 (stack), ADR-003 (tarea y contador), ADR-005 (versiones inmutables), ADR-006 (organización como datos), ADR-010 (retención y particiones).
- Zona crítica: sí. Migraciones (`**/migrations/**`, `**/drizzle/**`), `packages/domain` (identidad y permisos) y `packages/ledger` (libro de auditoría). Revisión humana obligatoria marcada en la rebanada.

## Objetivo

Cuando esta rebanada está hecha, el equipo tiene un esquema PostgreSQL versionado con Drizzle que cumple los doce principios de «Cimientos de datos», con aislamiento por organización probado, un libro de auditoría que no se puede alterar y una medida real de rendimiento. Todo flujo posterior (tareas, sala, aprendizaje, contador) construye sobre estas tablas y cualquier cambio del modelo es una migración con rebanada propia y revisión de Jesús.

## Paquetes tocados

- `packages/db` (nuevo, `@aiw/db`, decidido por Jesús el 20-9-2026): esquema Drizzle, migraciones SQL versionadas con su reverso, políticas RLS, roles de base de datos, cliente con `withTenant`, scripts de carga, exportación y purga. Depende solo de `@aiw/domain`.
- `packages/domain`: enumeraciones y esquemas Zod de las entidades (estados de agente y de tarea, roles humanos, niveles N0 a N3, ámbitos de memoria, tipos de lección) que el esquema reutiliza. Sin lógica.
- `packages/ledger`: solo el contrato de escritura del libro (`anotar(entrada)`) y la función de hash encadenado sobre la tabla; el camino completo de escritura llega con la rebanada «Aprobación y auditoría v0».
- `.github/workflows/ci.yml`: job «Base de datos» con un servicio `pgvector/pgvector:pg16` que aplica las migraciones y ejecuta las pruebas de aislamiento, permisos y carga reducida.

## Endpoints, flujos y datos

Sin endpoints. Base `aiworkforce` del Compose de desarrollo. Convenciones obligatorias en toda tabla: `tenant_id uuid not null` primero en toda clave e índice compuesto, `id uuid` v7 generado por la aplicación (`uuidv7()` en `@aiw/db`, con función SQL `uuid_generate_v7()` de respaldo en la migración 0000), `creado_en timestamptz`, claves foráneas siempre con `ON DELETE RESTRICT`, `jsonb` validado por Zod antes de escribir. RLS activada y forzada en todas las tablas con la política `tenant_id = current_setting('app.tenant_id')::uuid`; el rol `aiw_app` no tiene `BYPASSRLS` y fija `SET LOCAL app.tenant_id` en cada transacción mediante `withTenant(tx, tenantId)`; el rol `aiw_migrator` es dueño del esquema y solo lo usan las migraciones.

Tablas de la migración 0000, agrupadas por dominio:

- Organización: `organizaciones` (raíz del tenant: `id` = `tenant_id`, nombre, plan, estado), `personas` (email, nombre, rol propietario|administrador|supervisor|miembro|auditor, `auth_id` nulo hasta la rebanada de identidad), `departamentos` (nombre, `padre_id` nulo para el árbol de ramas, estado), `puestos` (departamento, nombre, `version_activa_id`, estado propuesto|en_prueba|activo|pausado|degradado|dado_de_baja, `dado_de_baja_en`), `versiones_puesto` (puesto, número, `definicion jsonb` con prompt, brand voice y niveles por clase de acción, origen manual|promocion; inmutable), `politicas` (ámbito organizacion|departamento|puesto, `ambito_id`, versión, `contenido jsonb`, activa; inmutable por versión), `habilidades` y `versiones_puesto_habilidades` (N:M con la versión de la habilidad fijada).
- Conexión: `conectores` (tipo odoo|factusol|mcp|nango|n8n, `config jsonb` sin secretos, estado) y `autorizaciones_herramientas` (puesto, conector, `lista_blanca jsonb`, `niveles jsonb` por clase de acción).
- Ejecución: `tareas` (puesto, `version_puesto_id`, departamento, `padre_id` para la delegación, `workflow_id` de Temporal, estado como proyección reconstruible, origen evento|peticion|sala, `contrato jsonb` con encargo, plazo, presupuesto y formato, `coste jsonb`), `pasos_tarea` (tarea, número, tipo modelo|herramienta|aprobacion|delegacion|guardia, `version_puesto_id`, entrada, salida, coste), `aprobaciones` (tarea, paso, `borrador jsonb` opaco, plazo; inmutable) y `decisiones_aprobacion` (aprobación, persona, decisión aprobada|modificada|rechazada|caducada, `cambios jsonb`; una fila por decisión), `propuestas_operacion` (actor persona|agente_plataforma, tipo crear_departamento|contratar|asignar|mover|pausar|cambiar_nivel|conectar|dar_de_baja|disolver|exportar, `efectos jsonb`, `reversion jsonb`, estado, `workflow_id`).
- Aprendizaje: `senales` (puesto, tarea, tipo aprobacion|correccion|rechazo|incidente|valoracion, `carga jsonb`; particionada por mes), `lecciones` (puesto, tipo memoria|habilidad|parametro|ejemplo, `contenido jsonb`, estado propuesta|en_sombra|promocionada|revertida), `lecciones_senales` (N:M), `promociones` (lección, versión origen, versión resultante, `evaluacion jsonb`, certificada por evaluador|persona).
- Sala: `salas` (tipo general|departamento|tarea, departamento o tarea), `mensajes` (sala, autor persona|agente|sistema, `autor_id`, contenido; particionada por mes), `intervenciones` (mensaje, puesto, tarea, motivo, coste).
- Memoria: `memoria` (ámbito organizacion|departamento|puesto, `ambito_id`, contenido, `embedding vector(1024)`, `categoria_especial boolean`, `caduca_en`, `ultimo_uso_en`, origen leccion|acuerdo|manual). Índice HNSW sobre `embedding`; el filtro por tenant y ámbito usa `hnsw.iterative_scan = relaxed_order` (pgvector 0.8 o superior). La dimensión 1024 es la decisión por defecto para embeddings europeos u open source; cambiarla es una migración.
- Auditoría y consumo: `auditoria_entradas` (particionada por mes sobre `ocurrido_en`; `seq bigint` monótono por tenant, actor, acción, `entidad_tipo` y `entidad_id` sin clave foránea, `tarea_id` sin clave foránea, `detalle jsonb`, `hash_previo`, `hash`; clave primaria `(ocurrido_en, id)` y única `(tenant_id, seq, ocurrido_en)`), con `REVOKE UPDATE, DELETE` para `aiw_app` y función `crear_particion_mensual(tabla, mes)` que la migración usa para el mes actual y el siguiente; `contador_periodos` (tenant, periodo mensual, tareas incluidas, consumidas y paquetes prepagados; un solo escritor en `@aiw/ledger`).
- Eventos: `outbox_eventos` (tipo, `carga jsonb`, `publicado_en` nulo hasta que el publicador lo procese; se escribe en la misma transacción que el cambio).

Diagrama de entidades en `docs/datos/modelo-de-datos-v1.md` (Mermaid `erDiagram`) con las relaciones de «Cimientos de datos»: organización 1:N departamento 1:N puesto 1:N versión; puesto N:M conector por autorización; tarea 1:N tarea hija y 1:N paso; aprobación N:1 tarea y genera señal; lección N:M señal; promoción N:1 lección y N:1 versión resultante; sala 1:N mensaje 1:N intervención; propuesta N:1 actor; la entrada de auditoría referencia por identificador.

## Criterios de hecho

1. `pnpm --filter @aiw/db migrate` aplica la migración 0000 sobre el Compose de desarrollo y `pnpm --filter @aiw/db check` no detecta deriva entre el esquema Drizzle y la base; `migrations/0000.down.sql` deshace la migración y una prueba lo comprueba.
2. Toda tabla del esquema tiene RLS activada y forzada con la política de tenant; una prueba recorre `pg_tables` y falla si aparece una tabla sin política.
3. Con el rol `aiw_app`, las pruebas de aislamiento no leen ni escriben filas de otro tenant, una inserción con `tenant_id` distinto del fijado falla, y una consulta sin `app.tenant_id` devuelve cero filas.
4. Con el rol `aiw_app`, `UPDATE` y `DELETE` sobre `auditoria_entradas` fallan con error de permisos; existen las particiones del mes actual y del siguiente y `crear_particion_mensual` crea la de un mes futuro.
5. `pnpm --filter @aiw/db carga` inserta en un tenant un millón de entradas de auditoría y cien mil mensajes de sala, y el banco de consultas del panel (últimas 50 entradas de auditoría filtradas por puesto, contador del mes, últimos 100 mensajes de una sala, aprobaciones pendientes de una persona) responde por debajo de 200 ms en el percentil 95; el informe con máquina, fechas y tiempos queda en `packages/db/bench/informe-2026-09.md`.
6. `exportarOrganizacion(tenantId)` escribe un JSONL por tabla y `purgarOrganizacion(tenantId)` deja cero filas del tenant en todas las tablas salvo `auditoria_entradas`, que queda exportada y pendiente del flujo de retención del ADR-010; una prueba lo ejecuta sobre una organización sintética con datos en todas las tablas.
7. `docs/datos/modelo-de-datos-v1.md` contiene el diagrama y una tabla por entidad con su propósito y sus índices; `packages/db/README.md` explica roles, `withTenant`, migraciones y scripts.
8. La CI ejecuta el job «Base de datos» en verde con las pruebas de los criterios 1 a 4 y 6, y una carga reducida (diez mil entradas y mil mensajes) del criterio 5.

## Casos de prueba y de eval

- Unitario: `uuidv7()` genera identificadores crecientes en el tiempo; los esquemas Zod de `@aiw/domain` rechazan estados y niveles fuera de la enumeración; `withTenant` fija y limpia `app.tenant_id` también cuando la transacción falla.
- Integración: aislamiento entre dos tenants en todas las tablas (lectura, inserción, actualización, borrado); permisos del libro; particiones; reverso de la migración; exportación y purga completas.
- Carga: banco de consultas con los datos sintéticos del criterio 5, medido con `EXPLAIN ANALYZE` y cronómetro en el proceso; el informe incluye el plan de cada consulta.
- Eval: no aplica; sin comportamiento de agente.
- Auditoría y contador: no aplica al camino de escritura; esta rebanada garantiza a nivel de base que el libro solo admite inserciones.
- Secretos: la URL de conexión llega por `DATABASE_URL` desde `.env` generado; ninguna credencial en código, migraciones ni pruebas, comprobado por gitleaks y por una prueba que rechaza literales `postgresql://` con contraseña en `packages/db`.

## Fuera de alcance

Tablas de identidad de Better Auth (rebanada de identidad y permisos); camino de escritura del hash encadenado y del contador (Aprobación y auditoría v0, Contador v0); publicador de `outbox_eventos`; proyección de tareas desde Temporal (Prueba técnica); ingesta de embeddings e índice de conocimiento (Conocimiento v0); archivado a S3 y borrado de particiones por retención (Exportación y retención, fase 2); materialización de indicadores; réplica de lectura.

## Presupuesto de tokens

Presupuesto: 60 €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

Ninguna. Decisión de Jesús del 20-9-2026: el esquema vive en el paquete nuevo `packages/db`, del que dependen `ledger` y las aplicaciones; `packages/domain` conserva solo tipos y esquemas Zod y sigue sin depender de ningún otro paquete.
