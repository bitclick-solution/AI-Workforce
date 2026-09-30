VIGENTE

# Runbook · Funciones y modelos de Anthropic ausentes en Bedrock o en Vertex

Qué hacer cuando algo que existe en la API de primera parte de Anthropic no llega
todavía a Amazon Bedrock o a Google Vertex AI (ADR-017), y los pasos exactos para
activar el proveedor real de `@aiw/models` cuando existan credenciales de Bedrock
UE o de Vertex UE. Hasta entonces, el adaptador de Anthropic (`packages/models/src/adaptadores/anthropic.ts`)
solo se prueba contra el servidor simulado de `packages/models/src/pruebas/servidor-simulado.ts`.

## Riesgo del tablero

«Funciones o modelos de Anthropic que no llegan a Bedrock o Vertex» (ADR-017).
Señal medible: un modelo o una función necesaria con más de 60 días de retraso
respecto a la primera parte. El Operador comprueba la página de residencia de
datos de Anthropic en cada retro de ciclo.

## Funciones sin equivalente en Bedrock ni en Vertex, y su sustituto

| Función ausente                                                                                                                                                                                                  | Sustituto en esta plataforma                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Conector MCP nativo (`mcp_servers` + `mcp_toolset`)                                                                                                                                                              | El gateway MCP propio (`packages/mcp-gateway`), con lista blanca por puesto y nivel.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Batches API                                                                                                                                                                                                      | Ninguno todavía: las tareas de esta plataforma son interactivas o programadas por Temporal, no por lotes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Files API                                                                                                                                                                                                        | El índice de conocimiento propio (ADR-009): el conocimiento entra por ahí, no por un fichero subido a Anthropic.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Fallbacks de servidor (`fallbacks`, `server-side-fallback-*`)                                                                                                                                                    | Se implementan en cliente: `packages/models/src/respaldo.ts` (`completarConRespaldo`), que decide el papel de respaldo con la política del puesto y repite la petición con otro adaptador.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Presupuestos de tarea (`task_budget`)                                                                                                                                                                            | Los aplica el bucle del agente con el presupuesto de la política del puesto (fuera de esta rebanada: es el bucle quien los hace cumplir, no el puerto de modelo).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Herramientas de servidor de búsqueda, fetch y ejecución de código                                                                                                                                                | El conocimiento entra por el índice propio (ADR-009); no se declaran estas herramientas en las peticiones de `anthropic.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Agent Skills por API (`container.skills`)                                                                                                                                                                        | Las habilidades de un puesto se inyectan en el prompt de su versión (`version_puesto.prompt`, `habilidad_version_puesto`), no se cargan por API.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Managed Agents                                                                                                                                                                                                   | No se usa: el bucle del agente es código propio sobre este puerto (CLAUDE.md, «fronteras de arquitectura»).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Pensamiento adaptativo y `output_config.effort` en Haiku 4.5                                                                                                                                                     | Ausente en el modelo, no en la plataforma: la API de primera parte tampoco lo admite en Haiku 4.5. El adaptador omite `thinking` y `effort` para el papel `haiku45` (`SIN_PENSAMIENTO_ADAPTATIVO` en `anthropic.ts`) y solo aplica `output_config.format` cuando hace falta salida estructurada.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Restricciones numéricas, de longitud de cadena y de tamaño de array en `strict` y en `output_config.format` (`minimum`, `maximum`, `multipleOf`, `minLength`, `maxLength`, `minItems`/`maxItems` fuera de 0 o 1) | Ausente en el formato, no en una plataforma concreta: la API rechaza con 400 estas palabras clave del JSON Schema en cualquier nivel de un esquema `strict` o de `output_config.format` — en Bedrock, en Vertex y en primera parte por igual. `z.number().int()` las añade aunque el esquema Zod no las pida explícitamente (los límites del entero seguro de JavaScript), así que aparecen incluso en esquemas que no parecen acotados. `anthropic.ts` usa `transformJSONSchema` del propio SDK de Anthropic (`@anthropic-ai/sdk/lib/transform-json-schema`, la misma función que usan sus ayudantes `zodOutputFormat`/`betaJSONSchemaOutputFormat`) para quitarlas del esquema que viaja en la petición —a cualquier profundidad, también dentro de `anyOf`, `items` y `$defs`— y las deja como una nota en `description`; como la API deja de exigirlas, el adaptador vuelve a validar la salida estructurada y la entrada de cada llamada a herramienta contra el esquema Zod original al recibirlas (`llamadasHerramientaDe` en `anthropic.ts`), y lanza si no cumplen. Encontrado el 2026-09-28 al ejecutar `anthropic.bedrock.integracion.test.ts` en `main` (PR #32); reproducido sin credenciales en `anthropic.test.ts` (`describe('esquemas estrictos...')`). |
| Esfuerzo por clase de paso en el AI SDK (Mistral, locales)                                                                                                                                                       | Ausente: ninguno de esos proveedores tiene un parámetro de razonamiento adaptativo equivalente. Por eso la ruta de AI SDK (`adaptadores/ai-sdk.ts`) es para pasos baratos o deterministas, nunca para razonamiento financiero, conciliación o decisiones de escritura, que van siempre por Anthropic.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Opus 5 y Sonnet 5 en Bedrock UE por el endpoint de Mensajes (sin acceso concedido a la cuenta)                                                                                                                   | Ausente por acceso de cuenta, no por la plataforma ni por el modelo (comprobado el 2026-09-28, ver «Los dos caminos de Bedrock UE» más abajo): la cuenta recibe 403 «not available for this account» al pedir `anthropic.claude-sonnet-5` o `anthropic.claude-opus-4-8` al endpoint de Mensajes en `eu-north-1`/`eu-west-1`, y ese endpoint no ofrece ningún modelo de Anthropic en `eu-central-1`. Mientras AWS no conceda el acceso, `opus5` y `sonnet5` se sirven los dos con el perfil de inferencia UE de Sonnet 4.6 del camino clásico (`eu.anthropic.claude-sonnet-4-6`, tabla `IDENTIFICADOR_BEDROCK_EU` en `identificadores.ts`). El esfuerzo `xhigh` tampoco lo admite ese sustituto (llegó con Opus 4.7): `anthropic.ts` lo baja a `high` solo cuando el papel es provisional.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Identificador de Haiku 4.5 con fecha en Bedrock UE (excepción al ADR-018)                                                                                                                                        | El perfil de inferencia UE del camino clásico solo expone Haiku 4.5 como `eu.anthropic.claude-haiku-4-5-20251001-v1:0` (comprobado el 2026-09-28): no es un sustituto de modelo — es el mismo Haiku 4.5 objetivo —, así que `esProvisional('haiku45', 'bedrock-eu')` sigue en `false`; es solo el identificador el que lleva fecha, anotado aquí como excepción al «nunca con fecha» del ADR-018.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Identificador de Haiku 4.5 con fecha en Vertex UE (excepción al ADR-018)                                                                                                                                         | La tabla de identificadores de Agent Platform (`docs.claude.com/en/build-with-claude/claude-on-vertex-ai`, comprobada el 2026-09-29) publica Haiku 4.5 en Vertex solo como `claude-haiku-4-5@20251001` — misma forma que Opus 4.5 (`claude-opus-4-5@20251101`) para los modelos que Vertex versiona con fecha. No es un sustituto de modelo: `esProvisional('haiku45', 'vertex-eu')` sigue en `false`. Pendiente de verificar con una llamada real (`docs/runbooks/vertex-wif.md`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Opus 5.5 en Vertex UE sirviendo el papel `opus5` en vez de Opus 5 (ADR-023)                                                                                                                                      | No es una función ausente ni un sustituto degradado: Jesús eligió Opus 5.5 a propósito el 29-9-2026 porque es el sucesor de Opus 5 en el mismo escalón, más barato y con el mismo nivel de capacidad (`IDENTIFICADOR_VERTEX_UE.opus5` en `identificadores.ts`). `esProvisional('opus5', 'vertex-eu')` sigue en `false`, a diferencia del sustituto provisional de Bedrock (fila de arriba, «Opus 5 y Sonnet 5 en Bedrock UE»).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## Cómo comprobar si algo sigue ausente

1. Lee la página de residencia de datos de Anthropic (la misma que cita el
   ADR-017) y la documentación de Bedrock y de Vertex para el modelo o la función
   en cuestión.
2. Si la función ya existe en Bedrock o en Vertex, quita la fila de la tabla de
   arriba y, si el sustituto ya no hace falta, retíralo en su propia rebanada (no
   se toca fuera de la rebanada que lo pide, por las prohibiciones de `CLAUDE.md`).
3. Si han pasado más de 60 días desde que la función existe en primera parte sin
   llegar a Bedrock o a Vertex, sube la señal del riesgo en el tablero.

## Activar el proveedor real de Bedrock UE

Estado a 2026-09-28: Jesús tiene cuenta de AWS con Bedrock activado en la UE.
El SDK oficial (`@anthropic-ai/bedrock-sdk` 0.33.8) da dos caminos para hablar
con Bedrock, y solo uno funciona hoy con esta cuenta.

### Los dos caminos de Bedrock UE

| Camino                                  | Cliente del SDK          | Servicio/acción de IAM                                  | Forma del identificador                                                                                                                                         | Funciona hoy con esta cuenta                                                                                                          |
| --------------------------------------- | ------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Clásico (`bedrock-runtime`)             | `AnthropicBedrock`       | `bedrock:InvokeModel` / `InvokeModelWithResponseStream` | Perfil de inferencia entre regiones, con prefijo `eu.` (`eu.anthropic.claude-sonnet-4-6`, `eu.anthropic.claude-haiku-4-5-20251001-v1:0`)                        | **Sí** — es el que usa `clienteBedrockDesdeEntorno`                                                                                   |
| Endpoint de Mensajes (`bedrock-mantle`) | `AnthropicBedrockMantle` | `bedrock-mantle:CreateInference`                        | Identificador bajo demanda, con prefijo `anthropic.` (`anthropic.claude-sonnet-5`) — nunca con `eu.` ni con ARN de perfil: esas formas dan 404 en este endpoint | No — 403 «not available for this account» en Sonnet 5 y Opus 4.8; `eu-central-1` no ofrece ningún modelo de Anthropic por este camino |

El adaptador de Anthropic (`anthropic.ts`) no distingue entre los dos: los dos
exponen la misma superficie `messages.create` (`cliente-mensajes.ts`). Lo único
que cambia es qué función de `clientes.ts` construye el cliente y qué tabla de
`identificadores.ts` resuelve el identificador. Volver del clásico al endpoint
de Mensajes, en cuanto AWS conceda acceso, es cambiar esos dos puntos — nunca
una promoción de versión de puesto (la versión de puesto solo conoce el papel,
`opus5`/`sonnet5`/`haiku45`, nunca el identificador real).

### Por qué `eu-north-1` y no Fráncfort

`eu-central-1` (Fráncfort) fue la región primaria elegida el 2026-09-22, pero el
endpoint de Mensajes no ofrece ningún modelo de Anthropic ahí (`GET /v1/models`
devuelve 33 modelos, ninguno de Anthropic). `eu-north-1` (Estocolmo) y
`eu-west-1` (Irlanda) sí ofrecen los modelos de Anthropic por el endpoint de
Mensajes, y `eu-north-1` es además la región donde el camino clásico expone los
perfiles de inferencia UE con los que la cuenta sí tiene acceso — por eso
`AIW_BEDROCK_REGION_UE` vale hoy `eu-north-1`, no `eu-central-1`. Los perfiles
de inferencia UE reparten la inferencia entre varias regiones de la UE (nunca
fuera de ella), así que sigue cumpliendo la residencia de datos del ADR-017.

### Cómo listar los modelos de cada camino

- **Endpoint de Mensajes** (`bedrock-mantle`): `GET /v1/models` contra
  `https://bedrock-mantle.<región>.api.aws/anthropic/v1/models`, firmado con
  SigV4 (las credenciales de `aiw-dev` sirven). Devuelve el catálogo completo de
  modelos —de Anthropic y de otros proveedores— disponibles por ese camino en
  esa región para esta cuenta.
- **Camino clásico** (`bedrock-runtime`): `aws bedrock list-inference-profiles
--region eu-north-1` lista los perfiles de inferencia entre regiones a los
  que tiene acceso la cuenta (busca los que empiezan por `eu.anthropic.`); `aws
bedrock-runtime converse --region eu-north-1 --model-id
eu.anthropic.claude-sonnet-4-6 --messages '[{"role":"user","content":[{"text":"ping"}]}]'`
  hace una llamada mínima para confirmar que un perfil concreto responde.

### Qué significa un 403 «not available for this account»

Es un problema de acceso de la cuenta a ese modelo en ese camino, no un
problema de código ni de la plataforma: la cuenta de AWS no tiene ese modelo
habilitado en el endpoint de Mensajes en esa región. No se arregla cambiando el
adaptador, la tabla de identificadores ni la región (ya se probó `eu-north-1` y
`eu-west-1`, con el mismo 403 en Sonnet 5 y Opus 4.8): lo resuelve solo AWS
concediendo el acceso que Jesús ha pedido. Un 404 «The model ... does not
exist», en cambio, sí es de código: normalmente significa que se está pidiendo
un identificador del camino clásico (con `eu.` o un ARN de perfil) contra el
endpoint de Mensajes, o al revés.

### Pasos

1. Cuenta de AWS con Amazon Bedrock activado en `eu-north-1` (ver arriba por
   qué no Fráncfort). Mientras el endpoint de Mensajes no tenga acceso
   concedido para la familia 5, el adaptador usa el camino clásico con los
   perfiles de inferencia UE de Sonnet 4.6 y Haiku 4.5 (filas de la tabla de
   arriba) — eso ya funciona con el acceso actual de la cuenta.
2. Credenciales: **sin claves guardadas en ningún sitio de CI.** En local, la
   clave de acceso del usuario de IAM `aiw-dev`; en producción, la de
   `aiw-prod`; en GitHub Actions, el rol `aiw-ci-bedrock` asumido por OIDC, con
   una relación de confianza que solo admite ejecuciones sobre `main` (con los
   identificadores inmutables que GitHub emite para la organización y el
   repositorio): en un PR, asumir el rol falla. La política IAM mínima
   —incluida la sentencia de `bedrock:InvokeModel`/`InvokeModelWithResponseStream`
   sobre los ARN de perfil y de modelo base UE— y la relación de confianza
   exactas: `docs/runbooks/bedrock-iam-oidc.md`.
3. Variables: `AIW_BEDROCK_REGION_UE` (variable de repositorio y del `.env`,
   hoy `eu-north-1`) y, en GitHub Actions, `AWS_ROLE_ARN` (variable de
   repositorio, no un secreto: sin la relación de confianza de OIDC no sirve
   para nada) — las dos ya existen. Ya cableadas en el job **Bedrock UE ·
   integración** de `.github/workflows/ci.yml`, que corre solo desde `main`,
   una vez a la semana o a mano desde la pestaña Actions —nunca en cada PR,
   para no pagar modelos en cada revisión (decisión de Jesús, 2026-09-25)—.
4. `clienteBedrockDesdeEntorno` (`packages/models/src/adaptadores/clientes.ts`)
   construye el cliente clásico (`AnthropicBedrock`) en cuanto
   `AIW_BEDROCK_REGION_UE` existe; antes de eso, lanza con el nombre exacto de
   lo que falta. `clienteBedrockMantleDesdeEntorno` construye el cliente del
   endpoint de Mensajes (`AnthropicBedrockMantle`) con la misma variable, listo
   para cuando se retome ese camino, pero ningún adaptador lo usa hoy.
5. `AIW_BEDROCK_IDENTIFICADOR_MODELO` sigue siendo una anulación opcional —
   nombre neutro a propósito, sin la versión del modelo: la matriz provisional
   puede volver a cambiar. Úsala si el catálogo de Bedrock exige un perfil de
   inferencia distinto del de `identificadores.ts` sin tocar el código;
   `anthropic.bedrock.integracion.test.ts` y cualquier puesto que use
   `crearAdaptadorAnthropic` la leen con `identificadorModelo`. Repite la
   comprobación de la sección «Cómo listar los modelos de cada camino» cada vez
   que la matriz provisional cambie de modelo.
6. Las tarifas reales de Bedrock UE (Opus 5.5, Opus 5, Sonnet 5, Opus 4.6, Sonnet
   4.6, Haiku 4.5, con región, moneda de origen y tipo de cambio) ya están dadas de
   alta en el catálogo de desarrollo
   (`packages/ledger/src/datos/tarifas-ejemplo.json`); Operación las carga en cada
   tenant real con `registrarTarifa`. El tipo de cambio EUR/USD de ese catálogo
   (0,92) es una referencia de desarrollo — sustitúyelo por el tipo de cambio
   versionado real antes de facturar con él.
7. Los casos dorados de Cobros y de Conciliación ya corren contra este cliente
   real (`smoke/cobros-modelos-v1.bedrock.integracion.test.ts`,
   `conciliacion-modelos-v1.bedrock.integracion.test.ts` — cuerpo común con los
   de Vertex en `casos-dorados-proveedor-real.compartido.ts`, para no
   duplicarlos): mismo salto sin credenciales que la prueba de integración de
   arriba, y los ejecuta el job **Bedrock UE · integración** de `ci.yml` detrás
   de sus 5 pruebas. Con eso queda cerrado el criterio de hecho pendiente de
   «Modelos v1» («pasa con el proveedor real»); no hace falta repetir nada aquí
   salvo que la matriz provisional cambie de modelo.

### Cómo volver al endpoint de Mensajes cuando AWS conceda Sonnet 5 y Opus 5

1. Confirma el acceso: repite `GET /v1/models` en `bedrock-mantle` (sección
   «Cómo listar los modelos de cada camino») en `eu-north-1` o `eu-west-1` y
   comprueba que ya no da 403 al invocar `anthropic.claude-sonnet-5`.
2. En `packages/models/src/adaptadores/anthropic.ts` (o en el punto donde se
   instala el adaptador de cada puesto), cambia la fábrica de cliente de
   `clienteBedrockDesdeEntorno` a `clienteBedrockMantleDesdeEntorno`.
3. En `packages/models/src/identificadores.ts`, retira la fila `bedrock-eu` de
   `IDENTIFICADOR_BEDROCK_EU` (o vacía las entradas que ya tengan acceso) para
   que `identificadorDeModelo` vuelva a devolver `anthropic.claude-sonnet-5` /
   `anthropic.claude-opus-5` / `anthropic.claude-haiku-4-5` — el identificador
   bajo demanda del endpoint de Mensajes, sin `eu.` ni fecha.
4. Ningún cambio de versión de puesto: `opus5`/`sonnet5`/`haiku45` siguen siendo
   los mismos papeles: la versión de puesto nunca supo que estaba en modo
   provisional ni con qué cliente se servía.
5. Actualiza las pruebas unitarias (`identificadores.test.ts`, `anthropic.test.ts`,
   `clientes.test.ts`) a los identificadores objetivo y repite el paso 7 de
   arriba con los casos dorados.

## Activar el proveedor real de Vertex UE (implementado, sin cuota — ADR-023)

Estado a 2026-09-29: Jesús ha habilitado Vertex AI en el proyecto de Google
Cloud de Bitclick, con Opus 5.5, Sonnet 5 y Haiku 4.5 visibles en el Model
Garden de la multirregión europea (`eu`) — pero, igual que Bedrock, sin cuota
concedida todavía para invocarlos. El ADR-023 vuelve al cliente clásico de
Bedrock UE como proveedor por defecto (`AIW_PROVEEDOR_MODELOS=bedrock-ue`);
Vertex UE queda implementado y documentado, listo para cuando Google conceda
la cuota. Pasos completos, con los comandos de Cloud Shell (para entonces, no
para ejecutar ahora) y la política mínima de la cuenta de servicio de la CI:
`docs/runbooks/vertex-wif.md`. Resumen:

1. Proyecto de Google Cloud con Vertex AI activado y Opus 5.5, Sonnet 5 y
   Haiku 4.5 visibles en el Model Garden en la multirregión `eu` — ya hecho.
   Cuota: pendiente de que Google la conceda.
2. Credenciales de Google, nunca una clave de API (el SDK de Vertex no la
   admite): `gcloud auth application-default login` en desarrollo, o una
   cuenta de servicio con el rol mínimo en producción; en GitHub Actions, sin
   ninguna clave guardada, la cuenta de servicio `aiw-ci-vertex` se asume por
   federación de identidades (WIF) — `docs/runbooks/vertex-wif.md`.
3. Variables de entorno: `AIW_VERTEX_REGION_UE=eu` y `AIW_VERTEX_PROJECT_ID`
   con el proyecto de GCP. `clienteVertexDesdeEntorno` construye el cliente
   real en cuanto las dos existen y con una ubicación de la UE válida
   (`eu` o una región concreta `europe-*`); antes de eso, o con cualquier otra
   ubicación, lanza con el nombre exacto de lo que falta o de por qué la
   rechaza.
4. Cambiar de proveedor principal entre Bedrock UE y Vertex UE (ADR-023) es
   cambiar `AIW_PROVEEDOR_MODELOS` (por defecto `bedrock-ue`), sin tocar
   código — `packages/models/src/proveedor.ts`, detallado en
   `docs/runbooks/vertex-wif.md`. El job **Vertex UE · integración** en
   `ci.yml` es solo manual (sin el cron semanal de Bedrock) hasta que haya
   cuota.
5. En cuanto haya cuota y la prueba de integración
   (`packages/models/src/adaptadores/anthropic.vertex.integracion.test.ts`)
   pase en la CI, repite los casos dorados de Cobros y de Conciliación contra
   el cliente real
   (`packages/evals/smoke/cobros-modelos-v1.vertex.integracion.test.ts`,
   `conciliacion-modelos-v1.vertex.integracion.test.ts`).
6. Mismo paso 6 que en Bedrock (tarifas reales en el catálogo de desarrollo),
   con la plataforma `vertex-eu`.

## Activar el coste por tarea en Langfuse

1. Cuenta de Langfuse (nube europea o autoalojado) con un proyecto para AI
   Workforce.
2. Variables de entorno del worker: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` y,
   si no es la nube pública de Langfuse, `LANGFUSE_BASE_URL`.
3. `observadorDesdeEntorno` (`packages/models/src/observabilidad/langfuse.ts`)
   construye el observador real en cuanto las dos claves existen; sin ellas,
   usa el observador nulo y no manda nada, sin romper la tarea.

## Uso interno con la API de primera parte (ADR-017)

Solo para usos sin datos de clientes: Revisor en la integración continua, fábrica
de agentes, evals con datos sintéticos. Nunca para una tarea de un tenant, porque
la primera parte no mantiene la inferencia en la UE. Variable de entorno:
`ANTHROPIC_API_KEY`, resuelta por `clientePrimeraParteDesdeEntorno`.
