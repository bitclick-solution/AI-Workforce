VIGENTE

# Especificación · Aprendizaje v0: una señal se convierte en lección y en versión nueva del puesto

- Rebanada: [Notion](https://app.notion.com/p/3e0530661898812ba435fd118abc63e3) · Ciclo 0 · Tipo Plataforma · Paquetes `learning` (más `worker`, `ledger` y `evals`, ver decisión 1) · P1
- Rama: `rebanada/aprendizaje-v0`
- Plan de referencia: _Autonomía y autoaprendizaje_ del [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn) (el bucle: señales, lecciones candidatas, evaluación, promoción por nivel, versión y reversión); [ADR-001](../adr/ADR-001.md) (borrador opaco), [ADR-004](../adr/ADR-004.md) (memoria en tres ámbitos), [ADR-005](../adr/ADR-005.md) (aprendizaje acotado, versiones inmutables con reversión) y [ADR-007](../adr/ADR-007.md) (filas inmutables). Producto: [README](../producto/README.md) y [finanzas](../producto/finanzas.md) («ejemplos: cada aprobación con edición del borrador»). Requisito de la revisión de la fase 0 del 2 de octubre de 2026: «una lección promocionada a mano».
- Zona crítica: sí. Promociones del aprendizaje y versión de puesto; toca el libro de auditoría (`registrarDecision` acepta la edición). Sin migración. «Revisión humana obligatoria» marcada.

## Objetivo

Cuando una persona edita el borrador de un agente antes de aprobarlo, esa edición deja de perderse: se registra como señal, un flujo durable de aprendizaje la convierte en una lección de memoria acotada y sin datos personales, y la lección espera a una persona. Jesús la promociona a mano; la promoción pasa por la puerta del Evaluador, crea una versión inmutable del puesto y mueve el puntero. La tarea siguiente del puesto arranca con la versión nueva y ve la lección en su prompt; revertir devuelve el puntero a la versión anterior en una operación, con la traza de qué lecciones se retiran.

## Paquetes tocados

- `packages/learning`: nace su lógica. Diferencia genérica de borradores, detector de datos personales, redacción determinista de la lección, y las cuatro operaciones con base: `registrarSenalDeEdicion`, `proponerLeccion`, `promocionarLeccion`, `revertirVersion`, más `versionActivaDe` y `leerExpediente`.
- `apps/worker`: flujo durable `aprendizajeDeSenal` (señal → lección) y sus actividades; la tarea lo arranca como hijo abandonado cuando la decisión es `editada`; `leerContexto` compone el prompt con la memoria congelada de la versión; CLI `aprendizaje` para promocionar y revertir a mano; demo de un comando.
- `packages/ledger`: `registrarDecision` acepta `edicionPrevia` con sentido `editada` y anota `aprobacion.editada`.
- `packages/evals`: caso dorado `aprendizaje-001` y la puerta del Evaluador (`certificarPromocion`).
- De paso, sin lógica nueva: `packages/domain` gana los esquemas `edicionBorrador`, `memoriaCongelada` y `leccionesOrigen` para las columnas `jsonb` que se empiezan a escribir; `.github/workflows/ci.yml` añade `@aiw/learning` al job «Base de datos» para que sus pruebas de integración corran en la CI.

## Endpoints, flujos y datos

- Sin migración: las tablas `senal`, `leccion`, `leccion_senal`, `promocion`, `version_puesto`, `memoria` y el puntero `puesto.version_activa_id` del modelo v1 bastan (decisión 3).
- `decision_aprobacion.edicion_previa` guarda `{ antes, despues }`: la carga original del borrador y la editada (decisión 2).
- Flujo `aprendizajeDeSenal(tenantId, aprobacionId)`, identificador `aprendizaje-<aprobacionId>`: actividad `registrarSenalDeEdicion` → actividad `proponerLeccion`. Idempotente por aprobación y por señal; reintentos de Temporal sin duplicar filas.
- Acciones del libro: `aprobacion.editada`, `aprendizaje.senal.registrada`, `aprendizaje.leccion.propuesta`, `aprendizaje.leccion.promocionada`, `aprendizaje.promocion.bloqueada`, `aprendizaje.version.revertida`. Todas por `anotar`, que suma al contador.
- CLI (`src/demo-aprendizaje-cli.ts`): `pnpm --filter @aiw/worker aprendizaje expediente <puestoId>`, `… aprendizaje promocionar <leccionId> --persona <personaId>` y `… aprendizaje revertir <puestoId> --a <versionId> --persona <personaId>`, todos con `--tenant`. `decidir <aprobacionId> editada --texto "…"` escribe la edición desde la línea de mandatos, que es lo que el panel hará después.

## Criterios de hecho

1. `registrarDecision` con sentido `editada` guarda `{antes, despues}` en `edicion_previa` y anota `aprobacion.editada`; sin edición, o con edición y otro sentido, se rechaza antes de escribir.
2. `registrarSenalDeEdicion` inserta una señal `correccion` con origen `aprobacion.editada` y la diferencia por rutas; llamarla dos veces devuelve la misma señal.
3. `proponerLeccion` inserta una lección `memoria` en estado `propuesta`, con destino `puesto`, enlazada por `leccion_senal`, sin datos personales (correo, teléfono, IBAN, DNI/NIE/CIF, tarjeta) y nunca de clase `modelo_base`.
4. `promocionarLeccion` exige persona, pasa la puerta del Evaluador, crea `version_puesto` con número siguiente, la memoria anterior más la lección y `lecciones_origen` ampliado, inserta `promocion`, mueve `puesto.version_activa_id` y escribe la memoria viva del puesto. Si la puerta falla, no crea versión y anota `aprendizaje.promocion.bloqueada`. Una lección ya promocionada no se promociona otra vez.
5. La tarea siguiente del puesto, con `versionActivaDe`, usa la versión nueva, y `leerContexto` devuelve un prompt que contiene la lección. Tras `revertirVersion`, la siguiente usa la anterior y el prompt ya no la contiene; la entrada del libro nombra las lecciones retiradas y su memoria viva caduca.
6. `pnpm --filter @aiw/worker demo:aprendizaje` recorre los pasos 1 a 5 contra PostgreSQL y termina con la cadena de auditoría verificada.

## Casos de prueba y de eval

- Unitario (`packages/learning`): diferencia de borradores con objetos anidados, listas y tipos distintos; detector de datos personales con positivos y negativos; redacción de la lección con y sin cambios; rechazo de clases fuera del ADR-005.
- Integración con PostgreSQL (`packages/learning`, `apps/worker`, `packages/ledger`): los seis criterios, idempotencia de señal y lección, promoción doble, promoción sin persona, puerta que bloquea, reversión a una versión de otro puesto, aislamiento por tenant (RLS) y el flujo con Temporal cuando hay servidor de pruebas.
- Eval: `aprendizaje-001` en `evals:smoke`: una edición de tono produce una lección de memoria acotada, sin datos personales, y el evaluador sabe fallar con sus contraejemplos. La certificación de Cobros y Conciliación no baja: sus casos siguen en verde y forman parte de la puerta.
- Auditoría y contador: cada operación comprueba su entrada en el libro, la cadena verificada y el contador sumado.
- Secretos: la prueba recorre señal, lección, versión y libro y comprueba que el secreto del conector y los datos personales sembrados no aparecen en ninguna fila.

## Fuera de alcance

- Editar el borrador desde el correo o el panel: la aprobación por correo solo aprueba o rechaza ([su especificación](aprobacion-por-correo-v0.md), pregunta abierta); aquí se entrega la escritura de la edición, que el panel llamará.
- Promoción automática por nivel (N2 para memoria y ejemplos), evaluación en sombra contra las 50 últimas tareas, habilidades, parámetros en rango, ejemplos como casos, la rutina nocturna por agente y la vigilancia de deriva: rebanadas siguientes del bucle.
- Redacción de lecciones por modelo, embeddings de la memoria viva y el expediente en el panel.
- ADR-017, ADR-018 y ADR-019, en Propuesto.

## Decisiones que el plan no fija

1. **Cuatro paquetes.** `learning` es el dueño; `worker` aloja el flujo durable, `ledger` es el único que escribe decisiones y `evals` los casos dorados. Partirlo en dos rebanadas dejaría la revisión del viernes sin la cadena completa.
2. **La edición existe en el modelo pero nadie la escribía.** `registrarDecision` ignoraba la edición y el flujo de la tarea no la leía. Se guarda `{antes, despues}` en `edicion_previa`: cumple el comentario de la columna («lo que había antes») y conserva lo editado sin tocar la aprobación, que es inmutable. El flujo de la tarea relee la decisión de la base cuando el sentido es `editada`, porque la carga de la señal de Temporal no trae la edición y no hace falta ampliarla.
3. **Sin migración: el estado se deriva.** `leccion` y `promocion` son inmutables por disparador, así que `leccion.estado` queda en `propuesta` y `promocion.revertida_en` en nulo. Promocionada es «tiene promoción»; revertida es «su versión ya no está en el linaje activo», y la reversión queda en el libro. Si el panel necesita filtrar por estado, será una vista o una proyección, no un `UPDATE`.
4. **Revertir mueve el puntero, no crea versión.** El plan dice «volver a cualquier versión anterior en un clic»; `puesto.version_activa_id` es mutable y su comentario dice que cambiarlo deja rastro en auditoría. Crear una versión copia duplicaría números sin información nueva.
5. **Memoria viva y memoria congelada.** El prompt se compone con `version_puesto.memoria_congelada`, que es inmutable y reproduce exactamente lo que vio cada tarea. La promoción escribe además una fila en `memoria` con ámbito `puesto` para la búsqueda futura; la reversión la caduca (`caduca_en`), porque `memoria` es mutable.
6. **Promoción manual siempre en v0.** El plan promociona memoria sola con aviso (N2); en v0 toda promoción la hace una persona y la clase `aprender` queda en N1, como pide finanzas.md para el periodo de prueba. Jesús lo confirmó el 2026-09-24: sigue manual hasta que exista la evaluación en sombra.
7. **Lección determinista y señal de tipo `correccion`.** La lección se redacta con una plantilla sobre la diferencia por rutas, sin modelo: coste cero y reproducible en la CI. El enum `tipo_senal` no tiene `edicion` y añadirlo sería una migración: se usa `correccion` con origen `aprobacion.editada`.
8. **Datos personales.** Un detector propio y mínimo en `learning` sustituye correos, teléfonos, IBAN, DNI/NIE/CIF y tarjetas por «[dato personal]» antes de escribir la lección. El servicio `services/pii` lo sustituirá; la regla «nunca entrena con datos personales» no espera a él.
9. **Bandera.** `AIW_APRENDIZAJE_V0=1` enciende el arranque del flujo desde la tarea y el CLI. La memoria congelada entra en el prompt siempre: es contenido de la versión, no una funcionalidad.

## Demo reproducible

```bash
pnpm dev:up    # solo hace falta PostgreSQL; la demo aplica las migraciones
AIW_APRENDIZAJE_V0=1 pnpm --filter @aiw/worker demo:aprendizaje          # espera a que promociones tú
AIW_APRENDIZAJE_V0=1 pnpm --filter @aiw/worker demo:aprendizaje --auto   # promociona sola, para grabar
```

Los mandatos no leen `.env`: carga las variables en la terminal como explica el [runbook](../runbooks/aprendizaje-v0.md#preparar-la-terminal), también en PowerShell. Sin `--auto`, la demo imprime el mandato `aprendizaje promocionar …` y espera a que lo ejecutes en otra terminal: la promoción la hace una persona. Siembra Finanzas, crea una tarea de Cobros con una aprobación de nota, registra la edición de Jesús («Le recordamos que su factura…» → «Te escribo para recordarte que tu factura…»), ejecuta el flujo de aprendizaje, imprime la lección, la promociona con la persona supervisora, arranca la tarea siguiente con la versión 2 y enseña la lección en su prompt, revierte a la versión 1 y enseña que desaparece, y termina con la cadena de auditoría verificada y el contador.

La demo llama a las dos actividades del flujo `aprendizajeDeSenal` en su orden, sin servidor de Temporal. El flujo durable, arrancado desde la tarea como hijo, se prueba contra Temporal en `apps/worker/src/pruebas/aprendizaje.test.ts` y se ve con `demo:cobros` y `decidir <id> editada --texto "…"` con la bandera encendida.

## Presupuesto de tokens

Presupuesto: 45 €. Referencia: «Sala v0» trabajó con 40 € y tocaba tres paquetes sin migración; esta toca cuatro, con una parte pequeña en dos de ellos. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

Resuelta por Jesús el 2026-09-24: la promoción de lecciones de memoria sigue manual (N1) hasta que exista la evaluación en sombra contra las 50 últimas tareas. La promoción N2 con aviso no entra en la rebanada siguiente del bucle: depende de la evaluación en sombra.

El índice único `(tenant_id, leccion_id)` en `promocion`, que el Revisor propuso como red de seguridad en la base, entra como migración en una rebanada propia antes de la revisión del viernes 2 de octubre.
