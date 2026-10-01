VIGENTE

# Especificación · Expediente por agente con niveles N0 y N1 en el panel

- Rebanada: [Notion](https://app.notion.com/p/3eb530661898817396f3f3be04edd538) · Ciclo 2 · Tipo Producto · Paquetes `apps/web`, `apps/api`, `packages/ui` · P1
- Rama: `rebanada/expediente-por-agente-n0-n1`
- Plan de referencia: [ADR-003](../adr/ADR-003.md) y [ADR-005](../adr/ADR-005.md) (niveles por clase de acción, ascenso por evidencia), [Aprendizaje v0](aprendizaje-v0.md) (`leerExpediente`), [Acceso al panel](acceso-al-panel.md) y la [ficha de Finanzas](../producto/finanzas.md) (niveles iniciales y techo N1 en la fase 1).
- Zona crítica: no, mientras solo lea. Si el Constructor necesita tocar `apps/api/src/identidad` o los permisos para decidir quién puede ver el expediente, marca «Zona crítica: sí» y lo dice en la ficha antes de seguir.

## Objetivo

`leerExpediente` ya calcula las lecciones y las versiones de un puesto, y hoy solo lo usan la demostración y una CLI. Con esta rebanada, una persona abre el expediente de un agente en el panel y ve con qué nivel trabaja en cada clase de acción, cómo ha cambiado, qué ha aprendido, qué ha intentado que la política rechazó y cuánto le falta para subir de nivel.

## Decisiones que esta especificación fija

1. **Solo lectura.** El expediente no sube ni baja niveles y no promociona lecciones. Los niveles de la fase 1 llegan hasta N1 (ficha de Finanzas); el panel muestra N0 a N3 por si una versión futura los usa, pero no ofrece ningún botón.
2. **Sin migración: el historial de niveles se deriva.** Cada `version_puesto` es inmutable y lleva su `politica` con el nivel por clase de acción. El historial es la secuencia de versiones con sus diferencias, cada una con su fecha y, si la hay, la lección o la persona que la originó.
3. **Qué enseña**, por puesto y por clase de acción: nivel vigente; historial de cambios de nivel; la versión activa y sus lecciones con su estado (vigente, retirada, propuesta); las acciones rechazadas por política, tomadas del libro de auditoría; y el avance hacia el ascenso con los cuatro criterios del ADR-005 (acciones, porcentaje aprobado sin cambios, días sin incidentes y confirmación).
4. **«Fijo» se muestra como fijo.** Las clases que la ficha marca «N1 fijo» o «N0 fijo» (asiento de diferencia, tercer aviso, gasto) no enseñan una barra de progreso hacia un ascenso que la primera versión no ofrece.
5. **Quién lo ve.** Quien ya puede ver el puesto según `apps/api/src/identidad`; esta rebanada no crea permisos nuevos.
6. **Sin datos personales de terceros.** El expediente muestra identificadores y contadores; el detalle de una acción enlaza a la tarea, cuyo acceso ya está controlado, y no copia textos de clientes.

## Paquetes tocados

- `apps/api`: `GET /puestos/:puestoId/expediente`, que compone `leerExpediente`, las versiones con su política y las entradas del libro por puesto.
- `apps/web`: la pantalla del expediente dentro del panel.
- `packages/ui`: los componentes nuevos que haga falta (línea de tiempo de niveles, medidor de ascenso) con el sistema de diseño de Bitclick.

## Endpoints, flujos y datos

Un endpoint de lectura. Sin flujos nuevos, sin tablas y sin migración. Se respeta el aislamiento por organización con RLS como el resto de lecturas de la API.

## Criterios de hecho

1. `GET /puestos/:puestoId/expediente` devuelve versión activa, versiones con su política, lecciones con estado, acciones rechazadas por política y avance hacia el ascenso por clase de acción, para un puesto de la organización de la sesión.
2. Un puesto de otra organización devuelve no encontrado, y una persona sin permiso sobre el puesto, prohibido: pruebas con dos organizaciones.
3. El historial de niveles de un puesto con tres versiones, una de ellas con un nivel distinto en una clase, muestra exactamente ese cambio, con su fecha y la versión que lo produjo.
4. Las clases «fijo» no muestran avance hacia un ascenso; una clase «N1 → N2» muestra los cuatro criterios con su valor actual.
5. Las acciones rechazadas por política de un puesto aparecen con su fecha y la clase, y enlazan a la entrada del libro; ninguna entrada de otro puesto aparece.
6. La pantalla funciona en escritorio y móvil, pasa las comprobaciones de contraste de `packages/ui` y no ofrece ninguna acción de escritura.
7. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm evals:smoke` y `pnpm build` pasan en verde, y la prueba de Playwright de la pantalla corre en la CI.

## Casos de prueba y de eval

- Unitario: composición del historial de niveles con cero, una y varias versiones; ascenso con datos completos y con datos insuficientes; clases fijas.
- Integración con PostgreSQL: endpoint con dos organizaciones y dos puestos; aislamiento; acciones rechazadas de un puesto; se salta sin `DATABASE_URL`.
- Interfaz: prueba de componentes y de Playwright con datos de muestra de Cobros, como la pantalla de inicio.
- Eval: sin comportamiento de agente nuevo.
- Auditoría y contador: la lectura no emite acciones ni suma al contador; si el Constructor decide registrar la consulta, lo documenta.
- Secretos: ninguna credencial en las respuestas ni en los datos de muestra.

## Fuera de alcance

- Subir o bajar niveles, o promocionar lecciones desde el panel: rebanadas de ciclo de vida de los puestos.
- Criterios de éxito por puesto y auditoría por muestreo: «Criterios de éxito por puesto y auditoría por muestreo».
- Niveles N2 y N3 operativos: fases 2 y 3.
- Expediente de agentes de plataforma.

## Presupuesto de tokens

Presupuesto: 35 €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

¿Las acciones rechazadas por política deben ser visibles para cualquier persona que vea el puesto, o solo para quien supervisa el departamento?
