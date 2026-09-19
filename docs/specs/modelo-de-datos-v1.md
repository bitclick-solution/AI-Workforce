VIGENTE

# Especificación · Modelo de datos v1: diagrama, migración inicial, pruebas de aislamiento y de carga

<!--
  Esta versión reconcilia la especificación del Planificador (PR #7, rama
  `planificador/modelo-de-datos-v1`) con la implementación del Constructor.
  Sustituye a aquella: mismo alcance, mismos criterios de hecho salvo las
  diferencias declaradas en «Decisiones que el plan no fija».
-->

- Rebanada: [Notion](https://app.notion.com/p/3e053066189881bdadbbeae3a753defd) · Ciclo 0 (Fase 0 · Definir y validar) · Tipo Datos · Paquetes `domain`, `ledger` · P0
- Rama: `rebanada/modelo-de-datos-v1`
- Plan de referencia: secciones «Modelo de dominio» y «Cimientos de datos» (principios, entidades y relaciones clave, cómo se valida antes de construir encima) del [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn); ADR-007 (modelo de datos y cimientos), ADR-002 (stack), ADR-003 (tarea y contador), ADR-005 (versiones inmutables), ADR-006 (organización como dato), ADR-010 (retención y particiones).
- Zona crítica: sí: migración de datos (`**/drizzle/**`), `packages/domain` (identidad y permisos) y `packages/ledger` (libro de auditoría y contador). «Revisión humana obligatoria» marcada en la rebanada.

## Objetivo

Fijas el esquema de PostgreSQL sobre el que se construye todo lo demás: la organización como dato, las versiones inmutables del aprendizaje y el libro de auditoría encadenado. Cuando esta rebanada está hecha, cualquier rebanada posterior escribe flujos y agentes contra tablas que ya aíslan por tenant, ya resisten la purga y ya responden a las consultas del panel con volumen real. Cualquier cambio posterior del modelo es una migración con rebanada propia y revisión de Jesús.

## Paquetes tocados

- `packages/domain`: esquema Drizzle de las entidades de negocio, enumeraciones y esquemas Zod de las cargas `jsonb`, migración inicial versionada y su reverso, cliente con tenant fijado por transacción, y utilidades de carga, exportación y purga.
- `packages/ledger`: esquema del libro de auditoría y del contador, hash encadenado y punto único de escritura (`anotar`).
- `docs/`: diagrama de entidades y esta especificación.
- `.github/workflows/ci.yml`: dos jobs nuevos con PostgreSQL de servicio. No se toca nada más de `.github/`.

## Decisiones que el plan no fija

1. **Dónde vive el esquema.** Vive en `packages/domain/src/db/` y las migraciones en `packages/domain/drizzle/`. El Planificador proponía un paquete nuevo `packages/db` (`@aiw/db`) con `domain` reducido a tipos y Zod. Se mantiene `domain` porque la rebanada de Notion declara exactamente los paquetes `domain` y `ledger` (regla 1 del tablero) y porque la frontera de `CLAUDE.md` que importa —`packages/domain` no depende de ningún otro paquete— se cumple igual. Coste de mover a `packages/db` más adelante: renombrar el paquete, mover dos carpetas y actualizar los importes de `@aiw/ledger`; es mecánico, pero arrastra la migración inicial, que es zona crítica. Si Jesús prefiere `packages/db`, se hace en una rebanada de refactor antes de que haya aplicaciones consumiendo el esquema.
2. **Nombres de tablas en singular.** `organizacion`, `entrada_auditoria`, `contador_consumo`. El Planificador usaba plural. Se elige singular porque la tabla nombra la entidad, igual que la columna nombra el atributo, y porque la tabla «Modelo de dominio» del plan enumera las entidades en singular.
3. **Ajuste de sesión `aiw.tenant_id`.** El Planificador usaba `app.tenant_id`. El prefijo `aiw` evita colisionar con cualquier otro ajuste `app.*` de una extensión o de Temporal en la misma base.
4. **Dimensión de embedding 1024.** Se adopta la del Planificador: encaja con los modelos de embedding europeos y open source. Cambiarla es una migración propia.
5. **Índice HNSW «por tenant».** pgvector no admite índices HNSW multicolumna, así que «por tenant» no se puede tomar al pie de la letra. El aislamiento lo garantiza la RLS, y el HNSW sobre el vector va acompañado de un índice `(tenant_id, ambito, ambito_id)`; con pgvector 0.8 el escaneo iterativo mantiene la recuperación al filtrar.
6. **El hash encadenado no se valida con un disparador.** Un disparador por fila serializa todas las escrituras del libro. La cadena la construye el punto único de escritura de `@aiw/ledger` con un bloqueo consultivo por tenant, y la verificación es una función de recorrido más su prueba. La base sí impide `UPDATE` y `DELETE`.

## Endpoints, flujos y datos

Solo datos. La migración inicial `packages/domain/drizzle/0000_inicial.sql` crea, en una sola transacción:

- Extensiones `vector` y `pgcrypto`, y la función `uuid_generar_v7()` (PostgreSQL 16 no trae `uuidv7()`).
- Roles `aiw_migrador` (propietario del esquema, el único que migra) y `aiw_app` (rol de aplicación, sin `BYPASSRLS`).
- 35 tablas con `tenant_id` en todas menos las dos raíces de tenant (`organizacion_paraguas` y `organizacion`, donde el tenant es la propia fila) y la tabla de infraestructura `migracion_aplicada`. `ROW LEVEL SECURITY` activada y forzada, política por tenant contra `current_setting('aiw.tenant_id')` e índices compuestos que empiezan por `tenant_id`.
- Entidades del «Modelo de dominio»: organización paraguas, organización, persona, paquete de tareas, departamento, puesto, versión de puesto, habilidad, tarea, paso, delegación, aprobación, disparador, señal, lección, promoción, sala, participante de sala, mensaje, intervención, propuesta de operación, conector, autorización de herramientas, documento canónico del manual, fragmento de conocimiento, memoria con ámbito, entidad, relación, indicador y su valor materializado, notificación, salida transaccional de eventos, y en `ledger` la entrada de auditoría y el contador de consumo.
- Relaciones N:M con tabla propia y atributos: `autorizacion_herramientas` (puesto × conector), `habilidad_version_puesto`, `leccion_senal`, `sala_participante`.
- Tablas particionadas por mes sobre `creado_en`: `entrada_auditoria`, `mensaje` y `senal`, con partición por defecto, particiones del mes actual y del siguiente, y función `crear_particion_mensual(tabla, mes)`.
- Índices HNSW de pgvector en `memoria` y `fragmento_conocimiento`, acompañados del índice compuesto por tenant y ámbito.
- Permisos: el rol de aplicación no tiene `UPDATE` ni `DELETE` sobre `entrada_auditoria`, y un disparador lo bloquea también para cualquier otro rol que no sea el migrador.

El reverso vive en `packages/domain/drizzle/reverso/0000_inicial.sql` y deja la base como estaba. El registro de lo aplicado vive en `migracion_aplicada`, con la huella del fichero.

Diagrama de entidades en `docs/datos/modelo-de-datos-v1.md` (Mermaid `erDiagram`) con las relaciones de «Entidades y relaciones clave» y una tabla por entidad con su propósito.

## Criterios de hecho

1. `pnpm --filter @aiw/domain db:migrar` aplica la migración inicial sobre una base vacía y `db:revertir` la deja sin rastro; ambas son idempotentes respecto al registro `migracion_aplicada`, y una prueba lo comprueba.
2. Una prueba recorre `pg_tables` del esquema y falla si aparece una tabla sin RLS activada y forzada o sin política de tenant, salvo las excepciones declaradas en el registro de tablas.
3. Con el rol `aiw_app`, las pruebas de aislamiento no leen ni escriben filas de otro tenant; una inserción con `tenant_id` distinto del fijado falla, y una consulta sin `aiw.tenant_id` devuelve cero filas.
4. Con el rol `aiw_app`, `UPDATE` y `DELETE` sobre `entrada_auditoria` fallan con error de permisos; existen las particiones del mes actual y del siguiente, y `crear_particion_mensual` crea la de un mes futuro.
5. El hash encadenado detecta cualquier alteración: la verificación de la cadena falla si se cambia una entrada, y el punto único de escritura serializa por tenant con bloqueo consultivo.
6. Con un millón de entradas de auditoría y cien mil mensajes de sala en un tenant, el banco de consultas del panel (últimas entradas de auditoría por puesto, contador del periodo, últimos mensajes de una sala, aprobaciones pendientes de una persona) responde por debajo de 200 ms en el percentil 95; el informe con máquina, fechas, tiempos y planes queda en `packages/domain/bench/informe.md`.
7. `exportarOrganizacion(tenantId)` escribe un JSONL por tabla y `purgarOrganizacion(tenantId)` deja cero filas del tenant en todas las tablas salvo `entrada_auditoria`, que queda exportada y pendiente del flujo de retención del ADR-010; la prueba lo ejecuta sobre una organización sintética con datos en todas las tablas, y comprueba que purgar en otro orden falla por el borrado restringido.
8. La CI ejecuta el job «Base de datos» con `pgvector/pgvector:pg16-trixie` y los criterios 1 a 5 y 7, con carga reducida (diez mil entradas y mil mensajes); el job «Base de datos · carga» ejecuta el criterio 6 completo. En local, sin `DATABASE_URL`, las pruebas se saltan con un mensaje claro.

## Casos de prueba y de eval

- Unitario sin base de datos: el registro de tablas declara `tenant_id` en toda tabla de tenant y un índice que empieza por `tenant_id`; los esquemas Zod rechazan niveles, estados y ámbitos fuera de la enumeración; el hash encadenado es estable, detecta manipulación y rechaza cadenas rotas. Caminos de error: cadena vacía, hash anterior que no corresponde, carga que no valida contra Zod, identificador de rol no válido.
- Integración: aislamiento entre dos tenants (lectura, inserción, actualización y borrado cruzados), cobertura de RLS sobre `pg_tables`, permisos y particiones del libro, reverso de la migración, exportación y purga completas.
- Carga: banco de consultas sobre los datos sintéticos del criterio 6, con percentiles medidos en el proceso y `EXPLAIN` de cada consulta en el informe.
- Eval: no aplica. Esta rebanada no añade comportamiento de agente; el primer caso dorado llega con el bucle del agente.
- Auditoría y contador: el punto único de escritura de `@aiw/ledger` inserta la entrada encadenada y suma al contador en la misma transacción; la prueba comprueba que el contador cuadra con la suma de las entradas. El camino completo de escritura desde el motor llega con «Aprobación y auditoría v0».
- Secretos: la conexión llega por `DATABASE_URL` del entorno; una prueba rechaza literales `postgresql://` con contraseña en el código de los dos paquetes, y `.env.example` sigue con `GENERAR`.

## Fuera de alcance

- Tablas de identidad de Better Auth y modelo de permisos completo: rebanada «Identidad y organizaciones». Aquí `persona` solo existe como destinatario de aprobaciones y notificaciones.
- Motor de políticas y evaluación de niveles N0 a N3: rebanada «Políticas y niveles». Aquí la política es una columna `jsonb` versionada con su esquema Zod.
- Camino de escritura del libro desde el motor y contador en producción: rebanadas «Aprobación y auditoría v0» y «Contador v0». Aquí está el punto de escritura y su prueba, no el flujo que lo invoca.
- Flujos de Temporal de purga y exportación: rebanada «Borrado y exportación». Aquí hay funciones y su ensayo, no el flujo durable.
- Publicador de `evento_salida`: rebanada «Salas y tiempo real». Aquí solo la tabla y su índice.
- Proyección de tareas desde el historial de Temporal: rebanada «Prueba técnica».
- Ingesta de embeddings e índice de conocimiento: rebanada «Conocimiento v0». Aquí solo las tablas y los índices.
- Archivado a S3 y borrado de particiones por retención, materialización horaria de indicadores y réplica de lectura: fase 2.

## Presupuesto de tokens

Presupuesto: la rebanada no tiene «Presupuesto tokens (€)» en el tablero. El Planificador propuso 60 € en su especificación; se trabaja con esa referencia hasta que Jesús la fije. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

El plan fija Drizzle y los principios, pero no dónde vive el esquema. Esta especificación lo deja en `packages/domain`, que es lo que declara la rebanada del tablero; el Planificador proponía un paquete nuevo `packages/db`. ¿Confirmas `packages/domain` o abres una rebanada de refactor para `packages/db` antes de que haya aplicaciones consumiendo el esquema?
