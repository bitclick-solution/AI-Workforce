VIGENTE

# Capturas del prototipo de interfaz

Capturas de `/prototipo` generadas con Playwright sobre el commit de la rebanada [Prototipo de interfaz](https://app.notion.com/p/3e053066189881ac9dbfec49e8abf870). Sirven para el PR y para las sesiones de prueba; no son documentación de producto y quedan obsoletas en cuanto cambien las pantallas. La fuente de verdad es el prototipo, que se abre con `pnpm --filter @aiw/web dev`.

Todos los datos que aparecen son de ejemplo.

| Archivo                                | Qué enseña                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `1-contratacion.png`                   | La propuesta completa: ficha, herramientas, límites, niveles y coste.         |
| `1b-contratacion-necesita-persona.png` | Lo que contesta el Director a una petición de riesgo crítico.                 |
| `2-sala.png`                           | La intervención del agente de cobros con su coste, su nivel y el motivo.      |
| `2b-sala-error.png`                    | La sala cuando el ERP no responde: dice el motivo y no inventa un número.     |
| `3-aprobacion-movil.png`               | La petición de escritura a 390 px, con el resumen legible y las tres salidas. |
| `3b-aprobacion-editando.png`           | Editar el borrador antes de aprobar.                                          |
| `4-resumen-tiempo.png`                 | El tiempo del primer clic a la primera tarea aprobada.                        |

## Detalle de la tarea en el panel

Capturas de `/panel/inicio/tarea/:id` generadas por `e2e/detalle-tarea.spec.ts` sobre la rebanada [Detalle de la tarea en el panel](https://app.notion.com/p/3ed530661898818382e3fc5609085e2f). La API se simula en la prueba y todos los datos son de prueba (la organización, la factura y el importe no existen). Se regeneran con `pnpm e2e e2e/detalle-tarea.spec.ts`.

| Archivo                                | Qué enseña                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `detalle-1-recien-encargada.png`       | La tarea recién encargada desde el Inicio: solo el arranque.                     |
| `detalle-2-aprobacion-pendiente.png`   | Los pasos que llegan y el resumen de lo que va a escribir, con Aprobar/Rechazar. |
| `detalle-3-aprobada.png`               | Tras aprobar desde el detalle: la decisión aparece como paso.                    |
| `detalle-4-movil.png`                  | El mismo detalle a 390 px.                                                       |
| `detalle-5-necesita-a-una-persona.png` | Aprobación pedida a otra persona: se ve el resumen, sin botones.                 |
| `detalle-6-vacio.png`                  | Estado vacío: el agente aún no ha dado ningún paso.                              |
| `detalle-8-delegadas.png`              | Tareas delegadas dentro de la tarea raíz, con coste total.                       |
| `detalle-7-error.png`                  | Estado de error: el detalle no carga, con Reintentar.                            |

## Expediente por agente en el panel

Capturas de `/panel/inicio/agente/:id/expediente` generadas por `e2e/expediente.spec.ts` sobre la rebanada [Expediente por agente con niveles N0 y N1 en el panel](https://app.notion.com/p/3eb530661898817396f3f3be04edd538). La API se simula en la prueba y todos los datos son de prueba. Se regeneran con `pnpm e2e e2e/expediente.spec.ts`. Las capturas del detalle de la tarea se regeneraron en la misma rebanada porque su cabecera enlaza ahora al expediente.

| Archivo                       | Qué enseña                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `expediente-1-escritorio.png` | Niveles por clase con su historial, los cuatro criterios de ascenso, una clase fija, lecciones y una acción rechazada con su porqué. |
| `expediente-2-movil.png`      | El mismo expediente a 390 px, sin desbordar.                                                                                         |
| `expediente-3-vacio.png`      | Estado vacío: sin lecciones ni acciones rechazadas.                                                                                  |
| `expediente-4-error.png`      | Estado de error: no carga, dice que no se ha perdido nada y deja reintentar.                                                         |
