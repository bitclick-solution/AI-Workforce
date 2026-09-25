VIGENTE

# Especificación · Modelos v1

- Rebanada: [Notion](https://app.notion.com/p/3e55306618988139a316d4a55aad983c) · Ciclo 1 · Tipo Plataforma · Paquetes `@aiw/models`, `@aiw/domain`, `@aiw/db`, `@aiw/ledger`, `@aiw/evals` · P0
- Rama: `rebanada/modelos-v1`
- Plan de referencia: [Plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn); ADR-002, ADR-007, ADR-017, ADR-018.
- Zona crítica: sí — `packages/models`, la versión de puesto (migración `0002_modelos_v1.sql`) y el contador (`tarifa_modelo`, `uso_modelo`).

## Objetivo

La ruta de Anthropic deja de ser hipotética: el SDK oficial habla con Bedrock UE o
Vertex UE detrás de un puerto único, la versión de puesto guarda qué modelo y qué
esfuerzo usa cada clase de paso, y el contador sabe tarifar por plataforma con el
desglose de caché. Cuando esta rebanada esté fusionada, el ciclo 1 puede poner
Cobros en producción interna con un proveedor real en la UE en cuanto existan
credenciales.

## Paquetes tocados

- `@aiw/models`: puerto de modelo, adaptador de Anthropic (Bedrock/Vertex/primera
  parte), adaptador de AI SDK (Mistral/local/CI determinista), respaldo,
  observabilidad de coste a Langfuse, servidor simulado de pruebas.
- `@aiw/domain`: papeles de modelo, clases de paso, niveles de esfuerzo,
  plataformas y el esquema `configuracionModeloPuesto`.
- `@aiw/db`: columna `configuracion_modelo` en `version_puesto`; columnas
  `plataforma` y `multiplicador_lista_oficial` en `tarifa_modelo`; columna
  `plataforma` en `uso_modelo` (migración `0002_modelos_v1.sql`).
- `@aiw/ledger`: `Tarifa`/`TarifaNueva`/`UsoDeModeloNuevo` con plataforma opcional;
  catálogo de tarifas con la plataforma y el multiplicador documental.
- `@aiw/evals`: evaluador de casos dorados de salida estructurada; casos dorados de
  Cobros y de Conciliación.

## Endpoints, flujos y datos

Sin endpoints nuevos. Migración `packages/db/drizzle/0002_modelos_v1.sql` (y su
reverso): añade columnas con `default`, así que ninguna fila existente cambia de
significado. Zona crítica por tocar la versión de puesto y el contador.

## Criterios de hecho

1. `@aiw/models` implementa el puerto `PuertoDeModelo`; el adaptador de Anthropic
   usa `@anthropic-ai/sdk` sobre `@anthropic-ai/bedrock-sdk` y `@anthropic-ai/vertex-sdk`
   (nunca el AI SDK) y el adaptador de AI SDK sirve Mistral, modelos locales y el
   proveedor determinista de CI (`MockLanguageModelV4` de `ai/test`) — cumplido.
2. `configuracionModeloPuesto` (`@aiw/domain`) guarda modelo, esfuerzo por clase de
   paso y modelo de respaldo; `version_puesto.configuracion_modelo` es la columna
   inmutable que la versiona (ADR-007, ADR-018) — cumplido.
3. Las salidas estructuradas usan `output_config.format` con el JSON Schema de Zod
   y las herramientas van con `strict: true`; el rechazo del clasificador
   (`stop_reason: "refusal"`) se trata como paso fallido no reintentable, con el
   respaldo decidido por `configuracion.modeloRespaldo` y ejecutado por el cliente
   (`completarConRespaldo`), nunca reintentado con el mismo modelo — cumplido.
4. `tarifa_modelo` guarda `plataforma` (Bedrock UE, Vertex UE, primera parte o
   AI SDK) y `multiplicadorListaOficial` documental; el desglose de caché ya
   existía (`eurosPorMillonEntradaCache`) y sigue siendo la fuente del cálculo, no
   el multiplicador — cumplido.
5. El coste por tarea completada llega a Langfuse por `observadorDesdeEntorno`
   cuando hay credenciales, y no rompe la tarea cuando no las hay (observador nulo)
   — cumplido; activarlo con credenciales reales queda en el runbook.
6. Los casos dorados de Cobros y de Conciliación pasan de punta a punta —adaptador,
   esquema estricto, evaluador— contra el servidor simulado en
   `pnpm --filter @aiw/evals evals:smoke` — cumplido con el proveedor simulado;
   **pendiente con el proveedor real** (sin credenciales de Bedrock ni de Vertex UE
   todavía), con los pasos exactos en el runbook.
7. Runbook de funciones ausentes en Bedrock o en Vertex, con su sustituto y los
   pasos de activación — cumplido (`docs/runbooks/modelos-funciones-ausentes.md`).

## Casos de prueba y de eval

- Unitario: identificador de modelo por papel y plataforma (con y sin prefijo
  `anthropic.`, rechazo de `ai-sdk`); esfuerzo por clase de paso con y sin fijar en
  el puesto; decisión y ejecución del respaldo tras un rechazo, incluida la lectura
  y las bifurcaciones del adaptador de Anthropic (pensamiento adaptativo, la
  excepción de Haiku 4.5, salida estructurada válida e inválida, herramientas
  estrictas) contra el servidor simulado y contra los clientes reales de Bedrock
  con `skipAuth`; el adaptador de AI SDK con `MockLanguageModelV4` (texto, salida
  estructurada, filtro de contenido como rechazo); el observador de Langfuse
  (autenticación básica, desglose de tokens, fallo del envío) y el observador nulo.
- Eval: `cobros-001`/`cobros-002` (proponer o no una nota de seguimiento según si
  la factura está vencida) y `conciliacion-001`/`conciliacion-002` (conciliar o no
  un movimiento bancario contra las facturas candidatas), los cuatro en
  `packages/evals/smoke/`, deterministas y sin llamar a ningún modelo real
  (`vitest.evals.config.ts`).
- Auditoría y contador: sin cambios de comportamiento en `registrarUsoDeModelo` ni
  en `registrarTarifa` más allá de aceptar `plataforma` y `multiplicadorListaOficial`
  opcionales con default; las pruebas existentes de `@aiw/ledger` (contra
  PostgreSQL, se saltan sin `DATABASE_URL`) siguen pasando sin tocarlas.
- Secretos: ninguna prueba usa una credencial real; `clienteBedrockDesdeEntorno`,
  `clienteVertexDesdeEntorno`, `clientePrimeraParteDesdeEntorno` y
  `observadorDesdeEntorno` fallan con el nombre exacto de la variable que falta en
  vez de construir un cliente con un valor inventado (prueba en
  `adaptadores/clientes.test.ts`).

## Fuera de alcance

- El bucle del agente que llama a `packages/models` desde `apps/worker` (rebanada
  futura: el flujo `tareaAgente` de la prueba técnica del stack).
- Presupuesto de tarea (`task_budget`) y edición/compactación de contexto: los
  aplica el bucle del agente, no el puerto de modelo.
- Activar credenciales reales de Bedrock UE, de Vertex UE o de Langfuse: pasos en
  el runbook, pendientes de que Operación las dé de alta.
- Departamentos y puestos reales «Cobros» y «Conciliación» como filas de
  `departamento`/`puesto`: los casos dorados de esta rebanada prueban el puerto de
  modelo con su forma de decisión, no siembran el departamento de Finanzas.

## Presupuesto de tokens

Presupuesto: 50 €. Consumo real: registrado en la rebanada de Notion al abrir el PR.
Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

Ninguna: el ADR-017 y el ADR-018 ya estaban aprobados antes de empezar esta
rebanada, tal como pedía el encargo.
