VIGENTE

# Guion de prueba del prototipo · cinco sesiones con gerentes

- Rebanada: [Prototipo de interfaz](https://app.notion.com/p/3e053066189881ac9dbfec49e8abf870) · Ciclo 0 · Tipo Diseño · Paquetes `ui`, `web` · P0. Especificación: [`docs/specs/prototipo-de-interfaz.md`](../specs/prototipo-de-interfaz.md).
- Qué se prueba: el prototipo navegable de `/prototipo` contra la [experiencia de diez minutos](experiencia-de-diez-minutos.md).
- Quién lo organiza: Jesús, con los [socios de diseño](https://app.notion.com/p/3e053066189881d49810c971ae820283). El Diseñador deja el guion; no convoca ni modera.
- Dónde se anotan los resultados: la plantilla «Lista de cambios decididos» de la página de la rebanada en Notion.

## Para qué sirven estas cinco sesiones

Para descubrir dónde se para la persona, no para que le guste el diseño. Cinco personas encuentran la mayoría de los problemas de uso de un recorrido de este tamaño; la sexta ya repite hallazgos. Lo que salga se convierte en cambios concretos antes de escribir el panel v1, que es la rebanada cara.

Tres preguntas se responden con estas sesiones y no con una reunión:

1. ¿Entiende un gerente qué está contratando, qué va a poder tocar el agente y qué no, antes de confirmar?
2. ¿Se fía de una respuesta de la sala? ¿Mira el «por qué lo hice» sin que se lo pidan?
3. ¿Aprueba desde el móvil sin releer tres veces? ¿Quiere editar el texto antes de aprobar, o le sobra?

## A quién se prueba

Cinco personas, una por sesión, con este perfil: gerente, administrador o responsable de administración de una pyme de 10 a 60 empleados que usa un ERP y persigue facturas. Ninguna ha visto el producto. Ninguna trabaja en Bitclick. Al menos dos, de socios de diseño ya firmados; al menos una, de una empresa que no es de distribución, para no probar cinco veces el mismo caso.

Criterio de exclusión: quien haya participado en la definición de las fichas de producto. Ya sabe las respuestas.

## Antes de cada sesión

- Arranca el prototipo: `pnpm --filter @aiw/web dev` y abre `http://localhost:3000/prototipo`.
- **Si vas a usar un teléfono de verdad**, ábrelo por la IP del ordenador en la misma red: `http://<IP-del-ordenador>:3000/prototipo`. El servidor de desarrollo ya autoriza las IP de red de la máquina que lo arranca. Si pasas por un túnel (ngrok, Tailscale), arráncalo con el host declarado: `AIW_DEV_ORIGENES=miTunel.ngrok-free.app pnpm --filter @aiw/web dev`.
- Comprueba antes de la sesión que **los botones responden** en el dispositivo con el que vas a probar. Si la página se ve bien pero ningún botón hace nada y solo funcionan los enlaces de la barra de arriba, el navegador no está recibiendo el JavaScript: revisa el origen desde el que lo abres.
- Comparte la pantalla o, mejor, deja que conduzca la persona desde su propio ordenador.
- Graba la sesión con permiso explícito y grabado. Sin permiso, no se graba y se toman notas.
- Cierra el prototipo por completo y vuelve a abrirlo entre una persona y otra: el recorrido se reinicia y el reloj vuelve a cero.
- Ten a mano el móvil o reduce la ventana a 390 px de ancho para la tercera tarea.

Qué decir al empezar, palabra por palabra:

> Esto es un prototipo, no un producto: los datos son inventados y nada de lo que hagas envía nada a nadie ni se guarda. No te estoy evaluando a ti, estoy evaluando esto. Si algo no se entiende, el fallo es nuestro y es justo lo que necesito saber. Piensa en voz alta mientras lo usas: dime qué esperas que pase antes de pulsar. Si te atascas, no te voy a ayudar enseguida; deja que se note.

## Las tres tareas

Se dan una a una, sin adelantar la siguiente. Enunciado de tarea, nunca de instrucción: se dice qué se quiere conseguir, no dónde pulsar.

### Tarea 1 · Contratar (objetivo: 3 minutos)

> Acabas de dar de alta tu empresa. Quieres que alguien te cuadre cada mañana los movimientos del banco con las facturas. Consíguelo.

Qué observar:

- ¿Escribe una frase propia o usa un ejemplo? ¿Qué palabras usa? Anótalas literales: son el vocabulario del producto.
- ¿Lee las herramientas y los límites antes de confirmar, o va directo al botón?
- Al ver los niveles N0 a N2: ¿pregunta qué significan? ¿Se los inventa bien o mal?
- ¿Menciona el precio sin que se lo preguntes?

Preguntas al terminar la tarea, no durante:

- Con tus palabras: ¿qué acabas de contratar y qué va a hacer mañana a las ocho?
- ¿Qué puede tocar de tu ERP? ¿Qué no puede tocar?
- ¿Qué pasaría si mañana quieres quitarlo?

Después, pídele que pruebe las otras dos frases de ejemplo (una que no existe, otra que pide mover dinero) y pregunta: ¿te parece bien esa respuesta? ¿Qué harías tú ahora?

### Tarea 2 · Preguntar en la sala (objetivo: 2 minutos)

> Es lunes por la mañana y quieres saber cómo va el cobro de facturas este mes.

Qué observar:

- ¿Abre el «por qué lo hice» sin que se lo pidan? Si no, ¿lo abre cuando se le pregunta si se fía?
- ¿Entiende que el coste está en tareas y no en euros? ¿Le importa?
- ¿Entiende que la respuesta la da un agente concreto y no «el sistema»?
- Ante las tres acciones propuestas: ¿cuál aprobaría primero? ¿Alguna le da miedo?

Preguntas:

- ¿Te fías de ese número? ¿Qué harías para comprobarlo?
- ¿Quién te ha contestado y por qué ese?
- Muéstrale los dos estados que fallan (el del banco y el de la disputa) y pregunta: ¿qué esperas que haya hecho el agente mientras tanto?

### Tarea 3 · Aprobar desde el móvil (objetivo: 90 segundos)

Se hace en el móvil o en una ventana estrecha. Se entrega el dispositivo ya en la pantalla, como si llegara una notificación.

> Te acaba de llegar esto al móvil mientras estás fuera de la oficina. Decide.

Qué observar:

- Cuánto tarda desde que mira la pantalla hasta que decide. Cronométralo.
- ¿Lee el «lo que no voy a hacer»? ¿Le tranquiliza o le alarma que haya que decirlo?
- ¿Toca «Editar el texto antes de aprobar»? Esta es la observación que más pesa: decide si la edición entra también en la aprobación por correo.
- ¿Busca algo que no está? ¿Qué?

Preguntas:

- ¿Qué se va a escribir exactamente y dónde?
- ¿Cambiarías el texto? ¿Por qué sí o por qué no?
- Si rechazas, ¿qué esperas que pase con esa factura?

## Qué se mide

| Medida                                              | Cómo                                                                      | Umbral que obliga a cambiar algo                      |
| --------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------- |
| Tiempo del primer clic a la primera tarea aprobada  | El cronómetro del propio prototipo, en la pantalla de resumen.            | Mediana por encima de 10 minutos.                     |
| Tareas completadas sin ayuda                        | Recuento por tarea, sobre cinco.                                          | Cualquier tarea que falle en dos personas o más.      |
| Veces que se pide ayuda o se pregunta «¿y ahora?»   | Recuento por pantalla.                                                    | Más de una por pantalla y persona.                    |
| Personas que abren el «por qué lo hice» sin pedirlo | Recuento, sobre cinco.                                                    | Menos de tres: el motivo está demasiado escondido.    |
| Personas que editan el borrador antes de aprobar    | Recuento, sobre cinco.                                                    | Informativo: decide si la edición entra en el correo. |
| Aciertos al explicar qué puede tocar el agente      | La respuesta a «¿qué no puede tocar?» se compara con la ficha del puesto. | Menos de cuatro de cinco.                             |
| Palabras propias del gerente                        | Transcripción literal de cómo llama a cada cosa.                          | Cualquier término del producto que nadie use.         |
| Momentos de desconfianza                            | Anotación literal de la frase y en qué pantalla.                          | Cualquiera que se repita en dos personas.             |

El tiempo se toma del prototipo y no del reloj del moderador: así se mide lo mismo que medirá el producto.

## Cómo se anota

Durante la sesión, solo hechos: qué hizo, qué dijo, dónde se paró, cuánto tardó. Nada de interpretaciones ni de soluciones; esas llegan después y con las cinco sesiones delante.

Al terminar las cinco, cada hallazgo se lleva a la tabla «Lista de cambios decididos» de la página de la rebanada en Notion con estas columnas:

| Columna    | Qué lleva                                                                 |
| ---------- | ------------------------------------------------------------------------- |
| Hallazgo   | Qué pasó, en una frase y sin interpretar.                                 |
| Pantalla   | Contratación, sala, aprobación o transversal.                             |
| Personas   | En cuántas de las cinco pasó.                                             |
| Gravedad   | Bloquea la tarea · Retrasa · Molesta · Comentario.                        |
| Decisión   | Se cambia · Se cambia más adelante · No se cambia, y por qué.             |
| Dónde vive | La rebanada que lo recoge, o la ficha de producto o el ADR que lo cambia. |

Regla: un hallazgo que aparece en tres de las cinco personas y bloquea una tarea se corrige antes de escribir el panel v1. Uno que aparece en una sola persona se anota y se deja correr; no se rediseña por una opinión.

## Lo que no se prueba aquí

- Si el producto se vende. Esto mide comprensión y confianza, no intención de compra. No se pregunta por el precio si la persona no lo saca.
- Si los números son correctos. Son datos de ejemplo y la persona lo sabe desde el primer minuto.
- El alta, las conexiones al ERP y al correo, y el ascenso de autonomía: no están en el prototipo. Si una persona los echa en falta, eso sí es un hallazgo.
