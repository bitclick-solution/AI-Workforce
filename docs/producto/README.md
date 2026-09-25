VIGENTE

# Definición de producto · fichas y experiencia objetivo

Rebanada [Documento de producto](https://app.notion.com/p/3e053066189881909a8cccb263eec2b7) · Ciclo 0 · Tipo Producto · Paquete docs · P0. Especificación: [`docs/specs/fichas-de-producto.md`](../specs/fichas-de-producto.md).

Estas páginas convierten el [plan de construcción v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn) (secciones _El producto que hay que construir_, _Autonomía y autoaprendizaje_, _Departamentos y sala común_, _Ciclo de vida sin código_ y _Conocimiento, indicadores y auditoría_) en la definición que la fase 1 carga como datos: departamentos, puestos, políticas, indicadores y disparadores ([ADR-006](../adr/ADR-006.md)). Lo que aquí es una tabla, en el producto es una fila de `departamento`, `puesto`, `version_puesto`, `autorizacion_herramientas`, `indicador` o `disparador` del [modelo de datos v1](../datos/modelo-de-datos-v1.md). Ningún valor de estas fichas se escribe en código.

## Páginas

| Página                                                        | Qué define                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [Finanzas](finanzas.md)                                       | Reclamación de cobros, conciliación bancaria y previsión de tesorería. Es el departamento de la fase 1.                  |
| [Ventas y atención](ventas-y-atencion.md)                     | Atención de leads, presupuestos y seguimiento, y atención al cliente. Fase 2.                                            |
| [Administración](administracion.md)                           | Facturas recibidas, calendario de obligaciones y notificaciones administrativas. Fase 2.                                 |
| [Director de IA](director-de-ia.md)                           | El agente de plataforma que propone puestos, conexiones, guardrails y cambios de ciclo de vida.                          |
| [Experiencia de diez minutos](experiencia-de-diez-minutos.md) | Del primer clic a la primera tarea aprobada, paso a paso y con reloj. Es el requisito de producto que mide cada release. |
| [Guion de prueba del prototipo](prototipo-guion-de-prueba.md) | Las tres tareas, las preguntas y lo que se mide en las cinco sesiones con gerentes sobre el prototipo navegable.         |

Cada ficha tiene las mismas secciones y en el mismo orden: misión, puestos, herramientas mínimas, guardrails por clase de riesgo, niveles iniciales N0 a N3, indicadores y coste estimado. Las cuatro comparten el vocabulario de esta página.

## Clases de acción

El plan y el [ADR-005](../adr/ADR-005.md) fijan el nivel de autonomía **por agente y por clase de acción**. Las siete clases:

| Clase de acción        | Qué cubre                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Leer                   | Consultar registros en vivo por MCP y el índice de conocimiento.                                                     |
| Redactar               | Producir un borrador que no sale de la plataforma: respuesta, informe, propuesta, asiento.                           |
| Escribir en un sistema | Crear o modificar registros en el ERP, el CRM o el correo de la organización.                                        |
| Comunicar con terceros | Enviar un mensaje a alguien de fuera de la organización por correo o WhatsApp.                                       |
| Gastar                 | Comprometer dinero: pagos, abonos, descuentos, compras.                                                              |
| Delegar                | Encargar trabajo a otro agente con contrato de encargo, plazo, presupuesto y formato ([ADR-004](../adr/ADR-004.md)). |
| Aprender               | Proponer lecciones a partir de señales: memoria, habilidades, parámetros de política en rango y ejemplos (ADR-005).  |

## Clases de riesgo

La clase de riesgo se asigna a cada **acción concreta** (herramienta más parámetros), no al puesto: enviar un recordatorio con plantilla y proponer un aplazamiento son las dos «comunicar con terceros», pero no tienen el mismo riesgo. La clase decide la plantilla de guardrails y el nivel inicial. Los cuatro valores son los de `packages/domain`: `bajo`, `medio`, `alto` y `critico`.

| Clase de riesgo | Qué agrupa                                                                                                                                                                                                                                                             | Nivel inicial           | Techo en la primera versión                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| Bajo            | Acciones reversibles, internas, sin terceros ni dinero: leer, redactar, resumir en la sala, delegar dentro del departamento.                                                                                                                                           | N2                      | N2. N3 tras 90 días en N2 sin reversiones; fuera del lanzamiento.                  |
| Medio           | Escrituras internas con reversión (notas, etiquetas, estados, tareas, borradores en el ERP) y comunicaciones con plantilla aprobada y sin compromiso; delegar a otro departamento bajo la política de cruce.                                                           | N1                      | N2 con ejecución diferida: la acción espera la ventana de deshacer antes de salir. |
| Alto            | Comunicaciones con contenido libre o con compromiso (plazos, descuentos, condiciones); escrituras contables o fiscales; gastar por debajo del umbral del puesto; relajar un guardrail.                                                                                 | N0 o N1, según la ficha | N1. Nunca sale sin aprobación.                                                     |
| Crítico         | Dinero que sale (pagos, transferencias, remesas, reembolsos), cambios de datos bancarios de un tercero, borrados, presentaciones ante la AEAT o la Seguridad Social, categorías especiales de datos y cualquier decisión con efecto jurídico sobre una persona física. | N0                      | N0. El agente prepara; una persona ejecuta. Varias acciones no se ofrecen.         |

Las acciones de riesgo bajo (leer, redactar, delegar dentro del departamento) arrancan en N2 porque no producen efectos fuera de la plataforma: su aviso es la entrada del libro de auditoría y no hay nada que deshacer. Exigir aprobación para cada lectura haría imposible responder en la sala durante el periodo de prueba, que es el paso 4 de la experiencia objetivo del plan. Lo que sí pasa por la lista blanca, los ámbitos de datos y la guardia de salida es todo lo que se lee.

**Importante:** Ninguna acción de las tres fichas de departamento entra en las clases de alto riesgo del anexo III del Reglamento de IA (empleo, solvencia de personas físicas, servicios esenciales). Si un cliente pide una, no pasa de N1 y exige el pack de alto riesgo (ADR-005); el Director de IA rechaza la propuesta y explica por qué. Los clientes y proveedores que son personas físicas (autónomos) no reciben valoraciones de solvencia de ningún puesto: el agente devuelve el estado de sus facturas y nada más.

## Niveles de autonomía

Los del ADR-005, tal como los aplican las fichas.

| Nivel                 | Comportamiento                                                      | Cómo se alcanza                                                                                                        |
| --------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| N0 Manual             | El agente propone; una persona ejecuta.                             | Nivel inicial de las acciones de riesgo alto o crítico y de las clases sin historial.                                  |
| N1 Supervisado        | El agente ejecuta tras aprobación.                                  | Nivel inicial del periodo de prueba para escrituras y comunicaciones.                                                  |
| N2 Autónomo con aviso | El agente ejecuta y avisa; la persona deshace dentro de la ventana. | Al menos 30 acciones de la clase, un 95 % aprobadas sin cambios, 30 días sin incidentes y confirmación de una persona. |
| N3 Autónomo           | El agente ejecuta; revisión periódica por muestreo.                 | 90 días en N2 sin reversiones y solo riesgo bajo. Fuera del lanzamiento.                                               |

La bajada de nivel por incidente es automática y deja el diagnóstico en la sala del departamento. Cada ascenso lo confirma una persona y queda en el libro de auditoría con la evidencia del expediente. Por fases: en la fase 1 el techo de toda clase con efecto externo es N1; la fase 2 abre N2 para riesgo bajo con ventana de deshacer; la fase 3 propone por evidencia los ascensos a N2 del resto de clases que las fichas marcan como «N1 → N2».

## Plantilla de guardrails

Las cinco capas del plan aplican a todos los puestos. Cada ficha solo añade los parámetros propios del departamento.

| Capa                | Qué comprueba en toda ficha                                                                                                                              | Quién la ajusta                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Política del puesto | Lista blanca de herramientas, nivel por clase de acción, presupuesto en tareas, horario, clientes o cuentas vetadas.                                     | Persona; el Director de IA propone dentro de rangos. |
| Guardia de entrada  | Inyección de instrucciones en correos, documentos y resultados de herramientas; datos personales de categorías especiales; peticiones fuera del alcance. | Plataforma; se afina con los incidentes.             |
| Guardia de salida   | Brand voice, hechos contrastados con los datos consultados y citados, datos personales que no deben salir, aviso de IA en todo canal externo.            | Plataforma más lecciones del agente.                 |
| Guardia de acción   | Importe máximo, número de destinatarios, ventana de deshacer, límite de llamadas por tarea, radio de impacto.                                            | Persona; el agente propone rangos.                   |
| Evaluación continua | Casos dorados por puesto, regresión tras cada lección aplicada, muestreo de tareas N2.                                                                   | Plataforma; bloquea promociones.                     |

Reglas que ninguna ficha relaja: las credenciales nunca entran en el contexto del modelo (gateway MCP); toda acción emite entrada en el libro de auditoría y suma al contador ([ADR-003](../adr/ADR-003.md)); el aviso de IA en canales externos no se desactiva por debajo del nivel de organización; el aprendizaje no cambia el modelo base ni entrena con datos personales; una tarea que no puede seguir se convierte en «necesita a una persona» con contexto en la sala del departamento, nunca falla en silencio.

## Indicadores de operación

Los ocho indicadores de operación de los agentes son los mismos en los tres departamentos ([ADR-010](../adr/ADR-010.md)). Cada ficha solo fija sus umbrales.

| Indicador                                | Definición                                                                                               | Fuente                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------- |
| Tareas completadas, escaladas y fallidas | Recuento mensual por puesto y por origen de la tarea.                                                    | Libro de auditoría     |
| Coste por tarea                          | Coste de modelos y herramientas dividido entre las tareas del periodo, intervenciones en sala incluidas. | Libro de auditoría     |
| Tasa de aprobación sin cambios           | Aprobaciones sin editar el borrador entre todas las aprobaciones, por clase de acción y semana.          | Aprobaciones           |
| Nivel medio por clase de acción          | Nivel vigente de cada clase, ponderado por acciones ejecutadas.                                          | Versiones de puesto    |
| Incidentes                               | Bajadas de nivel, reversiones de N2 y acciones rechazadas por política.                                  | Libro de auditoría     |
| Horas liberadas                          | Horas al mes por tarea tipo, valoradas con el coste hora que configura la organización.                  | Fichas y tareas        |
| Lecciones promocionadas y revertidas     | Recuento por puesto y versión.                                                                           | Expediente del agente  |
| Resultado de negocio atribuido           | Euros cobrados, respuestas en plazo o presupuestos aceptados tras una acción del agente.                 | Conectores y auditoría |

## Cómo se estima el coste

Las cifras de coste de las fichas usan la misma organización de referencia y la misma escalera de precios. Ambas son hipótesis: la escalera se revisa el 2026-11-20 ([ADR-011](../adr/ADR-011.md)) y las tareas por puesto se miden con los socios de diseño en la fase 1.

- **Organización de referencia:** pyme de comercio B2B o distribución con 40 empleados y Odoo o Factusol. Emite 250 facturas al mes a 120 clientes activos, recibe 180 facturas de proveedor, mueve 900 apuntes bancarios en dos cuentas, recibe 150 contactos comerciales nuevos, emite 80 presupuestos, atiende 600 conversaciones de clientes por correo y WhatsApp, y presenta los impuestos a través de una asesoría externa.
- **Unidad:** la tarea (ADR-003). Cada ficha dice cómo cuenta las tareas de cada puesto. Las intervenciones en la sala y las delegaciones cuentan dentro de su tarea raíz; el moderador y el Director de IA tienen presupuesto propio y el contador los muestra aparte, sin descontar del cupo del cliente (decisión de Jesús, 2026-09-20).
- **Precio de referencia:** plan Departamento, 149 € al mes con 3 puestos y 1.500 tareas incluidas; paquete de 1.000 tareas por 49 €. Un puesto cuesta al cliente unos 50 € al mes dentro del plan; una tarea fuera del cupo, 0,049 €.
- **Coste de modelos:** objetivo de 0,025 € por tarea como máximo, intervenciones en sala incluidas (salida de la fase 2). Es el coste de Bitclick, no un precio.
- **Horas liberadas:** se expresan en horas al mes de la organización de referencia. El panel las valora con el coste hora que configura cada organización; las fichas no fijan salarios.

## Qué sigue

- El Diseñador prototipa la contratación, la sala y la aprobación móvil sobre la [experiencia de diez minutos](experiencia-de-diez-minutos.md) y la prueba con cinco personas antes de escribir el panel.
- La fase 1 carga la ficha de [finanzas](finanzas.md) como plantilla de departamento y sus tareas tipo como primeros casos dorados en `packages/evals`.
- Cada lección de los socios de diseño que cambie una ficha se aplica aquí en su propia rebanada; la versión que manda es la de `main`.
