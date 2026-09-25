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

| Función ausente                                                   | Sustituto en esta plataforma                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conector MCP nativo (`mcp_servers` + `mcp_toolset`)               | El gateway MCP propio (`packages/mcp-gateway`), con lista blanca por puesto y nivel.                                                                                                                                                                                                                  |
| Batches API                                                       | Ninguno todavía: las tareas de esta plataforma son interactivas o programadas por Temporal, no por lotes.                                                                                                                                                                                             |
| Files API                                                         | El índice de conocimiento propio (ADR-009): el conocimiento entra por ahí, no por un fichero subido a Anthropic.                                                                                                                                                                                      |
| Fallbacks de servidor (`fallbacks`, `server-side-fallback-*`)     | Se implementan en cliente: `packages/models/src/respaldo.ts` (`completarConRespaldo`), que decide el papel de respaldo con la política del puesto y repite la petición con otro adaptador.                                                                                                            |
| Presupuestos de tarea (`task_budget`)                             | Los aplica el bucle del agente con el presupuesto de la política del puesto (fuera de esta rebanada: es el bucle quien los hace cumplir, no el puerto de modelo).                                                                                                                                     |
| Herramientas de servidor de búsqueda, fetch y ejecución de código | El conocimiento entra por el índice propio (ADR-009); no se declaran estas herramientas en las peticiones de `anthropic.ts`.                                                                                                                                                                          |
| Agent Skills por API (`container.skills`)                         | Las habilidades de un puesto se inyectan en el prompt de su versión (`version_puesto.prompt`, `habilidad_version_puesto`), no se cargan por API.                                                                                                                                                      |
| Managed Agents                                                    | No se usa: el bucle del agente es código propio sobre este puerto (CLAUDE.md, «fronteras de arquitectura»).                                                                                                                                                                                           |
| Pensamiento adaptativo y `output_config.effort` en Haiku 4.5      | Ausente en el modelo, no en la plataforma: la API de primera parte tampoco lo admite en Haiku 4.5. El adaptador omite `thinking` y `effort` para el papel `haiku45` (`SIN_PENSAMIENTO_ADAPTATIVO` en `anthropic.ts`) y solo aplica `output_config.format` cuando hace falta salida estructurada.      |
| Esfuerzo por clase de paso en el AI SDK (Mistral, locales)        | Ausente: ninguno de esos proveedores tiene un parámetro de razonamiento adaptativo equivalente. Por eso la ruta de AI SDK (`adaptadores/ai-sdk.ts`) es para pasos baratos o deterministas, nunca para razonamiento financiero, conciliación o decisiones de escritura, que van siempre por Anthropic. |

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

Nada de esto existe todavía en este repositorio: son los pasos para cuando haya
cuenta y credenciales.

1. Cuenta de AWS con Amazon Bedrock activado en una región de la UE (por ejemplo
   `eu-central-1` o `eu-west-1`) y acceso concedido a los modelos Opus 5, Sonnet 5
   y Haiku 4.5 en el catálogo de modelos de Bedrock de esa región.
2. Credenciales de AWS con permiso para invocar Bedrock: o bien un rol/usuario IAM
   con las claves de acceso, o bien un perfil con el proveedor de credenciales por
   defecto de AWS (variables de entorno, IAM Role, SSO).
3. Variables de entorno del worker: `AIW_BEDROCK_REGION_UE` con la región elegida.
   Las credenciales de AWS en sí (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
   `AWS_SESSION_TOKEN` o el perfil por defecto) las resuelve el SDK oficial de
   Anthropic, no este paquete: `AnthropicBedrockMantle` de `@anthropic-ai/bedrock-sdk`
   sigue la cadena de credenciales estándar de AWS.
4. `clienteBedrockDesdeEntorno` (`packages/models/src/adaptadores/clientes.ts`)
   construye el cliente real en cuanto `AIW_BEDROCK_REGION_UE` existe; antes de
   eso, lanza con el nombre exacto de lo que falta.
5. Da de alta las tarifas reales de Bedrock UE con `registrarTarifa` en la
   plataforma `bedrock-eu` (ver `packages/ledger/src/datos/tarifas-ejemplo.json`
   para el formato): el multiplicador frente a la lista oficial de Anthropic que
   trae ese fichero es una hipótesis de partida (1, la misma cifra que la lista) y
   hay que sustituirlo por el precio real de Bedrock en cuanto se conozca.
6. Repite los casos dorados de Cobros y de Conciliación
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
