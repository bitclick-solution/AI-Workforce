VIGENTE

# Especificación · Proveedor de modelos en una línea: Bedrock clásico por defecto y Vertex AI UE preparado para cuando haya cuota

- Rebanada: [Notion](https://app.notion.com/p/3ea53066189881e38f70fa3edd87e4c4) · Ciclo actual · Tipo Plataforma · Paquetes `models`, `docs`, `deploy` · P0
- Rama: `rebanada/vertex-ue-proveedor-principal`
- Plan de referencia: [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn); ADR-017 (residencia UE y SDK de Anthropic), ADR-018 (esfuerzo y elección de modelo por puesto), ADR-023 (cliente clásico de Bedrock como vía provisional, enmienda del ADR-017 — `docs/adr/ADR-023.md`, sincronizado en esta rebanada con la redacción aprobada en Notion el 29-9-2026, revisada tras comprobar que Vertex tampoco concede cuota).
- Zona crítica: sí. Esta rebanada añade el job **Vertex UE · integración (manual, sin cuota)** a `.github/workflows/ci.yml`, zona crítica por `CLAUDE.md`. Revisión humana obligatoria de Jesús.

## Objetivo

Jesús habilitó Vertex AI en el proyecto de Google Cloud de Bitclick con Opus 5.5, Sonnet 5 y Haiku 4.5 visibles en el Model Garden de la multirregión europea, pero, igual que Bedrock, Google tampoco concede cuota de esos modelos a la cuenta (comprobado el 29-9-2026). El ADR-023 vuelve al cliente clásico de Bedrock UE como vía provisional: `bedrock-ue` es el proveedor por defecto. Vertex UE queda implementado y documentado detrás del mismo puerto, listo para activarlo en cuanto llegue la cuota — «esto debería ser solo cambiar una línea», la misma exigencia de Jesús del 29-9-2026. Cuando esta rebanada esté hecha, cambiar de proveedor —hoy, para probar Vertex a mano, o el día que cualquiera de los dos conceda cuota de verdad— es cambiar el valor de una variable de entorno (`AIW_PROVEEDOR_MODELOS`), nunca código, y cambiar un modelo cuando salga uno nuevo en la UE (como Sonnet 5.5) es cambiar una fila de `packages/models/src/identificadores.ts`.

## Paquetes tocados

- `packages/models`: tabla de identificadores de Vertex UE, comprobación de residencia UE al arrancar, selector de proveedor principal/respaldo en una línea (por defecto `bedrock-ue`/`vertex-ue`), prueba de integración real de Vertex. La tabla de Bedrock y los ajustes provisionales de esfuerzo de `anthropic.ts` no se tocan.
- `packages/evals`: casos dorados reales de Cobros y Conciliación contra Vertex UE (`smoke/cobros-modelos-v1.vertex.integracion.test.ts`, `conciliacion-modelos-v1.vertex.integracion.test.ts`), gateados igual que la prueba de integración de `@aiw/models`.
- `docs`: runbook nuevo de Vertex + WIF (con los comandos de Cloud Shell para cuando haya cuota, no para ejecutar ahora), runbook de funciones ausentes actualizado, ADR-023 sincronizado.
- `deploy`/`.github`: job **Vertex UE · integración (manual, sin cuota)** en `ci.yml` — solo `workflow_dispatch`, sin el cron semanal que sí lleva el de Bedrock —, variables de repositorio documentadas.

## Endpoints, flujos y datos

No aplica: sin rutas de API, flujos de Temporal ni migraciones.

## Criterios de hecho

1. Cambiar de proveedor (Bedrock UE clásico o Vertex UE) es cambiar una sola línea de configuración, sin tocar código. Por defecto, `bedrock-ue` (ADR-023).
2. Vertex UE está implementado detrás del puerto de `packages/models`, con Opus 5.5 para `opus5`, Sonnet 5 para `sonnet5` y Haiku 4.5 para `haiku45` en la multirregión europea (`AIW_VERTEX_REGION_UE=eu`). Queda inactivo hasta que Google conceda la cuota.
3. Una sola tabla de identificadores por papel y plataforma (`identificadores.ts`, `IDENTIFICADOR_VERTEX_UE`), citada de la documentación oficial de Anthropic sobre Vertex AI, no de memoria, y marcada como pendiente de verificar con una llamada real (bloque de Cloud Shell en el runbook, para cuando haya cuota). Cambiar un modelo es cambiar una fila.
4. El arranque rechaza cualquier `AIW_VERTEX_REGION_UE` que no sea la multirregión `eu` o una región concreta `europe-*`.
5. El job **Bedrock UE · integración** sigue siendo la integración real semanal y manual. El de Vertex (**Vertex UE · integración**) queda solo manual hasta que haya cuota, autenticado por federación de identidades de GitHub hacia Google Cloud (sin claves JSON guardadas), con la condición de confianza sobre `repository_id` (1377453835) y `repository_owner_id` (301227888) y la rama `main`.
6. Runbook `docs/runbooks/vertex-wif.md`: cómo cambiar de proveedor o de modelo en una línea, y los pasos de Jesús en Google Cloud (con los comandos de Cloud Shell) para cuando llegue la cuota. `modelos-funciones-ausentes.md` actualizado.
7. Sin secretos en el repositorio, en prompts ni en registros; proyecto y ubicación en variables del repositorio.

## Casos de prueba y de eval

- Unitario: `identificadores.test.ts` (tabla Vertex UE, comprobación de residencia), `clientes.test.ts` (rechazo de región fuera de la UE), `proveedor.test.ts` (proveedor por defecto `bedrock-ue`/`vertex-ue`, anulación válida, valor inválido lanza con el nombre exacto de la variable).
- Integración (gateada, sin credenciales en local; no se ejecuta hasta que haya cuota): `anthropic.vertex.integracion.test.ts`, mínima por papel + salida estructurada + herramienta estricta en los tres papeles, igual que el de Bedrock.
- Eval: casos dorados de Cobros y Conciliación contra el cliente real de Vertex UE (gateados igual, se saltan sin `AIW_VERTEX_REGION_UE`/`AIW_VERTEX_PROJECT_ID`), listos para cuando haya cuota que verificar.
- Auditoría y contador: sin cambios — `nombreCanonico` sigue siendo el objetivo del ADR-018, no el identificador real de la plataforma; esta rebanada no toca `packages/ledger`.
- Secretos: `docs/runbooks/vertex-wif.md` usa `<GCP_PROJECT_ID>`/`<GCP_PROJECT_NUMBER>` como marcador; la clave de API que generó Jesús no se usa en esta rebanada (Vertex no la admite, ver el runbook) y no aparece en ningún archivo.

## Fuera de alcance

- Pedir a Jesús que ejecute el bloque de comandos de Cloud Shell: se queda documentado en el runbook para cuando Google conceda la cuota, no se ejecuta en esta rebanada.
- Cablear el respaldo automático proveedor-a-proveedor dentro del bucle del agente (`apps/worker`): esta rebanada deja listo `puertoAnthropicRespaldoDesdeEntorno` como bloque de construcción; la conmutación automática en tiempo de ejecución es una rebanada futura si Jesús la pide.
- Retirar la tabla `IDENTIFICADOR_BEDROCK_EU`, los ajustes provisionales de esfuerzo o los runbooks de Bedrock: no se tocan en esta rebanada.

## Presupuesto de tokens

Presupuesto: 25 €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

Ninguna.
