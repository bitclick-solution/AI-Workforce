VIGENTE

# Especificación · Supervisor de departamento y memoria compartida en Finanzas

- Rebanada: [Notion](https://app.notion.com/p/3eb530661898815a8598e0b03b232483) · Ciclo 2 · Tipo Producto · Paquetes `apps/platform-agents`, `apps/worker`, `packages/learning` · P0
- Rama: `rebanada/supervisor-de-departamento-finanzas`
- Plan de referencia: [ADR-004](../adr/ADR-004.md) (colaboración, sala y agentes de plataforma), [ADR-005](../adr/ADR-005.md) (aprendizaje acotado y promoción por nivel), [ADR-014](../adr/ADR-014.md) (delegación con plazo y respaldo). Punto de partida: [Aprendizaje v0](aprendizaje-v0.md), `apps/platform-agents/src/index.ts` (nombra al supervisor sin implementarlo) y `packages/db/src/conocimiento.ts` (`memoria.ambito`).
- Zona crítica: **sí**. Amplía las promociones del aprendizaje a un ámbito compartido, que cambia lo que varios puestos leen al empezar una tarea. «Revisión humana obligatoria» marcada.
- Depende de: «Proveedor real en el bucle del agente» solo si una versión posterior del supervisor usa modelo; esta no lo usa.

## Objetivo

La ficha de Finanzas habla de un supervisor de departamento y de memoria que comparten los puestos, pero hoy no existe ninguno de los dos: la delegación entre puestos funciona y nadie vigila que se cierre, y cada lección promovida es de un solo puesto. Con esta rebanada, el supervisor de Finanzas avisa en la sala del departamento cuando una delegación no se cierra bien, y Cobros, Conciliación y Previsión leen una memoria común del departamento que una persona promociona.

## Decisiones que esta especificación fija

1. **El supervisor v0 no usa modelo**, como el moderador de la Sala v0: reglas y datos. Sin prompt de sistema propio no hay prompt que revisar; si una versión posterior le da modelo, es otra rebanada y otra revisión de Jesús.
2. **Qué vigila: solo delegaciones.** Publica en la sala del departamento cuando una delegación vence su plazo, se aplica el respaldo del ADR-014 o el puesto destino devuelve un resultado que escala. El mensaje lleva el encargo, los dos puestos, el motivo y una propuesta de siguiente paso para una persona. No ejecuta nada.
3. **No publica indicadores ni umbrales.** Eso es de «Cuadros de mando por departamento con umbrales publicados en la sala», que depende de la materialización horaria de indicadores, que aún no existe. Tampoco dispara tareas por calendario: «Disparadores gobernados por puesto» (Ciclo 4).
4. **Memoria compartida = lección con ámbito de departamento.** `proponerLeccion` y `promocionarLeccion` hoy escriben memoria de ámbito puesto. Se amplían para admitir el ámbito `departamento`, que escribe la memoria con `ambito = 'departamento'` y `ambito_id` el departamento. Va por la misma puerta del Evaluador y la misma promoción por nivel que las de puesto, y crea una versión nueva en cada puesto del departamento, revertible.
5. **Quién la lee.** Solo los puestos del departamento dueño. Un puesto de otro departamento no la ve, y el aislamiento por departamento tiene su prueba.
6. **Lo que no entra.** La memoria de departamento no admite contenido marcado como categoría especial (`categoria_especial`) ni datos de una persona concreta: la puerta del Evaluador la rechaza. Las promesas de pago, disputas y «no contactar» por cliente son de «Memoria por contacto», no de esta.
7. **Sin migración.** La tabla `memoria` ya tiene el ámbito; `version_puesto.memoria_congelada` ya fija lo que lee cada versión.

## Paquetes tocados

- `apps/platform-agents`: el supervisor de departamento, con sus reglas.
- `apps/worker`: el evento que lo despierta desde el flujo de delegación y la carga de la memoria de departamento en el contexto del puesto.
- `packages/learning`: el ámbito `departamento` en proponer y promocionar, y la reversión de una versión que lo incluye.

## Endpoints, flujos y datos

Sin endpoints ni tablas nuevas. El supervisor publica por las actividades de sala ya existentes, como participante de plataforma; el Constructor confirma el rol que corresponde en `rol_participante`.

## Criterios de hecho

1. Una delegación de Cobros a Conciliación que vence su plazo produce un mensaje del supervisor en la sala de Finanzas, una sola vez, con el encargo, los dos puestos, el motivo y una propuesta de siguiente paso; una delegación que se cierra a tiempo no produce ninguno.
2. La aplicación del respaldo del ADR-014 produce el mismo mensaje con el motivo correspondiente, y dos eventos de la misma delegación no duplican el mensaje.
3. El supervisor no llama a ninguna herramienta de un conector, no escribe en ningún sistema y no cambia el estado de la tarea: lo comprueba una prueba sobre sus llamadas.
4. Una lección propuesta con ámbito `departamento` pasa por `puerta` del Evaluador; si bloquea, no hay memoria ni versión; si certifica y una persona la promociona, los tres puestos de Finanzas tienen una versión nueva con esa línea en su memoria.
5. Un puesto de otro departamento de la misma organización no lee la memoria de departamento de Finanzas, y otra organización tampoco: prueba de aislamiento con RLS.
6. La reversión de una versión de puesto que incluía la memoria de departamento la retira de ese puesto y deja las demás versiones intactas.
7. Una lección de departamento con contenido marcado como categoría especial queda bloqueada.
8. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm evals:smoke` y `pnpm build` pasan en verde.

## Casos de prueba y de eval

- Unitario: reglas del supervisor (plazo vencido, respaldo, resultado que escala, cierre a tiempo, evento repetido); texto del mensaje con datos y sin datos personales.
- Integración con PostgreSQL: promoción con ámbito departamento, versiones nuevas por puesto, reversión, aislamiento entre departamentos y organizaciones; se salta sin `DATABASE_URL`.
- Eval: `aprendizaje-departamento-001` en `packages/evals/smoke/aprendizaje.eval.ts`: una lección de departamento que cumple pasa la puerta, una que baja la certificación o lleva categoría especial no pasa. Sin comportamiento de agente nuevo del supervisor, porque no usa modelo.
- Auditoría y contador: cada mensaje del supervisor y cada promoción dejan su entrada en el libro; el supervisor no suma al contador de tareas de ningún puesto.
- Secretos: nada de credenciales en mensajes ni en la memoria; rastreo como en `packages/learning`.

## Fuera de alcance

- Indicadores y umbrales en la sala: «Cuadros de mando por departamento con umbrales publicados en la sala».
- Disparar el supervisor o los puestos por calendario o evento de conector: «Disparadores gobernados por puesto».
- Memoria por contacto: «Memoria por contacto: promesas de pago, disputas y “no contactar” compartidos entre puestos».
- Supervisor con modelo y prompt propio.
- Memoria de ámbito organización compartida entre departamentos.

## Presupuesto de tokens

Presupuesto: 45 €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

¿Quién promociona la memoria de un departamento: la persona que supervisa el departamento (`supervisor_persona_id`) o cualquier persona con permiso de promoción en la organización?
