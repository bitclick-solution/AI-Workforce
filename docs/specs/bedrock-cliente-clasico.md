VIGENTE

# Especificación · Bedrock UE: cliente clásico con perfiles UE mientras no haya acceso al endpoint de Mensajes

- Rebanada: [Notion](https://app.notion.com/p/3e953066189881d1aab1e43fcf0f44da) · Ciclo actual · Tipo Plataforma · Paquetes `models`, `docs` · P1
- Rama: `rebanada/bedrock-cliente-clasico`
- Plan de referencia: [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn); ADR-017 (residencia UE y SDK de Anthropic) y ADR-018 (esfuerzo y elección de modelo por puesto). Enmienda propuesta al ADR-017 en la descripción del PR; no se toca `docs/adr/` en esta rebanada.
- Zona crítica: no. No se toca `.github/`: el job **Bedrock UE · integración** de `ci.yml` ya lee `AIW_BEDROCK_REGION_UE` y `AWS_ROLE_ARN` sin cambios de código.

## Objetivo

Hoy el adaptador de Bedrock UE (`packages/models`) usa el cliente Mantle del SDK de Anthropic (endpoint de Mensajes), y ese endpoint no sirve ningún modelo de Anthropic en `eu-central-1` y da 403 «not available for this account» en `eu-north-1`/`eu-west-1` para Sonnet 5 y Opus 4.8. La integración clásica de Bedrock (`bedrock-runtime`, cliente `AnthropicBedrock`) sí funciona con la cuenta, con perfiles de inferencia UE. Esta rebanada cambia el adaptador de Bedrock al cliente clásico como vía provisional, deja el cliente Mantle listo para retomarlo sin promoción de versión de puesto, y documenta ambos caminos para que Jesús pueda volver al endpoint de Mensajes en cuanto AWS conceda acceso.

## Paquetes tocados

- `packages/models`: cliente clásico de Bedrock, tabla de identificadores, prueba de integración ampliada.
- `docs/runbooks`: dos runbooks actualizados (funciones ausentes, IAM/OIDC).

## Endpoints, flujos y datos

No aplica: sin rutas de API, flujos de Temporal ni migraciones.

## Criterios de hecho

1. En Bedrock, el adaptador usa `AnthropicBedrock` (cliente clásico de `@anthropic-ai/bedrock-sdk`, `InvokeModel` en `bedrock-runtime`) con `awsRegion = AIW_BEDROCK_REGION_UE`. `AnthropicBedrockMantle` se queda en `clientes.ts` bajo su propia función, lista para cuando AWS conceda acceso al endpoint de Mensajes; volver es cambiar de cliente y de tabla, sin promoción de versión de puesto.
2. `identificadores.ts` resuelve, en `bedrock-eu`: `sonnet5` y `opus5` → `eu.anthropic.claude-sonnet-4-6` (sustituto provisional: `xhigh` baja a `high`, `opus5` con suelo de esfuerzo alto — sin cambios de comportamiento, solo de identificador); `haiku45` → `eu.anthropic.claude-haiku-4-5-20251001-v1:0` (con fecha: única forma que ofrece Bedrock; excepción anotada al «nunca con fecha» del ADR-018). Las pruebas unitarias que esperaban `anthropic.claude-sonnet-4-6` pasan a esperar el identificador con prefijo `eu.`.
3. `anthropic.bedrock.integracion.test.ts` hace una llamada mínima por papel (`haiku45`, `sonnet5`, `opus5`), una con salida estructurada (`output_config.format`) y otra con una herramienta `strict`, contra Bedrock real. Un fallo dice qué papel, qué modelo y qué región. Sin `AIW_BEDROCK_REGION_UE`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` la prueba se sigue saltando, como hoy. El job **Bedrock UE · integración** solo corre en `main` (confianza OIDC): esta rebanada no puede ejecutarlo desde el PR, Jesús lo relanza tras fusionar.
4. Los runbooks (`modelos-funciones-ausentes.md`, `bedrock-iam-oidc.md`) documentan los dos caminos de Bedrock (clásico y endpoint de Mensajes) con sus identificadores, por qué `eu-north-1` y no Fráncfort, cómo listar los modelos de cada camino, que un 403 «not available for this account» es de acceso de cuenta y no de código, la política de IAM del rol `aiw-ci-bedrock` (incluida la extensión a `bedrock:InvokeModel`/`InvokeModelWithResponseStream` sobre los ARN de perfil y de modelo base UE), el `sub` de confianza OIDC con los identificadores inmutables de GitHub, y cómo volver al endpoint de Mensajes cuando AWS conceda Sonnet 5 y Opus 5.

## Casos de prueba y de eval

- Unitario: `identificadores.test.ts` y `anthropic.test.ts` actualizados al identificador `eu.anthropic.claude-sonnet-4-6`; sin caso de error nuevo, la resolución de identificador no tiene camino de fallo (es una tabla estática).
- Eval: no aplica — esta rebanada no añade comportamiento nuevo de agente, solo cambia el cliente y el identificador de una plataforma ya certificada; la certificación existente de los puestos no cambia de modelo real servido (Sonnet 4.6 ya era el sustituto provisional).
- Auditoría y contador: sin cambios — el nombre canónico que registra el contador (`nombreCanonico`) sigue siendo el objetivo del ADR-018 (`claude-sonnet-5`, etc.), no el identificador real de Bedrock; esta rebanada no toca `packages/ledger`.
- Secretos: sin credenciales nuevas. `docs/runbooks/bedrock-iam-oidc.md` usa `<AWS_ACCOUNT_ID>` en cualquier ARN; los identificadores numéricos de GitHub del `sub` de OIDC no son secretos (son inmutables y públicos en la URL del repositorio).

## Fuera de alcance

- Repetir los casos dorados de Cobros y Conciliación contra el proveedor real (pertenece a la rebanada «Modelos v1», que ya lo señala como pendiente en el runbook): esta rebanada solo deja la prueba de integración lista para que ese job, al pasar en `main`, confirme que el camino clásico sirve lo que usan esos casos.
- Volver al endpoint de Mensajes cuando AWS conceda acceso a Sonnet 5/Opus 5: es la propia reversión que documenta el runbook, y es una rebanada futura, no esta.
- Registrar el ADR-017 modificado en `docs/adr/`: lo hace el Cronista el miércoles a partir de la enmienda propuesta en el PR.

## Presupuesto de tokens

Presupuesto: 20 €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

Ninguna.
