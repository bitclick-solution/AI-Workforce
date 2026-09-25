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

| Función ausente                                                   | Sustituto en esta plataforma                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conector MCP nativo (`mcp_servers` + `mcp_toolset`)               | El gateway MCP propio (`packages/mcp-gateway`), con lista blanca por puesto y nivel.                                                                                                                                                                                                                                                                                                                          |
| Batches API                                                       | Ninguno todavía: las tareas de esta plataforma son interactivas o programadas por Temporal, no por lotes.                                                                                                                                                                                                                                                                                                     |
| Files API                                                         | El índice de conocimiento propio (ADR-009): el conocimiento entra por ahí, no por un fichero subido a Anthropic.                                                                                                                                                                                                                                                                                              |
| Fallbacks de servidor (`fallbacks`, `server-side-fallback-*`)     | Se implementan en cliente: `packages/models/src/respaldo.ts` (`completarConRespaldo`), que decide el papel de respaldo con la política del puesto y repite la petición con otro adaptador.                                                                                                                                                                                                                    |
| Presupuestos de tarea (`task_budget`)                             | Los aplica el bucle del agente con el presupuesto de la política del puesto (fuera de esta rebanada: es el bucle quien los hace cumplir, no el puerto de modelo).                                                                                                                                                                                                                                             |
| Herramientas de servidor de búsqueda, fetch y ejecución de código | El conocimiento entra por el índice propio (ADR-009); no se declaran estas herramientas en las peticiones de `anthropic.ts`.                                                                                                                                                                                                                                                                                  |
| Agent Skills por API (`container.skills`)                         | Las habilidades de un puesto se inyectan en el prompt de su versión (`version_puesto.prompt`, `habilidad_version_puesto`), no se cargan por API.                                                                                                                                                                                                                                                              |
| Managed Agents                                                    | No se usa: el bucle del agente es código propio sobre este puerto (CLAUDE.md, «fronteras de arquitectura»).                                                                                                                                                                                                                                                                                                   |
| Pensamiento adaptativo y `output_config.effort` en Haiku 4.5      | Ausente en el modelo, no en la plataforma: la API de primera parte tampoco lo admite en Haiku 4.5. El adaptador omite `thinking` y `effort` para el papel `haiku45` (`SIN_PENSAMIENTO_ADAPTATIVO` en `anthropic.ts`) y solo aplica `output_config.format` cuando hace falta salida estructurada.                                                                                                              |
| Esfuerzo por clase de paso en el AI SDK (Mistral, locales)        | Ausente: ninguno de esos proveedores tiene un parámetro de razonamiento adaptativo equivalente. Por eso la ruta de AI SDK (`adaptadores/ai-sdk.ts`) es para pasos baratos o deterministas, nunca para razonamiento financiero, conciliación o decisiones de escritura, que van siempre por Anthropic.                                                                                                         |
| Opus 5 y Sonnet 5 en Bedrock UE (sin cuota concedida)             | Ausente por cuota, no por la plataforma (decisión de Jesús, 2026-09-25): mientras Bedrock en Frankfurt no conceda la cuota, esos dos papeles se sirven con Opus 4.6 y Sonnet 4.6 (`IDENTIFICADOR_DESNUDO_PROVISIONAL_BEDROCK` en `identificadores.ts`). El esfuerzo `xhigh` tampoco lo admiten esos dos sustitutos (llegó con Opus 4.7): `anthropic.ts` lo baja a `high` solo cuando el papel es provisional. |

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

Estado a 2026-09-25 (revisado el mismo día): Jesús tiene ya cuenta de AWS. AWS
denegó la cuota de Sonnet 5 y la de Opus 4.6 (pedida como alternativa); Opus 5.5
está pedida, Opus 5 sigue pendiente. Esto es lo que fija `docs/specs/modelos-v1.md`
mientras se resuelve:

1. Cuenta de AWS con Amazon Bedrock activado en **`eu-central-1`** (Frankfurt),
   región primaria elegida; **`eu-west-1`** (Irlanda) si la cuota no se concede
   en Frankfurt. Mientras tanto, `opus5` y `sonnet5` se sirven los dos con
   Sonnet 4.6 (fila «Opus 5 y Sonnet 5 en Bedrock UE» de la tabla de arriba) —
   eso ya funciona con solo el acceso a Sonnet 4.6, que normalmente no necesita
   cuota aparte. Orden de preferencia para volver a un Opus en cuanto haya
   cuota: Opus 5.5, Opus 5, Opus 4.6.
2. Credenciales: **sin claves guardadas en ningún sitio de CI.** En local, la clave
   de acceso del usuario de IAM `aiw-dev`; en producción, la de `aiw-prod`; en
   GitHub Actions, el rol `aiw-ci-bedrock` asumido por OIDC, con una relación de
   confianza que solo admite ejecuciones sobre `main`
   (`repo:bitclick-solution/AI-Workforce:ref:refs/heads/main`): en un PR, asumir
   el rol falla. Los tres, la política IAM mínima y la relación de confianza
   exactas: `docs/runbooks/bedrock-iam-oidc.md`.
3. Variables: `AIW_BEDROCK_REGION_UE` (variable de repositorio y del `.env`) y,
   en GitHub Actions, `AWS_ROLE_ARN` (variable de repositorio, no un secreto: sin
   la relación de confianza de OIDC no sirve para nada) — las dos ya existen.
   Ya cableadas en el job **Bedrock UE · integración** de
   `.github/workflows/ci.yml`, que corre solo desde `main`, una vez a la semana
   o a mano desde la pestaña Actions —nunca en cada PR, para no pagar modelos en
   cada revisión (decisión de Jesús, 2026-09-25)—.
4. `clienteBedrockDesdeEntorno` (`packages/models/src/adaptadores/clientes.ts`)
   construye el cliente real en cuanto `AIW_BEDROCK_REGION_UE` existe; antes de
   eso, lanza con el nombre exacto de lo que falta.
5. Comprueba con `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` de `aiw-dev` en local
   si, en `eu-central-1`, Sonnet 4.6 se sirve por el identificador bajo demanda
   (`anthropic.claude-sonnet-4-6`, la hipótesis de partida) o solo por un perfil
   de inferencia entre regiones (forma habitual: `eu.anthropic.claude-sonnet-4-6`).
   Si hace falta el perfil, fíjalo en la variable
   `AIW_BEDROCK_IDENTIFICADOR_MODELO` — nombre neutro a propósito, sin la
   versión del modelo: la matriz provisional puede volver a cambiar.
   `anthropic.bedrock.integracion.test.ts` y cualquier puesto que use
   `crearAdaptadorAnthropic` lo leen con `identificadorModelo` sin tocar
   `identificadores.ts`. Repite la comprobación cada vez que la matriz
   provisional cambie de modelo, y retira la sustitución de
   `IDENTIFICADOR_DESNUDO_PROVISIONAL_BEDROCK` en cuanto Bedrock conceda cuota de
   la familia 5 o de un Opus.
6. Las tarifas reales de Bedrock UE (Opus 5.5, Opus 5, Sonnet 5, Opus 4.6, Sonnet
   4.6, Haiku 4.5, con región, moneda de origen y tipo de cambio) ya están dadas de
   alta en el catálogo de desarrollo
   (`packages/ledger/src/datos/tarifas-ejemplo.json`); Operación las carga en cada
   tenant real con `registrarTarifa`. El tipo de cambio EUR/USD de ese catálogo
   (0,92) es una referencia de desarrollo — sustitúyelo por el tipo de cambio
   versionado real antes de facturar con él.
7. En cuanto la prueba de integración
   (`packages/models/src/adaptadores/anthropic.bedrock.integracion.test.ts`) pase
   en la CI, repite los casos dorados de Cobros y de Conciliación
   (`packages/evals/smoke/cobros.eval.ts`, `conciliacion.eval.ts`) apuntando al
   cliente real en vez del simulado, para cerrar el criterio de hecho pendiente de
   esta rebanada.

## Activar el proveedor real de Vertex UE

1. Proyecto de Google Cloud con Vertex AI activado y acceso concedido a Opus 5,
   Sonnet 5 y Haiku 4.5 en una región de la UE (`europe-west1`, `europe-west4`, o
   `eu` como multi-región) del Model Garden de Anthropic en Vertex.
2. Credenciales de aplicación por defecto de Google (`gcloud auth application-default login`
   en desarrollo, o una cuenta de servicio con el rol de invocador de Vertex AI en
   producción).
3. Variables de entorno del worker: `AIW_VERTEX_REGION_UE` con la región elegida y
   `AIW_VERTEX_PROJECT_ID` con el proyecto de GCP.
4. `clienteVertexDesdeEntorno` construye el cliente real en cuanto las dos
   variables existen; antes de eso, lanza con el nombre exacto de lo que falta.
5. Mismos pasos 5 y 6 que en Bedrock, con la plataforma `vertex-eu`.

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
