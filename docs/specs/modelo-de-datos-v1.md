VIGENTE

# Especificación · Modelo de datos v1: diagrama, migración inicial, pruebas de aislamiento y de carga

<!--
  Esta versión reconcilia la especificación del Planificador (PR #7, rama
  `planificador/modelo-de-datos-v1`) con la implementación del Constructor, y
  recoge la revisión del Revisor sobre el commit 6852cda y la decisión de Jesús
  del 20-9 sobre dónde vive el esquema. Sustituye a aquella: mismo alcance,
  mismos criterios de hecho salvo las diferencias declaradas en «Decisiones que
  el plan no fija».
-->

- Rebanada: [Notion](https://app.notion.com/p/3e053066189881bdadbbeae3a753defd) · Ciclo 0 (Fase 0 · Definir y validar) · Tipo Datos · Paquetes `db`, `domain`, `ledger` · P0
- Rama: `rebanada/modelo-de-datos-v1`
- Plan de referencia: secciones «Modelo de dominio» y «Cimientos de datos» (principios, entidades y relaciones clave, cómo se valida antes de construir encima) del [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn); ADR-007 (modelo de datos y cimientos), ADR-002 (stack), ADR-003 (tarea y contador), ADR-005 (versiones inmutables), ADR-006 (organización como dato), ADR-010 (retención y particiones).
- Zona crítica: sí: migración de datos (`**/drizzle/**`), `packages/db` (esquema y migraciones), `packages/domain` (identidad y permisos), `packages/ledger` (libro de auditoría y contador) y `.github/` (dos jobs de CI y `CODEOWNERS`). «Revisión humana obligatoria» marcada en la rebanada.

## Objetivo

Fijas el esquema de PostgreSQL sobre el que se construye todo lo demás: la organización como dato, las versiones inmutables del aprendizaje y el libro de auditoría encadenado. Cuando esta rebanada está hecha, cualquier rebanada posterior escribe flujos y agentes contra tablas que ya aíslan por tenant, ya resisten la purga y ya responden a las consultas del panel con volumen real. Cualquier cambio posterior del modelo es una migración con rebanada propia y revisión de Jesús.

## Paquetes tocados

- `packages/db` (nuevo, `@aiw/db`): esquema Drizzle de las entidades de negocio, migración inicial versionada y su reverso, cliente con tenant fijado por transacción, y utilidades de carga, exportación y purga. Depende de `@aiw/domain`.
- `packages/domain`: los valores de las enumeraciones y los esquemas Zod de las cargas `jsonb`. Sin Drizzle, sin SQL y sin conexión; sigue sin depender de ningún paquete del monorepo.
- `packages/ledger`: esquema del libro de auditoría y del contador, hash encadenado y punto único de escritura (`anotar`). Depende de `@aiw/db`.
- `docs/`: diagrama de entidades y esta especificación.
- `.github/workflows/ci.yml`: dos jobs nuevos con PostgreSQL de servicio. `.github/CODEOWNERS`: `/packages/db/` como zona crítica.

## Decisiones que el plan no fija

1. **Dónde vive el esquema.** Resuelto por Jesús el 20-9: vive en un paquete nuevo `packages/db` (`@aiw/db`), con `packages/domain` reducido a enumeraciones y esquemas Zod. El esquema Drizzle está en `packages/db/src/` y las migraciones en `packages/db/drizzle/`. `@aiw/db` depende de `@aiw/domain`; `@aiw/ledger` depende de `@aiw/db`; `packages/domain` sigue sin depender de ningún paquete del monorepo. Los valores de cada enumeración se escriben una sola vez, en `packages/domain/src/enumeraciones.ts`: `@aiw/db` construye con ellos los tipos `enum` de PostgreSQL y los esquemas Zod los validan, así que el tipo de la base y su validación no pueden separarse. Se hizo aquí y no en una rebanada de refactor porque todavía no hay ninguna aplicación consumiendo el esquema y mover la migración inicial después habría costado más.
2. **Nombres de tablas en singular.** `organizacion`, `entrada_auditoria`, `contador_consumo`. El Planificador usaba plural. Se elige singular porque la tabla nombra la entidad, igual que la columna nombra el atributo, y porque la tabla «Modelo de dominio» del plan enumera las entidades en singular.
3. **Ajuste de sesión `aiw.tenant_id`.** El Planificador usaba `app.tenant_id`. El prefijo `aiw` evita colisionar con cualquier otro ajuste `app.*` de una extensión o de Temporal en la misma base.
4. **Dimensión de embedding 1024.** Se adopta la del Planificador: encaja con los modelos de embedding europeos y open source. Cambiarla es una migración propia.
5. **Índice HNSW «por tenant».** pgvector no admite índices HNSW multicolumna, así que «por tenant» no se puede tomar al pie de la letra. El aislamiento lo garantiza la RLS, y el HNSW sobre el vector va acompañado de un índice `(tenant_id, ambito, ambito_id)`; con pgvector 0.8 el escaneo iterativo mantiene la recuperación al filtrar.
6. **El hash encadenado no se valida con un disparador.** Un disparador por fila serializa todas las escrituras del libro. La cadena la construye el punto único de escritura de `@aiw/ledger` con un bloqueo consultivo por tenant, y la verificación es una función de recorrido más su prueba. La base sí impide `UPDATE` y `DELETE`.
7. **La decisión de una aprobación es una fila propia.** `aprobacion` es inmutable, así que no puede guardar su propia decisión: resolverla exigiría un `UPDATE` sobre una tabla que no se actualiza. La decisión vive en `decision_aprobacion`, con una única sobre `(tenant_id, aprobacion_id)` que garantiza una decisión por aprobación; el tipo de la base pasa a llamarse `sentido_decision` y pierde el valor `pendiente`. «Aprobación pendiente» deja de ser un estado y pasa a ser «aprobación sin decisión», que es lo que pregunta el panel con un anti-join resuelto por `Index Only Scan`. Es lo que pedían la especificación del Planificador y el ADR-005.
8. **El plan de la organización es `text`, no un tipo `enum`.** El ADR-011 marca los planes (Departamento, Equipo, Workforce, Business, Enterprise y el plan Asesoría) como hipótesis que se revisa al cierre de la fase 1, el 20-11. La columna es `text` validada por `esquemas.planOrganizacion` de `@aiw/domain`: cambiar la lista es una línea en un paquete de tipos, y no una migración de tipo en una zona crítica.
9. **La hora de una entrada de auditoría la pone la base.** `anotar` toma `clock_timestamp()` en la misma transacción y en la misma ida y vuelta que el bloqueo consultivo, y la devuelve con `returning`. El panel ordena por `creado_en` y la cadena por `numero_orden`: con el reloj de cada instancia de la aplicación, los dos órdenes podrían no coincidir.

## Endpoints, flujos y datos

Solo datos. La migración inicial `packages/db/drizzle/0000_inicial.sql` crea, en una sola transacción:

- Extensiones `vector` y `pgcrypto`, y la función `uuid_generar_v7()` (PostgreSQL 16 no trae `uuidv7()`).
- Roles `aiw_migrador` (propietario del esquema, el único que migra) y `aiw_app` (rol de aplicación, sin `BYPASSRLS`). Los roles se crean lo primero y el usuario que migra los asume con `grant aiw_migrador to current_user` y `set local role aiw_migrador`, para que las funciones, los tipos y las tablas queden a nombre de `aiw_migrador` y no del usuario que conectó ese día. Una prueba recorre `pg_tables` y falla si alguna tabla tiene otro dueño.
- 37 tablas de entidad, más la de infraestructura `migracion_aplicada`, más tres particiones por defecto y seis mensuales (la del mes actual y la del siguiente de las tres tablas particionadas). Llevan `tenant_id` todas menos las dos raíces de tenant (`organizacion_paraguas` y `organizacion`, donde el tenant es la propia fila) y `migracion_aplicada`. `ROW LEVEL SECURITY` activada y forzada, política por tenant contra `current_setting('aiw.tenant_id')` e índices compuestos que empiezan por `tenant_id`.
- Entidades del «Modelo de dominio»: organización paraguas, organización, persona, paquete de tareas, departamento, puesto, versión de puesto, habilidad, tarea, paso, delegación, aprobación, decisión de aprobación, disparador, señal, lección, promoción, sala, participante de sala, mensaje, intervención, propuesta de operación, conector, autorización de herramientas, documento canónico del manual, fragmento de conocimiento, memoria con ámbito, entidad, relación, indicador y su valor materializado, notificación, salida transaccional de eventos, y en `ledger` la entrada de auditoría y el contador de consumo.
- Relaciones N:M con tabla propia y atributos: `autorizacion_herramientas` (puesto × conector), `habilidad_version_puesto`, `leccion_senal`, `sala_participante`.
- Tablas particionadas por mes sobre `creado_en`: `entrada_auditoria`, `mensaje` y `senal`, con partición por defecto, particiones del mes actual y del siguiente, y función `crear_particion_mensual(tabla, mes)`.
- Índices HNSW de pgvector en `memoria` y `fragmento_conocimiento`, acompañados del índice compuesto por tenant y ámbito.
- Permisos: el rol de aplicación no tiene `UPDATE` ni `DELETE` sobre `entrada_auditoria`, y un disparador lo bloquea también para cualquier otro rol que no sea el migrador.

El reverso vive en `packages/db/drizzle/reverso/0000_inicial.sql` y deja la base como estaba: asume el mismo rol, suelta los objetos y borra los roles. El registro de lo aplicado vive en `migracion_aplicada`, con la huella del fichero.

Diagrama de entidades en `docs/datos/modelo-de-datos-v1.md` (Mermaid `erDiagram`) con las relaciones de «Entidades y relaciones clave» y una tabla por entidad con su propósito.

## Criterios de hecho

1. `pnpm --filter @aiw/db db:migrar` aplica la migración inicial sobre una base vacía y `db:revertir` la deja sin rastro; ambas son idempotentes respecto al registro `migracion_aplicada`, y una prueba lo comprueba. El dueño de todo lo que crea es `aiw_migrador`, y otra prueba recorre `pg_tables` para comprobarlo.
2. Una prueba recorre `pg_tables` del esquema y falla si aparece una tabla sin RLS activada y forzada o sin política de tenant, salvo las excepciones declaradas en el registro de tablas.
3. Con el rol `aiw_app`, las pruebas de aislamiento no leen ni escriben filas de otro tenant; una inserción con `tenant_id` distinto del fijado falla, y una consulta sin `aiw.tenant_id` devuelve cero filas.
4. Con el rol `aiw_app`, `UPDATE` y `DELETE` sobre `entrada_auditoria` fallan con error de permisos; existen las particiones del mes actual y del siguiente, y `crear_particion_mensual` crea la de un mes futuro.
5. El hash encadenado detecta cualquier alteración: la verificación de la cadena falla si se cambia una entrada, y el punto único de escritura serializa por tenant con bloqueo consultivo.
6. Con un millón de entradas de auditoría y cien mil mensajes de sala en un tenant, el banco de consultas del panel (últimas entradas de auditoría por puesto, contador del periodo, últimos mensajes de una sala, aprobaciones sin decisión de una persona) responde por debajo de 200 ms en el percentil 95; el informe con máquina, fechas, tiempos y planes queda en `packages/db/bench/informe.md`.
7. `exportarOrganizacion(tenantId)` escribe un JSONL por tabla y `purgarOrganizacion(tenantId)` deja cero filas del tenant en todas las tablas salvo `entrada_auditoria`, que queda exportada y pendiente del flujo de retención del ADR-010; la prueba lo ejecuta sobre una organización sintética con datos en todas las tablas, y comprueba que purgar en otro orden falla por el borrado restringido.
8. La CI ejecuta el job «Base de datos» con `pgvector/pgvector:pg16-trixie` y los criterios 1 a 5 y 7, con carga reducida (diez mil entradas y mil mensajes); el job «Base de datos · carga» ejecuta el criterio 6 completo, y solo cuando el cambio toca `packages/db/**` o alguien lo lanza a mano con `workflow_dispatch`: un millón de filas en cada PR no se paga. En local, sin `DATABASE_URL`, las pruebas se saltan con un mensaje claro.

## Casos de prueba y de eval

- Unitario sin base de datos: el registro de tablas declara `tenant_id` en toda tabla de tenant y un índice que empieza por `tenant_id`; los esquemas Zod rechazan niveles, estados y ámbitos fuera de la enumeración; el hash encadenado es estable, detecta manipulación y rechaza cadenas rotas. Caminos de error: cadena vacía, hash anterior que no corresponde, carga que no valida contra Zod, identificador de rol no válido.
- Integración: aislamiento entre dos tenants (lectura, inserción, actualización y borrado cruzados), cobertura de RLS sobre `pg_tables`, permisos y particiones del libro, reverso de la migración, exportación y purga completas.
- Carga: banco de consultas sobre los datos sintéticos del criterio 6, con percentiles medidos en el proceso y `EXPLAIN` de cada consulta en el informe.
- Eval: no aplica. Esta rebanada no añade comportamiento de agente; el primer caso dorado llega con el bucle del agente.
- Auditoría y contador: el punto único de escritura de `@aiw/ledger` inserta la entrada encadenada y suma al contador en la misma transacción; la prueba comprueba que el contador cuadra con la suma de las entradas. El camino completo de escritura desde el motor llega con «Aprobación y auditoría v0».
- Secretos: la conexión llega por `DATABASE_URL` del entorno; una prueba rechaza literales `postgresql://` con contraseña en el código de `@aiw/db`, y `.env.example` sigue con `GENERAR`.

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

## Deuda conocida

Lo que esta rebanada deja escrito y no resuelto, con dónde se paga. Nada de esto bloquea construir encima, pero tampoco se olvida.

1. **`entrada_auditoria` no tiene única sobre `(tenant_id, numero_orden)`.** PostgreSQL exige que la clave única de una tabla particionada incluya la columna de partición, y la partición es por `creado_en`: una única sobre `(tenant_id, numero_orden)` no cabe. Hoy la garantía de que no hay dos entradas con el mismo número de orden es el bloqueo consultivo por tenant de `anotar`, que solo funciona mientras `anotar` sea el único camino de inserción; con el `INSERT` directo que tiene `aiw_app` sobre la tabla, ese «único camino» es una convención, no una regla de la base. Se paga en «Aprobación y auditoría v0»: una función `SECURITY DEFINER` que haga el bloqueo, el encadenado y la inserción, retirar el `INSERT` directo a `aiw_app` y dejarle solo el `EXECUTE` de esa función. Entonces el camino único lo impone la base y no el repositorio.
2. **Nadie programa `crear_particion_mensual`.** La migración crea la partición del mes actual y la del siguiente, y la función está lista, pero hoy solo la ejecuta el migrador y ninguna rutina la llama. La rutina mensual llega con «Exportación y retención», junto con el archivado y el soltado de particiones por retención del ADR-010. Mientras tanto, la partición por defecto de cada tabla recoge lo que se salga de rango: nada falla, pero esas filas no se benefician del recorte de particiones y hay que moverlas cuando llegue la rutina.
3. **El `plan` no está validado en la base.** La columna es `text` y quien la valida es Zod en el camino de escritura. Una escritura que se salte `validarCarga` puede meter un plan inventado. Se acota cuando el ADR-011 deje de ser hipótesis, al cierre de la fase 1: entonces o se congela la lista en un `check`, o se convierte en tipo `enum`.

## Pregunta abierta

Ninguna. La que había —dónde vive el esquema— la resolvió Jesús el 20-9: `packages/db`, y está aplicada.
