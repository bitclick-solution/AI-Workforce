VIGENTE

# Especificación · Sala v1 · conversación real

- Rebanada: [Notion](https://app.notion.com/p/3eb53066189881fd9e87d298529c43a6) · Ciclo 2 · Tipo Producto · Paquetes `web` · P0
- Rama: `rebanada/sala-v1-conversacion`
- Plan de referencia: [ADR-004](../adr/ADR-004.md) (sala y moderador), [ADR-022](../adr/ADR-022.md) (Sala v1: S2/S4 y presencia). Puntos de partida: [Sala v0](sala-v0.md), [Sala v1 · interfaz](sala-v1-interfaz.md), [Sala v1 · presencia](sala-v1-presencia.md).
- Zona crítica: no. Toca `apps/web/lib/sala-contrato.ts`, `apps/web/lib/sala.ts`, `apps/web/lib/sala-simulada.ts`, `apps/web/lib/sala-fuente.ts` y `apps/web/app/panel/sala/_v1/**`; ninguna ruta está en `.github/CODEOWNERS`. No toca `.github/`.

## Objetivo

La vista v1 de la sala (estilo Discord, ADR-022) deja de simular la conversación: envía mensajes de verdad por la API de Sala v0, los lee y los mantiene en vivo por el mismo cambio `mensaje` que ya reparte Centrifugo (con su caída a consulta periódica), y confirma o descarta propuestas de operación de verdad. Cierra el hueco que encontró el Probador tras el PR #54: hasta ahora `enviar` solo añadía el mensaje al estado local del navegador y la conversación que se veía era siempre la de ejemplo de `sala-simulada.ts`, viniera o no conectada la fuente real.

## Paquetes tocados

- `apps/web`: el contrato (`lib/sala-contrato.ts`), la fuente real (`lib/sala.ts`), la fuente simulada (`lib/sala-simulada.ts`), la fuente que elige la vista (`lib/sala-fuente.ts`) y la vista v1 (`app/panel/sala/_v1/vista.tsx`), más un módulo nuevo de traducción (`app/panel/sala/_v1/traduccion.ts`).

## Endpoints, flujos y datos

Sin endpoints, flujos ni migraciones nuevos. Se reutilizan los ya existentes de la sala v0:

- `GET /api/sala?salaId=` (proxy a `GET /sala?salaId=` de `apps/api`) para leer mensajes y propuestas de una sala.
- `POST /api/sala/mensajes` (proxy a `POST /sala/mensajes`) para enviar, con `salaId` en el cuerpo.
- `POST /api/sala/propuestas/:id/decision` (proxy a `POST /sala/propuestas/:id/decision`) para confirmar o descartar.

## Criterios de hecho

1. **Contrato ampliado.** `FuenteDeSala` (`apps/web/lib/sala-contrato.ts`) gana `mensajes(salaId)`, `enviarMensaje(salaId, texto)` y `decidirPropuesta(propuestaId, sentido)`, con los tipos `MensajeDeSala`, `AdjuntoDeSala`, `PropuestaDeSala`, `EfectosDeContratacion` y `ConversacionDeSala`. Acordado en el propio comentario del contrato y en esta especificación, tal como pedía «Sala v1 · interfaz» (decisión «Conversación fuera del contrato»); esta rebanada, aprobada por Jesús, es el acuerdo. `apps/web/lib/sala.ts` reexporta los tipos de la v0 (`MensajeDeLaSala`, `PropuestaDeLaSala`, `AdjuntoDeLaVista`) como alias de los del contrato, sin romper la vista v0.
2. **`crearFuenteDeSala()` (`lib/sala.ts`) implementa los tres métodos nuevos** llamando a los mismos manejadores de ruta que ya usa la vista v0 (`GET /api/sala`, `POST /api/sala/mensajes`, `POST /api/sala/propuestas/:id/decision`), sin abrir ningún camino nuevo hacia la API. `apps/web/app/panel/sala/vista.tsx` (v0) no se toca.
3. **Traducción en un solo sitio.** `apps/web/app/panel/sala/_v1/traduccion.ts` convierte `MensajeDeSala` + `PropuestaDeSala` a las cuatro formas que ya pintaba la vista v1 (texto, nota plegada del moderador, aviso de aprobación, tarjeta de propuesta), con pruebas unitarias (`traduccion.test.ts`) para cada camino: nota por el adjunto `moderacion`, propuesta por `propuesta_operacion` (con sus datos derivados de `EfectosDeContratacion`), aprobación por el adjunto `aprobacion`, y el texto por defecto cuando no hay adjunto o la propuesta citada no aparece.
4. **En vivo.** `_v1/vista.tsx` pide la conversación con `fuente.mensajes(salaId)` al abrir la sala y la vuelve a pedir cada vez que `fuente.suscribir` avisa de un cambio `{ tipo: 'mensaje' }` — el mismo que ya emite Centrifugo en cada mensaje nuevo (`apps/worker/src/actividades/sala.ts`) y el que ya cae a consulta periódica cada dos segundos cuando Centrifugo no responde (`SONDEO_SALA_MS` en `lib/sala.ts`, sin sondeo propio en la vista).
5. **La simulada solo tras el parámetro.** `sala-simulada.ts` implementa los tres métodos nuevos con su propia conversación de ejemplo (misma historia que antes, ahora en la forma del contrato) y su propio estado de la propuesta de ejemplo, para que confirmar o escribir en `?fuenteSimulada=1` se comporte igual que con la API. `crearFuente()` (`lib/sala-fuente.ts`) solo la usa tras `?fuenteSimulada=1`; sin el parámetro, siempre la real. `e2e/sala-v1.spec.ts` ya abría la sala con `?fuenteSimulada=1` (lo puso el Diseñador) y no necesitó cambios.
6. **Sin flujo de Temporal en la CI.** El camino de escritura real (`mensajeDeSala`, `propuestaDeOperacion` en `apps/worker`) no cambia y no cabe en la CI de esta rebanada: la cubre `apps/api/src/rutas/sala.test.ts` (18 pruebas, puerto falso, ya en verde) y las pruebas de `apps/web/lib/sala.test.ts` con `fetch` simulado. El Probador lo verifica de punta a punta en la máquina de Jesús.
7. **Comprobaciones locales en verde**: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm evals:smoke`, `pnpm build` y `pnpm format:check`.

## Casos de prueba y de eval

- Unitario: `apps/web/app/panel/sala/_v1/traduccion.test.ts` (nueva: texto, nota, aprobación, propuesta con y sin decidir, propuesta huérfana, `datosDePropuesta`); `apps/web/lib/sala-simulada.test.ts` (existente, sigue en verde: no se tocó `conversacionSimulada`); `apps/web/app/panel/sala/_v1/vista.test.tsx` (existente, sigue en verde con la fuente simulada inyectada: tarjetas de aprobación y propuesta, envío de un mensaje real por `fuente.enviarMensaje`); `apps/web/lib/inicio.test.ts` (los dobles de `FuenteDeSala` de «Inicio» ganaron los tres métodos nuevos como no-ops, para seguir compilando tras ampliar el contrato).
- Eval: no aplica. La rebanada no añade comportamiento de agente nuevo — conecta una interfaz a un camino de escritura que ya existía desde Sala v0 y ya tiene sus casos dorados (`sala-moderador-001`, `director-contratar-001`).
- Auditoría y contador: no aplica ninguna entrada nueva. Los mensajes y las decisiones de propuesta que llegan por esta vista pasan por las mismas rutas y actividades de Sala v0 que ya anotan `sala.mensaje_publicado`, `propuesta.aprobada`, etc.; esta rebanada no añade un segundo punto de escritura.
- Secretos: sin cambios de alcance. `apps/web/lib/sala.ts` sigue sin leer el entorno ni un secreto (el navegador solo habla con los manejadores de ruta de Next, que ya ponían el token del panel); la fuente simulada sigue sin red ni entorno. Lo cubre el job «Sin secretos en el repositorio» de la CI.

## Decisiones que el plan no fijaba

1. **Tipos del contrato, no duplicados.** En vez de declarar `MensajeDeSala`/`PropuestaDeSala` por separado en `sala-contrato.ts` y mantener los de `sala.ts` (v0) como una copia paralela, `sala.ts` pasó a reexportar los del contrato como alias (`MensajeDeLaSala = MensajeDeSala`, etc.). La vista v0 no cambia ni una línea.
2. **`aprobacion` es un adjunto del contrato, pero solo lo emite la fuente simulada.** Sala v0 no tiene todavía «aprobaciones desde la intervención» (es de _De conversación a trabajo_, fuera de alcance explícito de Sala v0). Añadí el tipo al contrato para que la traducción ya sepa pintarlo, documentado con un comentario en `sala-contrato.ts`; hasta que exista esa rebanada, la tarjeta de aprobación de la vista v1 solo se resuelve en la vista (sin llamar a la API), igual que antes.
3. **La propuesta de ejemplo de la fuente simulada pasó a tener estado real.** Antes, «Contratar» en la tarjeta de ejemplo solo cambiaba un booleano local del componente. Ahora `sala-simulada.ts` guarda el estado de esa propuesta por instancia y `decidirPropuesta` lo cambia de verdad (`pendiente` → `ejecutada`/`rechazada`), con un cambio `mensaje` de vuelta — mismo camino que seguiría la fuente real. No cambié `conversacionSimulada` (la función de antes, con su propia prueba): la conversación en la forma del contrato vive aparte, en `mensajesDeFinanzas`/`mensajesDeGeneral`, para no arriesgar esa cobertura existente por una rebanada que solo pide conectar la conversación real.
4. **Sin sondeo propio en la vista.** La consulta periódica de respaldo ya vive en `crearFuenteDeSala().suscribir` (`SONDEO_SALA_MS`, ya existente desde «Sala v1 · presencia»); la vista v1 solo necesitó reaccionar al cambio `{ tipo: 'mensaje' }` que ya emitía esa suscripción y que antes se ignoraba.
5. **Los dobles de prueba de `apps/web/lib/inicio.test.ts` (rebanada «Inicio», ya fusionada) tuvieron que ganar los tres métodos nuevos como no-ops** para seguir compilando: ampliar un contrato compartido obliga a actualizar a quien construye objetos que lo implementan, aunque sea de otra rebanada. No toqué ninguna lógica de `inicio.ts`.

## Fuera de alcance

- Aprobaciones reales desde la intervención sin pasar por una propuesta de operación (_De conversación a trabajo_).
- «Quién soy yo» para la fuente real: `ID_DE_QUIEN_MIRA` sigue siendo un identificador simulado (`persona-lucia`) que la vista usa para «eres tú» en el panel de miembros y para no contarte a ti mismo como quien escribe; es una limitación ya existente de «Sala v1 · interfaz» (el contrato no expone la identidad de quien mira) y no la introduce ni la agranda esta rebanada. No la arreglo aquí: tocar identidad real es «Identidad y organizaciones».
- Hilos, mensajes fijados y mensajes directos.
- Sala del departamento con moderador y Director con paso de modelo real (rebanada aparte, que este PR desbloquea).

## Presupuesto de tokens

Presupuesto: 25 €. Consumo real: se registra en la rebanada al abrir el PR.

## Pregunta abierta

Ninguna: los criterios de la rebanada en Notion y el contrato ya acordado con el Diseñador bastan para decidir el diseño.
