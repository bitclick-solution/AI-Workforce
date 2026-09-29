VIGENTE

# Especificación · Vertex AI UE como proveedor principal: Opus 5.5, Sonnet 5 y Haiku 4.5, cambio de proveedor en una línea y runbook

- Rebanada: [Notion](https://app.notion.com/p/3ea53066189881e38f70fa3edd87e4c4) · Ciclo actual · Tipo Plataforma · Paquetes `models`, `docs`, `deploy` · P0
- Rama: `rebanada/vertex-ue-proveedor-principal`
- Plan de referencia: [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn); ADR-017 (residencia UE y SDK de Anthropic), ADR-018 (esfuerzo y elección de modelo por puesto), ADR-023 (Vertex AI UE como proveedor principal, enmienda del ADR-017 — `docs/adr/ADR-023.md`, sincronizado en esta rebanada con la redacción aprobada en Notion el 29-9-2026).
- Zona crítica: sí. Esta rebanada añade el job **Vertex UE · integración** a `.github/workflows/ci.yml`, zona crítica por `CLAUDE.md`. Revisión humana obligatoria de Jesús.

## Objetivo

Jesús ha habilitado Vertex AI en el proyecto de Google Cloud de Bitclick, con Opus 5.5, Sonnet 5 y Haiku 4.5 activos en la multirregión europea, y ha decidido que Vertex UE pase a ser el proveedor principal de Anthropic (ADR-023): Bedrock no concede cuota de Opus 5.5 ni de Sonnet 5. Cuando esta rebanada esté hecha, cambiar de proveedor principal —o de respaldo— es cambiar el valor de una variable de entorno (`AIW_PROVEEDOR_MODELOS`), nunca código, y cambiar un modelo cuando salga uno nuevo en la UE (como Sonnet 5.5) es cambiar una fila de `packages/models/src/identificadores.ts`.

## Paquetes tocados

- `packages/models`: tabla de identificadores de Vertex UE, comprobación de residencia UE al arrancar, selector de proveedor principal/respaldo en una línea, prueba de integración real de Vertex.
- `docs`: runbook nuevo de Vertex + WIF, runbook de funciones ausentes actualizado, ADR-023 sincronizado.
- `deploy`/`.github`: job **Vertex UE · integración** en `ci.yml`, variables de repositorio documentadas.

## Endpoints, flujos y datos

No aplica: sin rutas de API, flujos de Temporal ni migraciones.

## Criterios de hecho

1. `AIW_PROVEEDOR_MODELOS` (por defecto `vertex-ue`) elige el proveedor principal y `AIW_PROVEEDOR_MODELOS_RESPALDO` (por defecto `bedrock-ue`) el de respaldo, sin tocar código (`packages/models/src/proveedor.ts`).
2. En la multirregión europea de Vertex (`AIW_VERTEX_REGION_UE=eu`), el adaptador de Anthropic sirve `opus5` con Opus 5.5, `sonnet5` con Sonnet 5 y `haiku45` con Haiku 4.5 (`identificadores.ts`, tabla `IDENTIFICADOR_VERTEX_UE`).
3. Los identificadores y la ubicación se citan de la documentación oficial de Anthropic y de Google Cloud (Claude en Vertex AI), no de memoria, y quedan marcados como pendientes de verificar con una llamada real hasta que Jesús pegue la salida de los comandos de Cloud Shell del cierre de esta rebanada.
4. El arranque rechaza cualquier `AIW_VERTEX_REGION_UE` que no sea la multirregión `eu` o una región concreta `europe-*`.
5. Job **Vertex UE · integración** en `ci.yml`, semanal y manual, solo en `main`, autenticado por federación de identidades de GitHub hacia Google Cloud (sin claves JSON guardadas), con la condición de confianza sobre `repository_id` (1377453835) y `repository_owner_id` (301227888) y la rama `main`.
6. Casos dorados de Cobros y Conciliación con el proveedor real de Vertex UE, y salida estructurada y herramienta estricta probadas en los tres papeles.
7. Runbook `docs/runbooks/vertex-wif.md` con los pasos de Jesús en Google Cloud, cómo cambiar de proveedor en una línea y cómo cambiar un modelo. `modelos-funciones-ausentes.md` actualizado.
8. Sin secretos en el repositorio, en prompts ni en registros; proyecto y ubicación en variables del repositorio.

## Casos de prueba y de eval

- Unitario: `identificadores.test.ts` (tabla Vertex UE, comprobación de residencia), `clientes.test.ts` (rechazo de región fuera de la UE), `proveedor.test.ts` (proveedor por defecto, anulación válida, valor inválido lanza con el nombre exacto de la variable).
- Integración (gateada, sin credenciales en local): `anthropic.vertex.integracion.test.ts`, mínima por papel + salida estructurada + herramienta estricta en los tres papeles, igual que el de Bedrock.
- Eval: casos dorados de Cobros y Conciliación repetidos contra el cliente real de Vertex UE (gateados igual, se saltan sin `AIW_VERTEX_REGION_UE`/`AIW_VERTEX_PROJECT_ID`), cierran el criterio pendiente de la rebanada «Modelos v1».
- Auditoría y contador: sin cambios — `nombreCanonico` sigue siendo el objetivo del ADR-018, no el identificador real de la plataforma; esta rebanada no toca `packages/ledger`.
- Secretos: `docs/runbooks/vertex-wif.md` usa `<GCP_PROJECT_ID>`/`<GCP_PROJECT_NUMBER>` como marcador; la clave de API que generó Jesús no se usa en esta rebanada (Vertex no la admite, ver el runbook) y no aparece en ningún archivo.

## Fuera de alcance

- Volver a Bedrock como principal si Bedrock concede cuota de Opus 5.5/Sonnet 5: es cambiar la misma línea, documentado en el runbook, no ejecutado aquí.
- Cablear el respaldo automático proveedor-a-proveedor dentro del bucle del agente (`apps/worker`): esta rebanada deja listo `puertoAnthropicRespaldoDesdeEntorno` como bloque de construcción; la conmutación automática en tiempo de ejecución es una rebanada futura si Jesús la pide.
- Retirar la tabla `IDENTIFICADOR_BEDROCK_EU` o los runbooks de Bedrock: Bedrock sigue siendo el respaldo, no se retira nada de la rebanada «Bedrock cliente clásico».

## Presupuesto de tokens

Presupuesto: 25 €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

Ninguna.
