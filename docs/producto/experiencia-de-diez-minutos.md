VIGENTE

# Experiencia objetivo · del primer clic a la primera tarea aprobada en diez minutos

- Rebanada: [Documento de producto](https://app.notion.com/p/3e053066189881909a8cccb263eec2b7) · Ciclo 0 · Tipo Producto · Paquete docs · P0
- Plan de referencia: _La experiencia objetivo_, _Principios no negociables_, _Cómo funciona la sala_, _Tres formas de hacer la misma operación_, _Contratar desde una frase_, _Conectar sistemas sin código_ y _Camino al mercado_ (fase 1: «panel v1 con onboarding de diez minutos») del [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn); [ADR-003](../adr/ADR-003.md), [ADR-004](../adr/ADR-004.md), [ADR-005](../adr/ADR-005.md) y [ADR-006](../adr/ADR-006.md).
- Fichas que intervienen: [finanzas](finanzas.md) y [Director de IA](director-de-ia.md). Vocabulario y organización de referencia: [README](README.md).

Dos números son requisitos de producto y se miden en cada release: del primer clic a la primera tarea aprobada, menos de diez minutos; de la primera aprobación al primer ascenso de autonomía, menos de 30 días con evidencia. Esta página describe el primero paso a paso y deja el segundo enunciado al final.

## Requisitos previos

- Eres el gerente o el administrador de la organización de referencia del README y tienes el móvil a mano.
- Tienes una cuenta con permisos de administración en Odoo o en Factusol, y acceso al buzón de correo desde el que se reclaman los cobros.
- No necesitas a nadie de Bitclick, ni una llamada de alta, ni conocer el producto. El Director de IA guía cada paso y nunca te deja sin siguiente paso.

Lo que no hace falta en estos diez minutos: el banco, WhatsApp, documentos de la empresa ni tres correos de ejemplo. El Director los pide después, cuando ya tienes un agente trabajando.

## Los diez minutos, paso a paso

Cada paso dice qué ves, qué hace la plataforma y qué queda en el libro de auditoría y en el contador. Los tiempos son objetivos por paso para la mediana de organizaciones; el percentil 90 admite cinco minutos más en total.

1. **Minuto 0:00 a 1:00 · Da de alta la organización.** Entra con tu correo de empresa (enlace mágico) o con Google o Microsoft, escribe el nombre de la empresa y su web, y elige la región de datos (Europa por defecto).
   - Ves: una sola pantalla con tres campos y la prueba de 14 días activada, sin tarjeta hasta que termine.
   - La plataforma: crea la organización como dato, te hace propietario, arranca el Director de IA y lanza en segundo plano la lectura de la web para proponer la brand voice general.
   - Registro: entrada de auditoría «organización creada» con actor, plan de prueba y región. Contador: 0 de 1.500.

2. **Minuto 1:00 a 2:30 · Elige el equipo.** En **Equipo**, elige **Finanzas**. Ves los tres puestos con su ficha resumida: qué hace, qué necesita, con quién colabora y cuánto cuesta al mes. Pulsa **Contratar los tres** o quita el que no quieras.
   - Ves: tres tarjetas de puesto (Reclamación de cobros, Conciliación bancaria, Previsión de tesorería) con el coste de referencia de unos 50 € al mes cada una y el nivel inicial por clase de acción, y un botón de confirmación con la vista previa de efectos: departamento, tres puestos en periodo de prueba, tú como supervisor humano.
   - La plataforma: el Director crea una propuesta de operación «crear departamento» y tres «contratar» desde plantilla (N1), simula sus efectos en el motor de políticas y te las presenta juntas. Al confirmar, se ejecutan como flujos idempotentes; los puestos quedan en estado propuesto hasta que tengan conexión.
   - Registro: cuatro entradas «propuesta de operación aprobada y ejecutada» con la versión de puesto creada. Contador: sin cambios; contratar no consume tareas.

3. **Minuto 2:30 a 5:00 · Conecta los sistemas.** El Director lista lo que cada puesto necesita y lo que falta: el ERP y el correo son obligatorios; el banco y WhatsApp, opcionales. Pulsa **Conectar** en el ERP y autoriza en dos clics; repite con el correo.
   - Ves: para cada conexión, los permisos exactos que pide cada puesto («Reclamación de cobros lee facturas, clientes y cobros y anota el seguimiento; no crea, no anula ni borra facturas») y el resultado de la prueba de conexión con las herramientas descubiertas. El banco y WhatsApp se pueden saltar con **Más tarde**.
   - La plataforma: el Director lanza la autorización a tu cuenta (OAuth por Nango para el correo; credenciales del ERP en el gateway MCP), limita los permisos al puesto, prueba la conexión y registra la lista blanca por puesto y nivel. Las credenciales quedan cifradas por tenant y no entran en ningún prompt. Los puestos pasan a en prueba.
   - Registro: una entrada por conexión con la persona que autorizó, el alcance y las herramientas registradas; una por cambio de estado de puesto. Contador: sin cambios.
   - Si el ERP no responde o la cuenta no tiene permisos, la conexión queda en error con el motivo, el Director te propone el siguiente intento y el resto de la experiencia sigue con el correo: nunca falla en silencio.

4. **Minuto 5:00 a 6:00 · Conoce al equipo.** Entra en la sala de finanzas. Los tres agentes se presentan: ficha, límites, nivel de autonomía inicial y tú como supervisor. La brand voice propuesta desde la web aparece para que la aceptes o la edites en una línea.
   - Ves: tres mensajes de presentación cortos, plegados por defecto, y una tarjeta con la brand voice propuesta. Reclamación de cobros muestra además su simulación en sombra: cómo habría actuado con tres facturas vencidas reales del ERP, sin enviar nada.
   - La plataforma: cada puesto arranca su periodo de prueba de 30 días con las clases de efecto externo en N1; la simulación corre en el sandbox y no consume tareas del cupo.
   - Registro: entradas de presentación y de simulación en sombra, marcadas como sombra. Contador: sin cambios.

5. **Minuto 6:00 a 7:30 · Pregunta en la sala.** En la sala general, escribe «¿cómo vamos de cobros este mes?».
   - Ves: el moderador da la palabra a Reclamación de cobros, que responde con datos del ERP citados (facturas vencidas, importe, antigüedad) y propone tres acciones con su coste en tareas y su nivel: recordar las facturas vencidas de menos de 30 días con plantilla (N1, 12 tareas), escalar dos clientes con más de 60 días (N1, 2 tareas) y preparar la lista de dudosos (N2, 1 tarea). Cada acción tiene un botón **Aprobar**.
   - La plataforma: el mensaje crea un evento; el moderador clasifica, elige un agente y limita la intervención a una; la intervención es una tarea ligera con su flujo; la respuesta pasa la guardia de salida (citas, agregados en la sala general) y cada acción propuesta es una aprobación pendiente en tu bandeja.
   - Registro: la intervención, con la clasificación del moderador y su motivo, y tres aprobaciones sin decisión. Contador: 1 de 1.500, la intervención.

6. **Minuto 7:30 a 9:00 · Aprueba desde el móvil.** Abre el enlace firmado que te llega por correo (o por WhatsApp si lo conectaste), lee el resumen y pulsa **Aprobar** en la primera acción: recordar las facturas vencidas de menos de 30 días.
   - Ves: una página ligera sin login con el resumen legible (a quién, cuántos mensajes, con qué plantilla, por qué), el borrador de un recordatorio de ejemplo y dos botones: **Aprobar** y **Editar**. Al aprobar, el estado cambia a «en curso» y vuelve a la sala.
   - La plataforma: la aprobación es una señal al flujo de la tarea; el bucle del agente ejecuta los envíos por el gateway con la lista blanca del puesto, anota el seguimiento en cada factura del ERP y devuelve el resultado a la sala. Cada envío pasa la guardia de acción (un destinatario, horario laboral, aviso de IA). Si algún envío falla, la tarea queda parcial y la sala lo dice con el motivo.
   - Registro: la decisión de aprobación con tu identidad, fecha y si editaste el borrador; una entrada por envío y por anotación, con herramienta, datos referenciados, coste y versión del puesto. Contador: 2 de 1.500 y una señal de aprendizaje para el agente.

7. **Minuto 9:00 a 10:00 · Comprueba y decide qué sigue.** Vuelve al panel. En **Registro**, ves la tarea aprobada con su «por qué lo hice»; en **Contador**, 2 de 1.500 con el coste de la sala aparte. El Director te propone tres pasos siguientes, sin obligarte a ninguno.
   - Ves: la entrada de auditoría legible (quién, qué, con qué herramienta, cuántos euros reclamados, cuánto costó), el contador, y una tarjeta del Director con: conectar el banco para la conciliación, pegar tres correos de ejemplo para afinar la brand voice de la rama, e invitar a la persona que aprobará cuando tú no estés.
   - La plataforma: la primera tarea aprobada queda marcada como el hito de los diez minutos, con el tiempo desde el primer clic.
   - Registro: la propuesta del Director con sus tres pasos. Contador: sin cambios.

## Qué se mide en cada release

| Medida                                                     | Objetivo                                                        | Cómo se calcula                                                                                           |
| ---------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Del primer clic a la primera tarea aprobada                | Mediana por debajo de 10 minutos; percentil 90 por debajo de 15 | Desde la entrada «organización creada» hasta la primera decisión de aprobación, en el libro de auditoría. |
| Organizaciones que completan los siete pasos en una sesión | Al menos el 80 %                                                | Sesiones con la primera aprobación sin cerrar la sesión entre todas las altas.                            |
| Abandono por paso                                          | Ningún paso por encima del 10 %                                 | Última entrada de auditoría de cada alta sin primera aprobación, agrupada por paso.                       |
| Conexiones completadas en el alta                          | ERP y correo en el 80 % de las altas                            | Conectores activos al terminar el paso 3.                                                                 |
| De la primera aprobación al primer ascenso                 | Mediana por debajo de 30 días                                   | Desde la primera decisión hasta el primer cambio de nivel a N2 con evidencia.                             |

Las medidas salen del libro de auditoría, sin telemetría aparte. El Diseñador prueba este recorrido con cinco personas sobre el prototipo antes de escribir el panel, y cada socio de diseño lo recorre en su primera sesión con el tiempo cronometrado.

## Qué pasa después de los diez minutos

- **Días 1 a 30, periodo de prueba.** Todo lo que sale de la plataforma pasa por tu aprobación. Cada aprobación, rechazo o edición enseña al agente: tono, clientes que no se tocan, cuándo escalar. La bandeja agrupa las aprobaciones y el móvil resuelve la mayoría en diez segundos.
- **Día 30, primer ascenso.** El agente propone qué acciones pueden pasar a N2 con la evidencia de su expediente: al menos 30 acciones de la clase, un 95 % aprobadas sin cambios y 30 días sin incidentes. Tú confirmas; la exención se revoca en un clic y la ventana de deshacer sigue vigente.
- **Cuando haga falta un puesto más.** El Director detecta que preguntas cada semana por la previsión sin tener el puesto activo y propone contratarlo con ficha, conexiones y guardrails preparados. Un clic y arranca en periodo de prueba.

## Qué no está en los diez minutos

- Ventas y atención y Administración: llegan en la fase 2, con el mismo recorrido y sus propias fichas.
- El conector bancario directo, la ingesta de documentos de la empresa y el manual completo: el Director los propone en los pasos siguientes.
- Cualquier acción de riesgo crítico: en los diez minutos no sale dinero, no se borra nada y no se comunica con clientes vetados. La primera tarea aprobada es un recordatorio con plantilla.
- El nivel N2: ningún agente asciende antes de los 30 días de evidencia. La experiencia demuestra control, no autonomía.
