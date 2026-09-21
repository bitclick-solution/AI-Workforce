VIGENTE

# Especificación · Prototipo de interfaz: contratación, sala y aprobación móvil

- Rebanada: [Notion](https://app.notion.com/p/3e053066189881ac9dbfec49e8abf870) · Ciclo 0 (Fase 0 · Definir y validar) · Tipo Diseño · Paquetes `ui`, `web` · P0
- Rama: `rebanada/prototipo-de-interfaz`
- Plan de referencia: _La experiencia objetivo_, _Contratar desde una frase_, _Cómo funciona la sala_, _Tres formas de hacer la misma operación_ y _Camino al mercado_ (fase 1) del [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn); [ADR-001](../adr/ADR-001.md) (borrador de aprobación con carga opaca e interfaz de aprobación genérica), [ADR-003](../adr/ADR-003.md) (tarea y contador), [ADR-005](../adr/ADR-005.md) (niveles N0 a N3). Documentos de producto: [experiencia de diez minutos](../producto/experiencia-de-diez-minutos.md), [finanzas](../producto/finanzas.md), [Director de IA](../producto/director-de-ia.md), [README de producto](../producto/README.md). Estado actual de la página de decisión: [aprobación por correo v0](aprobacion-por-correo-v0.md).
- Zona crítica: no. No se toca `packages/domain`, `packages/ledger`, `packages/mcp-gateway`, `packages/db`, `apps/api`, `apps/worker`, `apps/channels`, `connectors` ni `.github/`.

## Objetivo

Jesús y cinco gerentes pueden recorrer, en un navegador y sin levantar ninguna infraestructura, los tres momentos que deciden si el producto se entiende: contratar un agente escribiendo una frase, preguntar en la sala y recibir una intervención con coste, nivel y motivo, y aprobar una escritura desde el móvil. El prototipo mide en pantalla el tiempo desde el primer clic hasta la primera tarea aprobada y lo enseña al terminar, que es el número que la [experiencia de diez minutos](../producto/experiencia-de-diez-minutos.md) convierte en requisito de producto. Cuando esta rebanada está hecha, el panel v1 se escribe contra pantallas ya probadas con personas en vez de contra una suposición.

## Paquetes tocados

- `packages/ui` (`@aiw/ui`): el sistema de componentes base. Tipados, accesibles y con internacionalización desde el primer componente. Ficheros nuevos: `i18n.tsx`, `boton.tsx`, `tarjeta.tsx`, `insignia.tsx`, `aviso.tsx`, `campo.tsx`, `porque.tsx`, `duracion.ts` y sus pruebas. `index.ts` los exporta; `cn.ts` y `estado.tsx` no se tocan.
- `apps/web` (`@aiw/web`): pantallas del prototipo bajo `app/prototipo/`, datos de ejemplo y máquina del recorrido en `lib/prototipo/`. No se tocan `app/panel/contador`, `app/api`, `app/page.tsx` ni `app/layout.tsx`.
- `e2e`: una prueba de humo que recorre los tres flujos.
- `docs/producto/prototipo-guion-de-prueba.md`: el guion de las cinco sesiones.

## Endpoints, flujos y datos

Ninguno. El prototipo no llama a ninguna API, ni a Temporal, ni al motor de políticas, ni al gateway MCP, ni a la base de datos. Todos los datos son constantes en `apps/web/lib/prototipo/datos.ts` y el estado del recorrido vive en memoria del navegador, en un contexto de React montado en `app/prototipo/layout.tsx`.

### Rutas

| Ruta                      | Qué es                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `/prototipo`              | Portada. El botón «Empezar» marca el primer clic y arranca el cronómetro.                    |
| `/prototipo/contratacion` | Contratar desde una frase: propuesta con ficha, herramientas, guardrails, nivel y coste.     |
| `/prototipo/sala`         | Sala general: una pregunta humana, una intervención elegida por el moderador.                |
| `/prototipo/aprobacion`   | Aprobación móvil: resumen legible, aprobar, rechazar y editar antes de aprobar.              |
| `/prototipo/resumen`      | Lo que ha pasado, el contador de tareas y el tiempo del primer clic a la primera aprobación. |

### Estado del recorrido

Una sola máquina, `lib/prototipo/recorrido.ts`, con los hitos `primerClic`, `agenteContratado`, `intervencionPedida` y `tareaAprobada`, cada uno con su marca de tiempo. El cronómetro es la diferencia entre `primerClic` y `tareaAprobada`; mientras no exista la segunda, el resumen dice qué falta. Recargar la página entera reinicia el recorrido a propósito: cada sesión de prueba empieza limpia.

### Datos de ejemplo

Un solo puesto contratable (Conciliación bancaria en Finanzas) con la ficha, las cuatro herramientas, los guardrails por clase de riesgo, el nivel inicial por clase de acción y el coste de referencia de la [ficha de finanzas](../producto/finanzas.md); un agente ya en plantilla (Reclamación de cobros) que interviene en la sala; y una petición de escritura pendiente (nota de seguimiento en la factura F-2026-0412). Ninguna cifra se inventa: todas salen de las fichas de producto.

## Decisiones que el plan no fija

1. **Primero el estado vacío, el de error y el de «necesita a una persona»; después el camino feliz.** Cada uno de los tres flujos tiene los cuatro estados alcanzables desde la interfaz, no escondidos tras una bandera de desarrollo. Un prototipo que solo enseña el camino feliz mide si la demo gusta, no si el producto se entiende: lo que hay que probar con los gerentes es justo qué hacen cuando el ERP no responde o cuando el agente dice que no puede seguir.
2. **La interfaz no decide nada: enseña decisiones ya tomadas.** El prototipo no clasifica la frase de contratación ni elige qué agente habla en la sala ni evalúa niveles; esas son del Director de IA, del moderador y del motor de políticas, y llegan en sus rebanadas. Aquí la frase se reconoce comparando contra una lista fija de ejemplos y todo lo demás es dato. Sin esta frontera, la lógica de negocio del producto acabaría escrita dos veces y la primera sería la de la interfaz.
3. **La internacionalización entra en el primer componente, no después.** Todo texto de pantalla vive en el diccionario de `packages/ui/src/i18n.tsx` o se pasa por props; ningún componente lleva una cadena en castellano incrustada. Retrofitar i18n sobre componentes ya escritos cuesta más que escribirlos así, y el producto se vende fuera de España en la fase 3.
4. **El móvil primero en la aprobación, y solo ahí.** La pantalla de aprobación se diseña a 390 px y crece hasta el escritorio; la contratación y la sala se diseñan a escritorio y se adaptan. La [experiencia de diez minutos](../producto/experiencia-de-diez-minutos.md) dice que la aprobación llega por un enlace que se abre en el móvil; las otras dos ocurren delante de un ordenador.
5. **«Editar antes de aprobar» se prototipa aunque la página del correo no lo tenga.** La pregunta abierta de [aprobación por correo v0](aprobacion-por-correo-v0.md) sigue sin respuesta y el ADR-005 llama a la edición «la señal más valiosa». El prototipo es el sitio barato para preguntárselo a cinco gerentes antes de decidirlo en código; la lista de cambios decididos recogerá lo que digan.
6. **El cronómetro se enseña siempre, no solo al final.** Una barra fija indica el tiempo transcurrido y el hito que falta. Medirlo a escondidas daría el número, pero no la señal que interesa: en qué paso la persona se para.
7. **Base sobria, no la paleta de BitclickLabs.** El único documento de marca del espacio de Notion es la [brand voice de BitclickLabs](https://app.notion.com/p/3c15306618988163843ef4179f14d837), escrita para vídeo: verde terminal, amarillo cíber, negro obsidiana y Space Grotesk. Esa paleta pertenece al canal, no a un panel donde un gerente aprueba escrituras en su ERP. De ella se toma el tono —«directo y sin humo», técnico pero accesible— y no el color. Los componentes llevan una base neutra con un solo acento y un único fichero de variables, para que adoptar el sistema definitivo sea cambiar ese fichero. Es la pregunta abierta de esta rebanada.
8. **Sin dependencias nuevas.** Ni biblioteca de componentes, ni de animación, ni de i18n. El prototipo tiene que compilar, pasar la CI y arrancar en la máquina de Jesús sin discutir antes qué framework de interfaz adopta la plataforma; esa decisión la toma la rebanada del panel v1 con lo aprendido aquí.

## Criterios de hecho

1. `pnpm --filter @aiw/web dev` sirve `/prototipo` y las cuatro pantallas se recorren con el teclado y con el ratón, sin errores en consola y sin ninguna llamada de red a la aplicación.
2. Cada uno de los tres flujos ofrece, desde la propia pantalla, su estado vacío, su estado de error y su estado de «necesita a una persona», además del camino feliz, y cada uno dice qué hacer a continuación.
3. La contratación desde la frase «contrata un agente de conciliación en Finanzas» produce una propuesta con ficha, herramientas, guardrails, nivel de autonomía por clase de acción y coste; un clic la confirma y el puesto queda en periodo de prueba.
4. La sala muestra la intervención del agente de cobros con su coste en tareas, su nivel y un «por qué lo hice» desplegable con las fuentes citadas; el moderador aparece nombrado como quien dio la palabra.
5. La aprobación móvil muestra el resumen legible y ofrece aprobar, rechazar y editar antes de aprobar; editar y luego aprobar deja constancia de que hubo edición, tal como el ADR-005 define la señal.
6. El prototipo mide el tiempo desde el primer clic hasta la primera tarea aprobada, lo enseña durante el recorrido y lo repite en el resumen final con el objetivo de diez minutos al lado.
7. Todos los componentes de `packages/ui` que añade esta rebanada están tipados, tienen prueba, no llevan texto incrustado y exponen el nombre accesible de cada control; la prueba comprueba las dos cosas.
8. `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build` y `pnpm e2e` pasan con `CI=1`. La prueba de humo de Playwright recorre los tres flujos hasta ver el tiempo medido.
9. El guion de las cinco sesiones está en `docs/producto/prototipo-guion-de-prueba.md` con tareas, preguntas, qué medir y cómo se anota, y la plantilla de «lista de cambios decididos» está en la página de la rebanada en Notion.
10. Las cinco sesiones con gerentes quedan pendientes: las organiza Jesús con los socios de diseño. En la lista de hecho del PR ese criterio se marca como pendiente con el guion enlazado.

## Casos de prueba y de eval

- **Unitario (`packages/ui`)**: el traductor devuelve la cadena del idioma pedido, cae al castellano con una clave ausente y sustituye los parámetros; `Boton` marca `aria-busy` y deshabilita mientras carga, y no pierde el nombre accesible cuando solo lleva icono; `Aviso` pinta el papel correcto (`status` para el vacío, `alert` para el error y el de «necesita a una persona`) y exige una acción siguiente; `Campo`asocia la etiqueta con el control y el mensaje de error con`aria-describedby`; `Insignia`no depende del color para comunicar el nivel;`Porque`colapsa y despliega con el control accesible correcto;`formatearDuracion` cubre el segundo, el minuto, la hora y el cero.
- **Unitario (`apps/web`)**: la máquina del recorrido sella cada hito una sola vez, calcula la duración solo cuando existe la primera aprobación, distingue aprobado de aprobado-con-edición, y el reconocedor de frases devuelve propuesta, no-reconocida o necesita-a-una-persona según el ejemplo.
- **Extremo a extremo (`e2e/prototipo.spec.ts`)**: un recorrido contrata el agente, pregunta en la sala, aprueba la nota de seguimiento y comprueba que el resumen enseña el tiempo medido; un segundo caso comprueba los tres estados no felices de cada flujo; un tercero recorre la aprobación en una ventana de 390 px de ancho.
- **Eval**: no aplica. La rebanada no añade ni cambia ningún comportamiento de agente; el prototipo enseña respuestas escritas a mano, marcadas como datos de ejemplo en la propia pantalla.
- **Auditoría y contador**: no aplica. El prototipo no ejecuta ninguna acción y por tanto no anota nada en el libro. Lo que sí hace es **enseñar** dónde aparecerían el contador y el «por qué lo hice», que es lo que se prueba con los gerentes; la pantalla lo dice.
- **Secretos**: el prototipo no tiene credenciales, ni variables de entorno, ni llamadas salientes. El job «Sin secretos en el repositorio» de la CI ya cubre los ficheros que añade.

## Fuera de alcance

- **El panel v1 de verdad** (contratación contra el Director de IA, sala contra `packages/rooms`, bandeja contra `packages/notifications`): rebanada del panel, que arranca con lo aprendido aquí.
- **Las cinco sesiones con gerentes**: las organiza Jesús con los socios de diseño. Aquí queda el guion y la plantilla de resultados.
- **El sistema de diseño definitivo de Bitclick**: depende de la pregunta abierta. Esta rebanada deja una base neutra con un solo fichero de variables para no bloquearse.
- **La página de decisión del correo** (`apps/channels`): ya existe y esta rebanada no la toca. Lo que aquí se prototipa es la aprobación dentro del producto, que sí conoce la forma del borrador.
- **El contador real** (`apps/web/app/panel/contador`): rebanada «Contador de tareas v0», ya fusionada. El prototipo enseña un contador de ejemplo y lo dice.
- **Internacionalización a un segundo idioma**: la estructura entra ahora, las traducciones cuando haya mercado. El diccionario solo trae castellano.

## Presupuesto de tokens

Presupuesto propuesto: 35 €, y así se fija en «Presupuesto tokens (€)» del tablero, que estaba vacía. Referencia: «Aprobación por correo v0» trabajó con 45 € tocando dos paquetes y una aplicación con base de datos y pruebas de integración; esta toca dos paquetes sin base de datos, sin migración y sin integración, pero con más superficie de pantalla y de texto. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

¿El producto AI Workforce hereda la identidad visual de BitclickLabs o tiene la suya? El único documento de marca del espacio es la brand voice de BitclickLabs, declarada para vídeo, con verde terminal sobre negro obsidiana y Space Grotesk. Aplicarla a un panel donde un gerente aprueba escrituras en su ERP contradice el tono que ese mismo documento pide. Este prototipo usa una base neutra con un solo fichero de variables, así que la respuesta se aplica cambiando ese fichero; pero la respuesta hace falta antes de que el panel v1 fije componentes.
