VIGENTE

# Especificación · Contador de tareas v0

- Rebanada: [Notion](https://app.notion.com/p/3e05306618988170be9dfa52b96253ac) · Ciclo 0 (Fase 0 · Definir y validar) · Tipo Plataforma · Paquetes `ledger`, `api` (y `db` por la migración y el registro de tablas) · P0
- Rama: `rebanada/contador-de-tareas-v0`
- Plan de referencia: secciones del contador de tareas y del modelo comercial del [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn); ADR-003 (la tarea como unidad de consumo y contador), ADR-005 (versiones inmutables), ADR-007 (modelo de datos y cimientos), ADR-011 (modelo comercial, hipótesis).
- Zona crítica: sí: `packages/ledger` (libro de auditoría y contador), `packages/db` con una migración de datos (`**/drizzle/**`) y `.github/workflows/ci.yml` (una línea para que el job «Base de datos» ejecute también las pruebas de la API contra PostgreSQL). «Revisión humana obligatoria» marcada en la rebanada.

## Objetivo

Cuando esta rebanada está hecha, la plataforma sabe cuánto ha trabajado y cuánto ha costado cada tenant sin que nadie lo apunte a mano: una tarea raíz suma exactamente una unidad al contador, el coste de modelos sale de los usos reales con una tarifa versionada, y el panel lo lee por API con aislamiento por tenant. Es la pieza que convierte el ADR-003 —«la tarea es la unidad de ejecución, consumo, auditoría y aprobación»— en números que se pueden facturar y discutir, y la que da al aviso al 80 % y a la pausa al 100 % un contador del que leer.

## Paquetes tocados

- `packages/ledger`: esquema de los usos de modelo y de las tarifas, puntos de escritura del contador (`contador.ts`) y consultas de lectura del panel (`contador-consultas.ts`). Se construye **sobre** `anotar`, no a su lado: toda suma al contador sigue pasando por el punto único de escritura del libro.
- `apps/api`: servidor HTTP mínimo con las tres rutas de lectura del contador, detrás de bandera de funcionalidad. Depende de `@aiw/db` (conexión y tenant por transacción) y de `@aiw/ledger` (consultas).
- `apps/web`: vista mínima del panel detrás de bandera, con la lógica en `lib/contador.ts` y un proxy en el servidor de Next para que el token no llegue al navegador.
- `packages/db`: migración `0001_contador_uso_de_modelos.sql` con su reverso, y el registro de tablas (`tablas.ts`) al que se añaden las dos tablas nuevas.

## Decisiones que el plan no fija

1. **Una tarea raíz es una unidad; las delegaciones y las intervenciones no suman otra.** El criterio del tablero —«cada tarea raíz suma uno al contador del tenant, incluidas delegaciones e intervenciones»— se lee con el ADR-003 en la mano: «delegaciones e intervenciones en sala cuentan **dentro** de su tarea raíz». Lo que se incluye es su **consumo** (pasos, acciones y coste), no una unidad de tarea nueva. Si cada delegación sumara una unidad, el mismo trabajo costaría el doble por estar repartido entre dos puestos, y el cliente pagaría por nuestra decisión de diseño interno en vez de por su encargo. Una tarea es raíz cuando `tarea_raiz_id` es nulo o igual a su propio `id`; una delegación tiene `tarea_padre_id`, y una intervención en sala entra en una tarea que ya existe.
2. **El doble conteo se evita con el propio libro de auditoría, sin tabla nueva.** Contar una tarea raíz es anotar la acción `tarea.contada` con su `tarea_id` e `incrementos.tareas = 1`. Antes de anotar, `registrarTareaRaiz` toma el mismo cerrojo consultivo por tenant que usa `anotar` —reentrante dentro de la misma transacción— y comprueba que no exista ya una entrada `tarea.contada` para esa tarea. Con eso, dos reintentos de la misma actividad de Temporal, o dos trabajadores a la vez, suman una sola unidad, y la prueba de que se contó una vez es una fila del libro y no un contador que hay que creerse. El índice `entrada_auditoria_tenant_tarea_idx` ya existe y hace la comprobación barata.
3. **Las tareas fallidas y canceladas cuentan.** El trabajo se ejecutó, los modelos se pagaron y la auditoría lo registra; descontarlas exigiría decidir cuándo un fallo es nuestro y cuándo del sistema del cliente, y eso es una decisión comercial, no técnica. Lo que sí hace esta rebanada es dejarlo medido: el endpoint de tareas devuelve el reparto por estado, para que la decisión se tome con datos. Ver la pregunta abierta.
4. **El coste de modelos se congela en el momento del uso.** `uso_modelo` guarda los tokens reales, la tarifa que se le aplicó (`tarifa_modelo_id`) y el coste resultante. Cambiar mañana una tarifa no reescribe el coste de ayer, igual que una versión de puesto no cambia el pasado (ADR-005). La fila es inmutable: no hay `UPDATE` legítimo sobre un consumo ya registrado.
5. **La tarifa es un dato por tenant con vigencia, sin `vigente_hasta`.** `tarifa_modelo` lleva `tenant_id` como toda tabla del modelo (RLS incluida), y la tarifa aplicable a un uso es la de mayor `vigente_desde` menor o igual al momento del uso para ese proveedor y modelo. No hay columna de cierre de vigencia porque cerrarla sería un `UPDATE` sobre una fila inmutable: el cierre es la fila siguiente. Por tenant y no global porque el ADR-011 prevé precios por partner y licencia on-premise, y porque una tabla sin `tenant_id` rompería la regla de RLS de `CLAUDE.md` para ahorrarse unas filas. El catálogo de desarrollo vive en `packages/ledger/datos/tarifas-ejemplo.json` y lo carga una operación de plataforma; el código de cálculo nunca lleva un precio escrito.
6. **«En tiempo real» se implementa como salida transaccional más sondeo.** Cada escritura del contador inserta un `evento_salida` (`tipo` `contador.actualizado`, `destino` `panel`) en la misma transacción, que es lo que exige `CLAUDE.md`: el evento sale de la salida transaccional y nunca del código de negocio. Publicar en Centrifugo es trabajo del publicador de `evento_salida`, que pertenece a la rebanada «Salas y tiempo real» y hoy no existe; meterlo aquí sería construir la mitad de otra rebanada. El panel v0 sondea cada cinco segundos y cada respuesta lleva `ultimaAnotacion` (el número de orden más alto del tenant), así que el panel detecta un cambio comparando un entero. Cuando el publicador exista, el panel cambia de sondeo a suscripción sin tocar el modelo ni la API: los eventos ya están escritos.
7. **La API usa `node:http` y no un framework.** `apps/api` no tiene servidor HTTP todavía, y elegir el framework es decisión de la rebanada que monte la API de verdad; el ADR-002 nombra el stack pero no la capa HTTP. Tres rutas de lectura se sirven con el módulo estándar sin añadir dependencias externas, y sin tocar el lockfile más de lo imprescindible mientras corre otra rebanada en paralelo. El enrutado vive en `src/rutas/contador.ts` y se registra con una línea.
8. **Las marcas de tiempo salen de la base ya en ISO 8601.** El driver de Drizzle sustituye los intérpretes de fecha del cliente de `postgres` que comparte (`drizzle-orm/postgres-js` pone un intérprete transparente para los tipos 1082, 1083, 1114 y 1184), así que el mismo `select now()` devuelve un `Date` con un cliente crudo y una cadena con el cliente de `crearConexion`. Las consultas del panel y el reloj del uso de modelo formatean en SQL con `to_char`, de modo que la respuesta no depende de por dónde llegó la conexión. Se descubrió montando la API: la primera versión reventaba con `toISOString is not a function` solo al servirse por HTTP. Hay un hallazgo asociado en `anotar`, en la sección de hallazgos.
9. **El tenant llega por cabecera y la ruta exige un token del entorno.** No hay identidad todavía («Identidad y organizaciones»). La bandera `AIW_CONTADOR_V0` activa las rutas y `AIW_CONTADOR_TOKEN` es obligatorio para que se activen: sin token en el entorno la ruta no existe, así que no se puede desplegar por descuido una API que solo pide una cabecera de tenant. El token viaja en `Authorization: Bearer` y se compara en tiempo constante; el tenant viaja en `x-aiw-tenant` y se valida como UUID antes de tocar la base. Queda como deuda conocida, con su sitio de pago.

## Endpoints, flujos y datos

### Datos

Migración `packages/db/drizzle/0001_contador_uso_de_modelos.sql`, con reverso en `packages/db/drizzle/reverso/0001_contador_uso_de_modelos.sql`. Es autocontenida: solo depende de objetos que crea la migración inicial (roles, `uuid_generar_v7()`, `aiw_tenant_actual()`, `aiw_fila_inmutable()`, `organizacion`, `tarea`, `paso`, `puesto`, `version_puesto`), no del orden en que se apliquen otras migraciones `000N` que lleguen de otra rebanada, y no altera ninguna tabla existente. Asume `aiw_migrador` como dueño, igual que la inicial, para que las tablas nuevas no queden a nombre del usuario que migró ese día.

- `tarifa_modelo`: `tenant_id`, `proveedor`, `modelo`, `euros_por_millon_entrada`, `euros_por_millon_salida`, `euros_por_millon_entrada_cache`, `vigente_desde`, `fuente`, `creado_en`. Única sobre `(tenant_id, proveedor, modelo, vigente_desde)`. Inmutable: `UPDATE` prohibido por disparador para todo el mundo, `UPDATE` y `DELETE` retirados a `aiw_app`.
- `uso_modelo`: `tenant_id`, `tarea_id`, `tarea_raiz_id`, `paso_id`, `puesto_id`, `version_puesto_id`, `proveedor`, `modelo`, `tokens_entrada`, `tokens_salida`, `tokens_entrada_cache`, `llamadas`, `tarifa_modelo_id`, `coste_euros`, `clave_idempotencia`, `creado_en`. Única sobre `(tenant_id, clave_idempotencia)`, que es lo que hace idempotente el registro frente a los reintentos de Temporal. Claves foráneas con `on delete restrict`, `check` de tokens y llamadas no negativos. Inmutable igual que la anterior.
- Las dos llevan RLS activada y forzada con política por tenant, e índices que empiezan por `tenant_id`; entran en `ORDEN_PURGA` antes de `paso` y `tarea` (a las que referencian), así que la purga y la exportación de una organización las cubren sin tocar `mantenimiento.ts`.

### Escritura (`packages/ledger/src/contador.ts`)

- `registrarTareaRaiz(tx, tenantId, { tareaId, puestoId, versionPuestoId, origen })`: cuenta la unidad de tarea, una sola vez, y devuelve si contó o si ya estaba contada.
- `registrarUsoDeModelo(tx, tenantId, uso)`: resuelve la tarifa vigente, calcula el coste, inserta el uso, anota la acción `modelo.uso` con ese coste —que es lo que lo suma al contador— y emite el evento de salida. Sin tarifa vigente falla con un mensaje que dice qué proveedor y modelo faltan, y la transacción no deja rastro.
- `registrarTarifa(tx, tenantId, tarifa)`: alta de una tarifa como dato, con su entrada en el libro. Es la operación con la que Operación carga el catálogo.
- `calcularCosteEuros(tarifa, tokens)`: función pura, redondeo a cuatro decimales (la escala de la columna), sin precios escritos dentro.

### Lectura (`packages/ledger/src/contador-consultas.ts`)

- `consumoDelPeriodo(tx, tenantId)`: tareas, pasos, acciones y coste del mes en curso, más `ultimaAnotacion`.
- `tareasDelPeriodo(tx, tenantId, limite)`: tareas raíz del periodo con su coste de modelos, su estado y su puesto, y el reparto por estado.
- `costePorPuesto(tx, tenantId)` y `costeDeTareaRaiz(tx, tenantId, tareaRaizId)`: agregados desde `uso_modelo`, con el coste de las delegaciones sumado a su raíz.

### API (`apps/api`)

Servidor `node:http` en `src/servidor.ts`, rutas en `src/rutas/contador.ts`, registradas con una línea en `main.ts`:

| Ruta                             | Devuelve                                   |
| -------------------------------- | ------------------------------------------ |
| `GET /contador/periodo`          | consumo del periodo en curso del tenant    |
| `GET /contador/tareas`           | tareas raíz del periodo con coste y estado |
| `GET /contador/coste-por-puesto` | coste de modelos agregado por puesto       |

Cada petición abre una transacción con `conTenant`, así que la RLS filtra por `aiw.tenant_id` y no por un `where` que alguien pueda olvidar. Sin bandera o sin token en el entorno: `404`. Token ausente o distinto: `401`. Tenant que no es UUID: `400`. Método que no es `GET`: `405`. Ruta desconocida bajo la bandera: `404`. Nada de cachés: `Cache-Control: no-store`.

El proceso solo abre el puerto si hay algo que servir —bandera, token y `DATABASE_URL`—; si no, dice qué es y termina. Esto no es un detalle: el job «Imagen api» de la CI arranca el contenedor y espera que salga, así que una API que escuchara siempre lo dejaría colgado.

### Panel (`apps/web`)

`/panel/contador` detrás de `AIW_PANEL_CONTADOR`; sin bandera, `notFound()`. El componente de cliente sondea `/api/contador`, un proxy del servidor de Next que añade el token y el tenant desde el entorno: el navegador nunca ve el token. Muestra tareas del periodo, coste, coste por puesto y la última actualización, y avisa cuando los datos son de hace más de treinta segundos.

## Criterios de hecho

1. `registrarTareaRaiz` suma exactamente una unidad a `contador_consumo.tareas` por tarea raíz; llamarla dos veces con la misma tarea deja el contador igual y devuelve `yaEstaba`. Una delegación (`tarea_padre_id` no nulo) no suma unidad de tarea, y su coste y sus acciones acaban en el contador del tenant y en el coste de su tarea raíz.
2. `registrarUsoDeModelo` inserta una fila en `uso_modelo` con el coste calculado desde la tarifa vigente en el momento del uso, anota `modelo.uso` en el libro y suma ese coste al contador; la suma de `uso_modelo.coste_euros` del periodo cuadra con lo que devuelve `costePorPuesto` y con el coste de las entradas `modelo.uso` del libro.
3. Repetir `registrarUsoDeModelo` con la misma `clave_idempotencia` no duplica el uso ni el coste ni la entrada del libro.
4. Sin tarifa vigente para el proveedor y el modelo, `registrarUsoDeModelo` falla y no deja fila en `uso_modelo`, ni entrada en el libro, ni suma en el contador.
5. Registrar una tarifa nueva más cara no cambia el coste de los usos ya registrados.
6. Cada escritura del contador deja un `evento_salida` con `tipo = 'contador.actualizado'` en la misma transacción.
7. `GET /contador/periodo`, `/contador/tareas` y `/contador/coste-por-puesto` devuelven los datos del tenant de la cabecera y solo de ese tenant; con el tenant del vecino, ceros. Sin bandera, `404`; sin token válido, `401`; tenant no UUID, `400`.
8. La vista `/panel/contador` responde con la bandera puesta y `404` sin ella; el proxy no expone el token en la respuesta ni en el HTML.
9. `pnpm --filter @aiw/db db:migrar` aplica `0001` sobre una base con solo la inicial y `db:revertir` la deja sin rastro; las dos tablas nuevas salen con RLS activada y forzada, con política de tenant, inmutables para el rol de aplicación y para el dueño del esquema, y con `aiw_migrador` como dueño. Las pruebas de esquema y de migración de `@aiw/db` pasan con las dos migraciones.
10. La CI ejecuta todo lo nuevo. El job «Base de datos» pasa a correr también `@aiw/api` —una línea, con `--workspace-concurrency=1` porque los tres paquetes comparten una sola base y alguna suite vacía el libro al terminar—; el resto de las pruebas de `apps/api` y `apps/web` no necesitan base y corren en el job «Pruebas», donde las que sí la necesitan se saltan con su mensaje.

## Casos de prueba y de eval

- Unitario sin base de datos (`packages/ledger/src/contador.test.ts`): el cálculo del coste redondea a cuatro decimales y trata los tokens de caché aparte; tokens o llamadas negativos, tarifas con precios negativos y claves de idempotencia vacías se rechazan antes de tocar la base; la tarifa elegida entre varias es la de mayor `vigente_desde` no futura respecto al uso; ninguna tarifa lleva precio escrito en el código.
- Unitario de la API (`apps/api/src/rutas/contador.test.ts`): las respuestas de error (`404` sin bandera, `404` sin token en el entorno, `401` con token que no cuadra —incluidos un token de más, uno de menos, otro esquema y ninguno—, `400` con tenant que no es UUID, `405` si no es `GET`) y el camino feliz con un lector inyectado; la comparación del token no depende de la longitud; ninguna respuesta devuelve el token.
- Integración de la API (`apps/api/src/pruebas/contador-http.test.ts`): el servidor montado contra PostgreSQL con el rol `aiw_app`, incluidos el vecino que pregunta lo mismo y recibe ceros, y el `404` de lo que no es del contador. Es lo único que prueba el cableado completo, y por eso el job «Base de datos» de la CI ejecuta ahora este paquete.
- Unitario del panel (`apps/web/lib/contador.test.ts`): lectura de la bandera, formato de euros y de tareas en español, detección de datos rancios, y camino de error cuando la API responde `401` o no responde.
- Integración con PostgreSQL (`packages/ledger/src/pruebas/contador.test.ts`): los criterios 1 a 6 sobre una base migrada y dos organizaciones sembradas, incluidos el aislamiento entre tenants con el rol `aiw_app`, la inmutabilidad de las dos tablas y el reintento concurrente de la misma tarea raíz (ocho a la vez, una sola unidad).
- Esquema y migración (`packages/db`): las pruebas existentes pasan a mirar todas las migraciones y no solo la inicial; se añade que `0001` crea las dos tablas con RLS, política, índice por tenant, disparador de inmutabilidad y reverso completo.
- Eval: no aplica. Esta rebanada no añade comportamiento de agente: no hay prompt, ni herramienta, ni decisión del modelo. El primer caso dorado llega con el bucle del agente, y la certificación de puesto no se toca.
- Auditoría y contador: no hay escritura que no pase por `anotar`. `registrarTareaRaiz` anota `tarea.contada`, `registrarUsoDeModelo` anota `modelo.uso` con el coste, y `registrarTarifa` anota `tarifa.registrada`; las tres suman al contador en la misma transacción que su dato, y la prueba comprueba que el contador cuadra con el libro y con `uso_modelo`.
- Secretos: el token de la API sale de `process.env` y `.env.example` lleva `AIW_CONTADOR_TOKEN=GENERAR`; la prueba de secretos de `@aiw/ledger` ya recorre el paquete con la regla de `@aiw/db/pruebas`, y se añade la misma comprobación a `apps/api`. El catálogo de tarifas de desarrollo no es una credencial y no lleva ninguna.

## Fuera de alcance

- Aviso al 80 % y pausa al 100 % del cupo, y consumo de los paquetes prepagados de `paquete_tareas`: rebanada «Cupos y avisos». Aquí está el contador del que leerán.
- Publicador de `evento_salida` hacia Centrifugo y suscripción del panel: rebanada «Salas y tiempo real». Aquí se escriben los eventos.
- Identidad, sesión y permisos del panel: rebanada «Identidad y organizaciones». Aquí, cabecera de tenant y token del entorno detrás de bandera.
- Facturación, Stripe y emisión de facturas: fase 2. Aquí, el consumo medido del que saldrá la factura.
- Instrumentación del bucle del agente que llamará a `registrarUsoDeModelo` con los usos del AI SDK, y proyección de `tarea` desde el historial de Temporal: rebanadas del motor. Aquí, los puntos de escritura y sus pruebas.
- Panel completo con gráficas, rangos de fechas y exportación a CSV: rebanada «Panel v1». Aquí, la vista mínima que pide la lista de hecho.
- Tarifas por región o en moneda distinta del euro, y tarifas de embeddings y de herramientas de pago: cuando existan; el modelo las admite sin migración porque proveedor y modelo son texto.

## Presupuesto de tokens

Presupuesto: 70 €, propuesto por esta especificación y fijado en «Presupuesto tokens (€)» de la rebanada, que estaba vacío. La referencia es «Modelo de datos v1» (60 €, tres paquetes y una migración grande); esta toca cuatro paquetes con una migración pequeña, código de escritura y de lectura, una API y una vista. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Deuda conocida

1. **La API no tiene identidad: confía en la cabecera `x-aiw-tenant`.** El token del entorno y la bandera evitan exponerla por descuido, pero cualquiera que tenga el token puede leer el contador de cualquier tenant. Se paga en «Identidad y organizaciones»: la sesión decide el tenant y la cabecera desaparece. Hasta entonces, la bandera se queda apagada fuera de desarrollo y de staging.
2. **`registrarUsoDeModelo` exige que el llamante traiga una clave de idempotencia.** Lo natural es el identificador de la petición del proveedor, que hoy no existe porque no hay bucle de agente. Se paga con la instrumentación del bucle: la clave pasa a ser el identificador de petición del AI SDK.
3. **Nadie carga el catálogo de tarifas automáticamente.** `registrarTarifa` existe y el catálogo de desarrollo también, pero el alta en un tenant nuevo es manual hasta que exista el flujo de contratación. Se paga en «Contratación y onboarding».
4. **El coste de la tarea raíz se calcula agregando, no se guarda en `tarea.coste_euros`.** La columna existe y sigue a cero: actualizarla en cada uso convertiría la tarea en un punto de contención y duplicaría la verdad. La proyección desde Temporal la rellenará cuando exista, y entonces el agregado sirve para comprobarla.
5. **Las consultas nuevas no están en el banco de carga.** El banco de `packages/db/bench` mide las cuatro consultas del panel del modelo v1 con un millón de entradas; las tres del contador no entran porque la carga sintética no genera `uso_modelo` y añadir el generador es más rebanada que esta. Se paga cuando el motor produzca usos reales: entonces se miden con datos de verdad y no con filas inventadas.

## Hallazgos

Lo que esta rebanada encontró fuera de su alcance y no toca, para que se decida con rebanada propia.

1. **El hash del libro depende de por dónde llegó la conexión.** `anotar` toma `clock_timestamp()` y mete el valor en el hash. Con un cliente crudo de `postgres` eso es un `Date` y `serializarCanonico` lo escribe en ISO 8601; con el cliente de `crearConexion` —el que usa la aplicación— Drizzle ha sustituido el intérprete del tipo 1184 y llega una cadena como `2026-09-20 12:45:00.123+00`, que se firma tal cual. La cadena verifica dentro de un mismo entorno, porque escribir y leer usan el mismo cliente, pero dos entornos con clientes distintos calculan hashes distintos para la misma entrada, y eso es justo lo que el libro promete que no pasa a seis años vista. El arreglo es de una línea —normalizar el momento antes de firmarlo— pero toca `libro.ts`, que es zona crítica y está en medio de otra rebanada; propuesta como rebanada propia con su prueba de que el hash es el mismo con los dos clientes.

## Pregunta abierta

¿Las tareas raíz que terminan en error o canceladas se descuentan del cupo del cliente? Esta rebanada las cuenta y además deja el reparto por estado medido en el endpoint de tareas, así que la decisión se puede tomar con datos y aplicarse en «Cupos y avisos» sin tocar el modelo. Solo tú puedes decidirlo: es una promesa comercial, no una regla técnica.
