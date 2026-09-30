LISTO PARA ENCARGO

# Especificación · Proveedor real en el bucle del agente: los puestos usan Bedrock UE según AIW_PROVEEDOR_MODELOS

- Rebanada: [Notion](https://app.notion.com/p/3eb53066189881d78dd1efa44265abe1) · Ciclo 1 · Tipo Plataforma · Paquetes `models`, `worker`, `platform-agents`, `evals`, `docs` · P0
- Rama: `rebanada/proveedor-real-en-el-bucle`
- Plan de referencia: [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn) y los ADR-017 (residencia UE), ADR-018 (papeles, esfuerzo, respaldo, coste) y ADR-023 (Bedrock clásico como vía provisional; proveedor en una línea).
- Zona crítica: sí — las plantillas certificadas de plataforma (`apps/platform-agents/src/catalogo/plantillas.json`). Marca «Revisión humana obligatoria» en la rebanada y «Zona crítica: sí» en el PR. **No fusionar antes de la demo del viernes 2-10** (decisión de Jesús del 30-9).

## Objetivo

Hoy ningún agente de la plataforma decide con un modelo real: el `Enrutador` solo trae el proveedor de prueba, ningún proceso registra otro y las plantillas fijan `prueba/deterministico`. Al terminar, el trabajador registra al arrancar el proveedor que diga `AIW_PROVEEDOR_MODELOS` (Bedrock UE por defecto), los puestos enrutan por papel (`opus5`, `sonnet5`, `haiku45`), cada llamada suma al contador con tokens y tarifa reales, y el proveedor de prueba solo se usa si alguien lo elige por escrito. La semana de uso de Bitclick deja de medir un coste de modelo de 0 €.

## Paquetes tocados

- `packages/models`: enrutador por papel y proveedor elegido; `enrutadorDesdeEntorno` (reutiliza `clienteDelProveedorDesdeEntorno` y `crearAdaptadorAnthropic`); el puerto admite herramientas con esquema JSON y el ciclo herramienta→resultado; paso sobre el puerto; respaldo por error del proveedor; `modeloDeTarifa`.
- `apps/worker`: el contexto construye el enrutador desde el entorno (sin caída silenciosa a prueba); `pasoModelo` usa el puerto real, comprueba la tarifa antes de llamar y cobra con el modelo servido y su plataforma; el turno del agente guarda sus llamadas; coste por tarea a Langfuse; siembra de tarifas de Bitclick; demos y `lanzar-cobros` eligen su proveedor de forma explícita.
- `apps/platform-agents`: las dos plantillas certificadas pasan a `papel` (datos, ningún prompt) y el Director copia el nuevo enrutado.
- `packages/evals`: casos dorados con el enrutado nuevo; el caso de herramientas en dos vueltas.
- `docs`, `.env.example`, `scripts/local-arrancar.mjs` (solo la línea del proveedor): runbook, spec, variables.

## Endpoints, flujos y datos

Sin endpoints ni migración. `puesto.enrutado_modelo` es `jsonb` sin esquema en la base: el esquema Zod pasa a admitir `{ papel, papelRespaldo?, modeloDePrueba? }` además de `{ proveedor, modelo }`. Los puestos ya sembrados (`prueba/deterministico…`) siguen siendo válidos sin reescribirlos. Lo que cambia es que `{}` ya no significa «prueba»: falla con un mensaje claro. El turno `agente` del historial de Temporal gana `llamadas` y `bloques` opcionales (los historiales viejos no los traen y siguen siendo legibles).

## Criterios de hecho

1. El trabajador registra al arrancar el proveedor de `AIW_PROVEEDOR_MODELOS` (`bedrock-ue` por defecto, `vertex-ue`, o `prueba` explícito) y el respaldo de `AIW_PROVEEDOR_MODELOS_RESPALDO`, con las fábricas y clientes de Modelos v1. Sin credenciales del proveedor elegido, el arranque falla con un mensaje que nombra la variable que falta.
2. Las plantillas `finanzas.reclamacion-de-cobros` (`sonnet5`, respaldo `haiku45`) y `finanzas.conciliacion-bancaria` (`opus5`, respaldo `sonnet5`) enrutan por papel; el identificador lo resuelve `identificadores.ts`. Ningún prompt cambia.
3. El proveedor de prueba solo entra con `AIW_PROVEEDOR_MODELOS=prueba`. Sin enrutador ni variable, `crearContextoDeActividades` falla. La CI, los evals de humo, las pruebas y `pnpm local:arrancar` lo eligen a propósito. `.env.example` dice cuál es el valor de la demo local y cómo pasar a Bedrock.
4. Cada paso de modelo real suma al contador con los tokens reales, el modelo servido y su plataforma, y la tarifa versionada; la tarifa se comprueba antes de llamar (una llamada sin tarifa no se reintenta ni se paga dos veces). Respeta el presupuesto del puesto: el bucle ya corta antes del paso.
5. Un error del proveedor principal pasa la misma petición al proveedor de respaldo; un rechazo del clasificador pasa al papel de respaldo del puesto. Ambos con prueba, incluidos «respaldo también falla» y «sin respaldo».
6. Los casos dorados de Cobros y Conciliación contra Bedrock UE siguen en verde con el enrutado nuevo. El job corre solo en `main`: Jesús lo lanza a mano tras fusionar (se dice en el PR).
7. El runbook explica el proveedor real en local (usuario IAM `aiw-dev` en `.env`) y el coste esperado por tarea de Cobros.
8. El coste por tarea llega a Langfuse cuando hay claves; sin ellas no pasa nada.
9. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm evals:smoke` y `pnpm build` en verde. No se fusiona antes de la demo del viernes 2-10.

## Casos de prueba y de eval

- Unitario: enrutado por papel (éxito, papel sin proveedor elegido, `{}`, `prueba` sin `modeloDePrueba`); `enrutadorDesdeEntorno` (prueba explícito, Bedrock sin credenciales, valor inválido, respaldo perezoso); ciclo herramienta→resultado en el adaptador (bloques de razonamiento devueltos tal cual, resultados juntos en un solo mensaje); respaldo por error y por rechazo; `modeloDeTarifa`; `pasoModelo` con puerto simulado (cobro con plataforma, tarifa ausente, rechazo, reintento idempotente).
- Eval: el caso dorado de Cobros y el de Conciliación corren por el enrutado por papel con el servidor simulado; el job de Bedrock añade el caso de herramientas en dos vueltas (solo con credenciales).
- Auditoría y contador: cada paso emite su entrada `uso_modelo` (proveedor `anthropic`, modelo servido, plataforma) y suma al contador de la tarea raíz; se comprueba en la prueba de integración del trabajador.
- Secretos: ninguna credencial de AWS entra en código, prompts ni registros; el mensaje de arranque nombra variables, nunca valores. Prueba que rastrea un valor centinela por el mensaje de error y las trazas.

## Fuera de alcance

- Cobrar los tokens de escritura de caché por TTL (rebanada futura, ya anotada en Modelos v1).
- Moderador de sala y Director con paso de modelo: usarán este enrutador, no forman parte de esta rebanada.
- Cambiar el prompt, el nivel o la política de ningún puesto.

## Presupuesto de tokens

Presupuesto: 25 €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

¿Cobrar el papel `opus5` con la tarifa del modelo servido (Sonnet 4.6, la fila que Modelos v1 ya cargó para ese caso) o con la del papel (Opus 5)? Esta rebanada usa la del modelo servido, porque es el coste real; se cambia en `modeloDeTarifa`.
