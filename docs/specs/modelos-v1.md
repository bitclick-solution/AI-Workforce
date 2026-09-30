VIGENTE

# Especificación · Modelos v1

- Rebanada: [Notion](https://app.notion.com/p/3e55306618988139a316d4a55aad983c) · Ciclo 1 · Tipo Plataforma · Paquetes `@aiw/models`, `@aiw/domain`, `@aiw/db`, `@aiw/ledger`, `@aiw/evals` · P0
- Rama: `rebanada/modelos-v1`
- Plan de referencia: [Plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn); ADR-002, ADR-007, ADR-017, ADR-018.
- Zona crítica: sí — `packages/models`, la versión de puesto y el contador (`tarifa_modelo`, `uso_modelo`); migraciones `0003_modelos_v1.sql` y `0004_tarifas_region_moneda.sql`. También `.github/workflows/ci.yml` (nuevo job, cron).

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
  `plataforma` en `uso_modelo` (migración `0003_modelos_v1.sql`); columnas
  `region`, `moneda_origen`, `tipo_cambio_a_euros`, `precio_origen_por_millon_*` y
  la escritura de caché a 5 minutos/1 hora en `tarifa_modelo`
  (`0004_tarifas_region_moneda.sql`).
- `@aiw/ledger`: `Tarifa`/`TarifaNueva`/`UsoDeModeloNuevo` con plataforma, región,
  moneda de origen y tipo de cambio opcionales; catálogo de tarifas con las
  tarifas reales de Bedrock UE del 2026-09-25.
- `@aiw/evals`: evaluador de casos dorados de salida estructurada; casos dorados de
  Cobros y de Conciliación.

## Endpoints, flujos y datos

Sin endpoints nuevos. Migraciones `packages/db/drizzle/0003_modelos_v1.sql` y
`0004_tarifas_region_moneda.sql` (y sus reversos): añaden columnas con `default`
o nulas, así que ninguna fila existente cambia de significado. Zona crítica por
tocar la versión de puesto y el contador.

## Región, perfil de inferencia y secretos de Bedrock UE (fijado 2026-09-25, revisado 2026-09-25)

Jesús tiene ya cuenta de AWS. Pidió cuota de Sonnet 5 y de Opus 5 en Bedrock,
Frankfurt; AWS denegó la de Sonnet 5, y también la de Opus 4.6 (pedida como
alternativa). Opus 5.5 está pedida; Opus 5 sigue pendiente. Esto es lo que fija
esta rebanada mientras se resuelve:

- **Región primaria**: `eu-central-1` (Frankfurt). **Alternativa**: `eu-west-1`
  (Irlanda), si la cuota no se concede en Frankfurt. Va en la variable
  `AIW_BEDROCK_REGION_UE`, nunca hardcodeada en el código.
- **Modelos provisionales** (decisión de Jesús, 2026-09-25, revisada el mismo
  día tras la denegación): sin cuota de ningún Opus en Bedrock, la matriz del
  ADR-018 usa estos equivalentes — `identificadores.ts`, tabla
  `IDENTIFICADOR_DESNUDO_PROVISIONAL_BEDROCK`:
  - Razonamiento y pasos que deciden escrituras (papel `opus5`): **Sonnet 4.6**
    (`claude-sonnet-4-6`) con esfuerzo alto como suelo — hace ese trabajo con un
    modelo que no es un Opus, así que no baja de `high` aunque la clase de paso
    pida menos.
  - Modelo por defecto de puesto (papel `sonnet5`): **Sonnet 4.6**, sin suelo de
    esfuerzo (el esfuerzo por clase de paso de siempre).
  - Moderador, clasificación, extracción y rutinas (papel `haiku45`): **Haiku
    4.5**, sin cambios — ya está disponible.

  `opus5` y `sonnet5` resuelven hoy al mismo modelo real en Bedrock — es la
  situación de partida, no un error: la diferencia entre los dos papeles queda
  en el esfuerzo, no en el modelo, mientras dure la sustitución. Orden de
  preferencia para volver a un Opus en cuanto haya cuota: **Opus 5.5, Opus 5,
  Opus 4.6** (aunque esta última esté denegada hoy, se reintenta si cambia).

  El modelo sigue siendo dato de la versión de puesto (`configuracionModeloPuesto.modelo`
  guarda `opus5`/`sonnet5`/`haiku45`, nunca `sonnet46`): el cambio a la familia 5
  o a un Opus, cuando Bedrock conceda la cuota, es retirar esa tabla de
  `identificadores.ts`, no una promoción de ninguna versión de puesto — ninguna
  versión de puesto llegó a saber que estaba en modo provisional. Solo Bedrock:
  Vertex y la primera parte siguen resolviendo a la familia 5 objetivo, sin
  indicio de que tengan la misma limitación de cuota.

  Comprobado con la skill `claude-api` (tabla de esfuerzo y pensamiento): Sonnet
  4.6 admite pensamiento adaptativo igual que la familia 5, pero **no admite el
  esfuerzo `xhigh`** (llegó con Opus 4.7). `anthropic.ts` (`esfuerzoSoportado`)
  baja `xhigh` a `high` para los dos papeles provisionales, y además no deja
  bajar de `high` en `opus5`; `sonnet5` provisional no lleva ese segundo suelo.

- **Identificador de modelo**: hipótesis de partida para el identificador bajo
  demanda del modelo provisional (`anthropic.claude-sonnet-4-6`). Si el catálogo
  de modelos de Bedrock en la región contratada solo lo sirve por un **perfil de
  inferencia entre regiones** (forma habitual en Bedrock:
  `eu.anthropic.claude-sonnet-4-6`), se fija en la variable opcional
  `AIW_BEDROCK_IDENTIFICADOR_MODELO` — nombre neutro, sin la versión del modelo,
  porque lo que anula cambia con la matriz provisional — sin tocar
  `identificadores.ts`: `crearAdaptadorAnthropic` acepta `identificadorModelo`
  para anular el cálculo por papel y plataforma. Cuál de las dos formas hace
  falta se confirma en la consola de Bedrock, no se adivina en esta rebanada.
- **Secretos y variables — revisado: sin claves de AWS guardadas en GitHub
  Actions.** La primera versión de esta sección (misma fecha) proponía
  `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` como secretos de GitHub Actions;
  Jesús la corrigió el mismo día: en CI se asume un rol por OIDC, sin ninguna
  clave guardada. Queda así:
  - **Local** (`.env`, vacío en `.env.example`): `AIW_BEDROCK_REGION_UE`, y
    `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` de la cadena estándar de AWS —
    del usuario de IAM `aiw-dev`.
  - **Producción**: mismas variables, credenciales del usuario de IAM `aiw-prod`.
    Nunca las mismas claves que `aiw-dev`.
  - **GitHub Actions**: variable de repositorio `AIW_BEDROCK_REGION_UE`; variable
    de repositorio `AWS_ROLE_ARN` con el ARN del rol `aiw-ci-bedrock` (no es un
    secreto: sin la relación de confianza de OIDC, el ARN solo no sirve para
    nada); variable opcional `AIW_BEDROCK_IDENTIFICADOR_MODELO`. El job **Bedrock UE ·
    integración** de `ci.yml` asume el rol con
    `aws-actions/configure-aws-credentials` y `permissions: id-token: write`.
  - La política IAM mínima (`bedrock-mantle:CreateInference`, nada más) y la
    relación de confianza de OIDC —limitada a este repositorio— están en
    `docs/runbooks/bedrock-iam-oidc.md`. Jesús crea los dos usuarios y el rol;
    el Constructor no los pide ni los escribe en el repositorio, en el PR ni en
    ningún registro.
  - **Nunca en cada PR, y solo desde `main`**: el job de integración no corre en
    el job `Pruebas` (decisión de Jesús: no pagar modelos en cada revisión) ni
    en ningún PR — la relación de confianza de `aiw-ci-bedrock` solo admite
    `repo:bitclick-solution/AI-Workforce:ref:refs/heads/main`, así que en un PR
    la asunción del rol fallaría aunque el job lo intentase. Corre una vez a la
    semana por `cron` o a mano desde la pestaña Actions
    (`workflow_dispatch`), y solo si `github.ref` es `refs/heads/main`.
    `aws-actions/configure-aws-credentials` exporta las credenciales
    temporales: el job no declara `AWS_ACCESS_KEY_ID` ni `AWS_SECRET_ACCESS_KEY`
    en ningún `env:`. Sin `AWS_ROLE_ARN` todavía, ese job dice «nada que probar»
    y sigue en verde; en cuanto exista, cierra el criterio de hecho 6 sin más
    cambio de código ni de workflow.

## Tarifas reales de Bedrock UE (cargadas 2026-09-25)

Precios reales de Bedrock en Frankfurt que dio Jesús el 2026-09-25 (inferencia
geográfica y entre regiones, en USD por millón de tokens): Opus 5.5, Opus 5,
Sonnet 5, Opus 4.6, Sonnet 4.6 y Haiku 4.5, cada uno con entrada, salida,
escritura de caché a 5 minutos, escritura de caché a 1 hora y lectura de caché.
Ya están en `packages/ledger/src/datos/tarifas-ejemplo.json`, con:

- `region: "eu-central-1"`, `monedaOrigen: "usd"` y `tipoCambioAEuros` (0,92 como
  referencia de desarrollo: Operación lo sustituye por el tipo de cambio
  versionado real antes de facturar con estas filas).
- `precioOrigenPorMillon*`: el precio tal como lo publicó el partner, en USD,
  solo trazabilidad — `calcularCosteEuros` sigue leyendo únicamente
  `eurosPorMillon*`, ya convertidos, igual que antes de esta rebanada.
- `eurosPorMillonEntradaCacheEscritura5m`/`...1h`: los dos precios de escritura
  de caché, nuevos en `tarifa_modelo` (migración `0004_tarifas_region_moneda.sql`).
  **Documentales por ahora**: `uso_modelo` todavía no distingue tokens de
  escritura de caché de los de entrada normal, así que `calcularCosteEuros` no
  los cobra todavía — cargarlos en la tarifa no cambia ninguna factura existente.
  Cobrarlos de verdad es una rebanada futura que amplíe `TokensUsados` y
  `uso_modelo` con los tokens de escritura por TTL.
- La fila de `claude-sonnet-4-6` es la que se aplica hoy de verdad para los dos
  papeles provisionales (`opus5` y `sonnet5`), mientras dura la sustitución de la
  sección anterior. La fila de `claude-opus-4-6` queda cargada igual —su cuota
  está denegada, no retirada de la lista de preferencia— por si se reconsidera.

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
   AI SDK), `region`, `monedaOrigen`/`tipoCambioAEuros`/`precioOrigenPorMillon*`
   y `multiplicadorListaOficial`, todo documental; el desglose de caché de
   lectura ya existía (`eurosPorMillonEntradaCache`) y ahora también el de
   escritura a 5 minutos y a 1 hora (documental: `uso_modelo` no los cuenta
   todavía). `calcularCosteEuros` sigue leyendo solo los `eurosPorMillon*` ya
   convertidos, nunca el multiplicador ni el tipo de cambio en caliente —
   cumplido. Cargadas las tarifas reales de Bedrock UE del 2026-09-25.
5. El coste por tarea completada llega a Langfuse por `observadorDesdeEntorno`
   cuando hay credenciales, y no rompe la tarea cuando no las hay (observador nulo)
   — cumplido; activarlo con credenciales reales queda en el runbook.
6. Los casos dorados de Cobros y de Conciliación pasan de punta a punta —adaptador,
   esquema estricto, evaluador— contra el servidor simulado en
   `pnpm --filter @aiw/evals evals:smoke` — cumplido con el proveedor simulado.
   Hay además una prueba de integración contra el Bedrock real
   (`anthropic.bedrock.integracion.test.ts`) que se salta sola sin credenciales, en
   un job aparte de `ci.yml` que solo corre desde `main`, a la semana o a mano,
   nunca en cada PR ni en ningún PR (la confianza de OIDC de `aiw-ci-bedrock` lo
   impide). El rol y las variables de repositorio ya existen (`AWS_ROLE_ARN`,
   `AIW_BEDROCK_REGION_UE`): la prueba corre sola en el siguiente disparo del job.
   **Cerrado contra el proveedor real** (rebanada «Casos dorados de Cobros y
   Conciliación contra Bedrock UE en el job semanal»): los mismos dos casos
   dorados corren también contra Bedrock UE real por el camino clásico
   (`clienteBedrockDesdeEntorno`), además de contra Vertex UE real
   (`clienteVertexDesdeEntorno`), con un cuerpo común a los dos proveedores
   (`packages/evals/smoke/casos-dorados-proveedor-real.compartido.ts`) para no
   duplicar el caso: la decisión coincide con la esperada y el motivo de Cobros es
   una frase no vacía que cumple el esquema estricto, sin comparar el texto;
   Conciliación, al ser enteramente categórica, sigue comparando por igualdad
   exacta con `evaluarCasoDoradoEstructurado`. Se saltan solos sin
   `AIW_BEDROCK_REGION_UE` y credenciales de AWS (misma condición que
   `anthropic.bedrock.integracion.test.ts`) o sin `AIW_VERTEX_REGION_UE`/
   `AIW_VERTEX_PROJECT_ID`; nunca corren en un PR ni en `pnpm test` ni en
   `pnpm evals:smoke`. El job «Bedrock UE · integración» de `ci.yml` los ejecuta
   (`smoke/cobros-modelos-v1.bedrock.integracion.test.ts`,
   `conciliacion-modelos-v1.bedrock.integracion.test.ts`) detrás de las 5 pruebas
   del adaptador. Sustituto provisional mientras dure la sustitución del ADR-023:
   Sonnet 4.6 en el papel `opus5`.
7. Runbook de funciones ausentes en Bedrock o en Vertex, con su sustituto y los
   pasos de activación — cumplido (`docs/runbooks/modelos-funciones-ausentes.md`).

## Casos de prueba y de eval

- Unitario: identificador de modelo por papel y plataforma (con y sin prefijo
  `anthropic.`, rechazo de `ai-sdk`, la sustitución provisional de `opus5` y de
  `sonnet5` por Sonnet 4.6 en Bedrock y que Haiku 4.5 no la necesita); esfuerzo
  por clase de paso con y sin fijar en el puesto, el esfuerzo `xhigh` bajado a
  `high` en los dos papeles provisionales, y el suelo de `high` que no baja solo
  en `opus5`; decisión y ejecución del respaldo tras un rechazo,
  incluida la lectura y las bifurcaciones del adaptador de Anthropic (pensamiento
  adaptativo, la excepción de Haiku 4.5, salida estructurada válida e inválida,
  herramientas estrictas) contra el servidor simulado y contra los clientes
  reales de Bedrock con `skipAuth`; el adaptador de AI SDK con
  `MockLanguageModelV4` (texto, salida estructurada, filtro de contenido como
  rechazo); el observador de Langfuse (autenticación básica, desglose de tokens,
  fallo del envío) y el observador nulo; el catálogo de tarifas trae región,
  moneda de origen y tipo de cambio en las filas reales de Bedrock UE.
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
- Integración (se salta sin secretos, y solo corre a diario o a mano, nunca en
  cada PR): `anthropic.bedrock.integracion.test.ts` completa una petición mínima
  con el papel `sonnet5` —hoy, Sonnet 4.6— contra el Bedrock real de
  `AIW_BEDROCK_REGION_UE`, siguiendo el mismo patrón `describe.skipIf` que las
  pruebas de `@aiw/db` contra PostgreSQL sin `DATABASE_URL`. Credenciales por
  OIDC (`aiw-ci-bedrock`), nunca una clave guardada en el repositorio.

## Fuera de alcance

- El bucle del agente que llama a `packages/models` desde `apps/worker` (rebanada
  futura: el flujo `tareaAgente` de la prueba técnica del stack).
- Presupuesto de tarea (`task_budget`) y edición/compactación de contexto: los
  aplica el bucle del agente, no el puerto de modelo.
- Activar credenciales reales de Bedrock UE, de Vertex UE o de Langfuse: pasos en
  el runbook, pendientes de que Jesús cree los usuarios y el rol de IAM.
- Departamentos y puestos reales «Cobros» y «Conciliación» como filas de
  `departamento`/`puesto`: los casos dorados de esta rebanada prueban el puerto de
  modelo con su forma de decisión, no siembran el departamento de Finanzas.
- Cobrar de verdad la escritura de caché: `uso_modelo` no distingue todavía
  tokens de escritura de caché (a 5 minutos o a 1 hora) de los de entrada normal;
  las tarifas ya cargadas los traen, pero `calcularCosteEuros` no los usa hasta
  que una rebanada futura amplíe `TokensUsados` y `uso_modelo`.
- Confirmar el tipo de cambio EUR/USD versionado real: el catálogo de desarrollo
  usa 0,92 como referencia; Operación lo sustituye antes de facturar con las
  tarifas de Bedrock UE.

## Presupuesto de tokens

Presupuesto: 50 €. Consumo real: registrado en la rebanada de Notion al abrir el PR.
Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

Ninguna: el ADR-017 y el ADR-018 ya estaban aprobados antes de empezar esta
rebanada, tal como pedía el encargo.
