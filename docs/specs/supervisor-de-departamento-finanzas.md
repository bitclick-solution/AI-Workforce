VIGENTE

# Especificación · Supervisor de departamento y memoria compartida en Finanzas

- Rebanada: [Notion](https://app.notion.com/p/3eb530661898815a8598e0b03b232483) · Ciclo 2 · Tipo Producto · Paquetes `apps/platform-agents`, `apps/worker`, `packages/learning`, `packages/db` (migración `0011`) · P0
- Rama: `rebanada/supervisor-de-departamento-finanzas`
- Revisión de la especificación: 2-10-2026. El Revisor bloqueó el PR #68 porque la decisión 4 (una versión nueva por puesto) contradecía la decisión 7 (sin migración). Jesús resolvió las dos preguntas el 2-10-2026; las decisiones 4, 7 y 8 y la sección «Decisiones de Jesús» lo recogen.
- Plan de referencia: [ADR-004](../adr/ADR-004.md) (colaboración, sala y agentes de plataforma), [ADR-005](../adr/ADR-005.md) (aprendizaje acotado y promoción por nivel), [ADR-014](../adr/ADR-014.md) (delegación con plazo y respaldo). Punto de partida: [Aprendizaje v0](aprendizaje-v0.md), `apps/platform-agents/src/index.ts` (nombra al supervisor sin implementarlo) y `packages/db/src/conocimiento.ts` (`memoria.ambito`).
- Zona crítica: **sí**. Amplía las promociones del aprendizaje a un ámbito compartido, que cambia lo que varios puestos leen al empezar una tarea, y añade una migración (`0011`). «Revisión humana obligatoria» marcada.
- Depende de: «Proveedor real en el bucle del agente» solo si una versión posterior del supervisor usa modelo; esta no lo usa.

## Objetivo

La ficha de Finanzas habla de un supervisor de departamento y de memoria que comparten los puestos, pero hoy no existe ninguno de los dos: la delegación entre puestos funciona y nadie vigila que se cierre, y cada lección promovida es de un solo puesto. Con esta rebanada, el supervisor de Finanzas avisa en la sala del departamento cuando una delegación no se cierra bien, y Cobros, Conciliación y Previsión leen una memoria común del departamento que una persona promociona.

## Decisiones que esta especificación fija

1. **El supervisor v0 no usa modelo**, como el moderador de la Sala v0: reglas y datos. Sin prompt de sistema propio no hay prompt que revisar; si una versión posterior le da modelo, es otra rebanada y otra revisión de Jesús.
2. **Qué vigila: solo delegaciones.** Publica en la sala del departamento cuando una delegación vence su plazo, se aplica el respaldo del ADR-014 o el puesto destino devuelve un resultado que escala. El mensaje lleva el encargo, los dos puestos, el motivo y una propuesta de siguiente paso para una persona. No ejecuta nada.
3. **No publica indicadores ni umbrales.** Eso es de «Cuadros de mando por departamento con umbrales publicados en la sala», que depende de la materialización horaria de indicadores, que aún no existe. Tampoco dispara tareas por calendario: «Disparadores gobernados por puesto» (Ciclo 4).
4. **Memoria compartida = lección con ámbito de departamento.** `proponerLeccion` y `promocionarLeccion` hoy escriben memoria de ámbito puesto. Se amplían para admitir el ámbito `departamento` (`parametros.destino = 'departamento'`), que escribe una fila de `memoria` con `ambito = 'departamento'` y `ambito_id` el departamento. Va por la misma puerta del Evaluador y la misma promoción por nivel que las de puesto. **Una promoción de departamento deja una versión nueva en cada puesto activo del departamento, en una sola transacción**: o quedan todas o ninguna. Cada versión es inmutable y se revierte por puesto con `revertirVersion`, sin tocar las demás (decisión 7).
5. **Quién la lee.** Solo los puestos del departamento dueño. Un puesto de otro departamento no la ve, y el aislamiento por departamento tiene su prueba.
6. **Lo que no entra.** La memoria de departamento no admite contenido marcado como categoría especial (`categoria_especial`) ni datos de una persona concreta: la puerta del Evaluador la rechaza. Las promesas de pago, disputas y «no contactar» por cliente son de «Memoria por contacto», no de esta.
7. **Con migración `0011` (decisión de Jesús, 2-10-2026; sustituye a «Sin migración»).** La tabla `promocion` tiene el índice único `promocion_tenant_leccion_key` (una promoción por lección) y una sola `version_puesto_resultante_id`, así que una promoción no puede dar varias versiones. Diseño mínimo: una tabla hija, `promocion_version`, con una fila por versión que crea la promoción (`promocion_id`, `puesto_id`, `version_puesto_id`, `version_anterior_id`), inmutable, con `tenant_id` y RLS, único por `(tenant_id, promocion_id, puesto_id)` y por `(tenant_id, version_puesto_id)`.
   - **Por qué así y no otra cosa.** Quitar el índice único de `promocion` reabriría el hueco que cerró la `0002` (una lección promocionada dos veces). Convertir `version_puesto_resultante_id` en un arreglo rompería la clave foránea y las consultas de `leerExpediente`. Una promoción por lección se mantiene; la tabla hija solo cuelga lo que falta.
   - **Compatibilidad.** `promocion.version_puesto_resultante_id` sigue apuntando a la versión del puesto que originó la lección (la de la señal). Una promoción de puesto no escribe filas en la tabla nueva: no cambia nada para lo que ya existe. Una de departamento escribe una fila por puesto, incluido el de origen.
   - **Reverso.** `packages/db/drizzle/reverso/0011_promocion_version.sql` borra la tabla. No hay pérdida de datos que no se pueda reconstruir: la versión de cada puesto sigue en `version_puesto` (inmutable) y en `lecciones_origen`; solo se pierde el vínculo promoción → versiones, que se deriva de `lecciones_origen`.
   - **Prueba.** Base vacía: migrar, revertir solo la `0011` (no `pnpm db:revertir`, que deshace todas), volver a migrar.
8. **Quién promociona la memoria de un departamento (decisión de Jesús, 2-10-2026).** La persona que supervisa el departamento (`departamento.supervisor_persona_id`) o un administrador de la organización. Hoy no hay roles: hasta la rebanada «Personas, roles y permisos por equipo» (prevista para el 7-12-2026) toda persona es propietaria, y por tanto administradora. Regla implementada ahora: `promocionarLeccion` con ámbito `departamento` acepta a `supervisor_persona_id` o a cualquier persona activa de la organización (administrador por defecto); si el departamento tiene supervisor y el promotor es otro, el libro anota la promoción con ambas personas y la regla queda como función `puedePromocionarDepartamento` aislada y probada. **Cómo se estrecha con los roles:** cuando existan, esa función pasa a aceptar solo a `supervisor_persona_id` o a quien tenga el rol de administrador de la organización, y la prueba «una persona sin rol no promociona» pasa de documentada a activa. Es un cambio de una función y su prueba, sin migración. Una promoción de puesto no cambia.

## Paquetes tocados

- `apps/platform-agents`: el supervisor de departamento, con sus reglas.
- `apps/worker`: el evento que lo despierta desde el flujo de delegación y la carga de la memoria de departamento en el contexto del puesto.
- `packages/learning`: el ámbito `departamento` en proponer y promocionar, la regla de quién promociona y la reversión de una versión que lo incluye.
- `packages/db`: la migración `0011_promocion_version` con su reverso y la tabla `promocion_version` en el esquema tipado y en las listas de tablas.

## Endpoints, flujos y datos

Sin endpoints. Una tabla nueva, `promocion_version` (decisión 7). El supervisor publica por las actividades de sala ya existentes, como participante de plataforma; el Constructor confirma el rol que corresponde en `rol_participante`.

## Criterios de hecho

1. Una delegación de Cobros a Conciliación que vence su plazo produce un mensaje del supervisor en la sala de Finanzas, una sola vez, con el encargo, los dos puestos, el motivo y una propuesta de siguiente paso; una delegación que se cierra a tiempo no produce ninguno.
2. La aplicación del respaldo del ADR-014 produce el mismo mensaje con el motivo correspondiente, y dos eventos de la misma delegación no duplican el mensaje.
3. El supervisor no llama a ninguna herramienta de un conector, no escribe en ningún sistema y no cambia el estado de la tarea: lo comprueba una prueba sobre sus llamadas.
4. Una lección propuesta con ámbito `departamento` pasa por `puerta` del Evaluador; si bloquea, no hay memoria ni versión; si certifica y la promociona quien puede (decisión 8), los tres puestos de Finanzas tienen una versión nueva con esa línea en su memoria, con una fila de `promocion_version` por puesto, y una promoción que falla a medias no deja ninguna.
5. Un puesto de otro departamento de la misma organización no lee la memoria de departamento de Finanzas, y otra organización tampoco: prueba de aislamiento con RLS.
6. La reversión de una versión de puesto que incluía la memoria de departamento la retira de ese puesto y deja las demás versiones intactas.
7. Una lección de departamento con contenido marcado como categoría especial queda bloqueada.
8. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm evals:smoke` y `pnpm build` pasan en verde.
9. Promociona la memoria de un departamento quien supervisa el departamento o un administrador (decisión 8); una persona de otra organización o inexistente queda rechazada.
10. La migración `0011` se aplica en una base vacía, su reverso se aplica solo y la deja como antes, y se vuelve a aplicar sin error; la tabla nueva tiene RLS, es inmutable y entra en las listas de tablas del esquema.

## Casos de prueba y de eval

- Unitario: reglas del supervisor (plazo vencido, respaldo, resultado que escala, cierre a tiempo, evento repetido); texto del mensaje con datos y sin datos personales.
- Integración con PostgreSQL: promoción con ámbito departamento (atomicidad incluida), regla de quién promociona, migración `0011` y su reverso, versiones nuevas por puesto, reversión, aislamiento entre departamentos y organizaciones; se salta sin `DATABASE_URL`.
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

## Decisiones de Jesús (2-10-2026)

Resuelven el bloqueo del Revisor en el PR #68 y cierran la pregunta abierta de la primera versión («¿quién promociona la memoria de un departamento?»):

1. **Con migración.** Se admite una migración pequeña para que una lección de departamento deje una versión nueva en cada puesto del departamento, revertible por puesto. Cambia la decisión 7. Diseño en las decisiones 4 y 7.
2. **Quién promociona.** La persona que supervisa el departamento o un administrador de la organización; sin roles todavía, se implementa con lo que existe y se estrecha en «Personas, roles y permisos por equipo». Decisión 8.

## Pregunta abierta

Ninguna.
