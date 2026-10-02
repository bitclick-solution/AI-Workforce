VIGENTE

# Especificación · Inicio (oficina): widgets, agentes en tiempo real y avisos a la derecha

- Rebanada: [Notion](https://app.notion.com/p/3e553066189881d0b24decfea9c0482b) · Ciclo 1 · Tipo Producto · Paquetes `apps/web`, `packages/ui`, `apps/api` · P0
- Rama: `rebanada/inicio-panel-widgets-avisos`
- Plan de referencia: [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn), «Ciclo de vida sin código» › «Estados de un agente» (propuesto, en prueba, activo, pausado, degradado, dado de baja) y «Contratar desde una frase»; [ADR-019](../adr/ADR-019.md) (página del agente — de aquí solo el sello de plantilla o de puesto propio y el enlace a la página del agente, que esta rebanada no construye); [ADR-020](../adr/ADR-020.md) (dirección visual v1: el inicio es un panel de widgets que cada persona ordena, estira, quita y añade, con el panel de avisos a la derecha); [ADR-021](../adr/ADR-021.md) (avisos en app y navegador desde la fase 1 — los avisos push nativos son su propia rebanada, fuera de esta). Parte de lo ya fusionado: [Sistema de diseño v1](sistema-de-diseno-v1.md), [Sala v1 · interfaz](sala-v1-interfaz.md) y [Sala v1 · presencia](sala-v1-presencia.md) (proyección de estado en tiempo real por Centrifugo), [Contador de tareas v0](contador-de-tareas-v0.md) y [Acceso al panel](acceso-al-panel.md) (sesión ya resuelta).
- Zona crítica: sí (revisado en PR #53; la especificación original decía «no», ver «Pregunta abierta»). No toca identidad, el motor de políticas, el gateway MCP ni prompts de sistema, y lee y escribe el libro de auditoría solo a través de `registrarTareaRaiz` y `registrarDecision`, ya construidos en `packages/ledger`, sin tocar ese paquete — pero sí añade una migración (`0008_disposicion_panel_inicio.sql`, columna `persona.disposicion_panel`), zona crítica por `.github/CODEOWNERS` con independencia de su tamaño.

## Objetivo

Cuando una persona con sesión entra al panel, el inicio deja de estar en blanco: es una oficina con widgets que cada persona ordena, estira y oculta, con el estado en tiempo real de los agentes de su organización y sus tareas, y un panel de avisos a la derecha con lo pendiente de aprobar. Desde ahí se encarga una tarea nueva a un agente con una frase y se aprueba una pendiente sin salir del inicio.

## Paquetes tocados

- `packages/ui`: el catálogo cerrado de widgets del inicio sobre los componentes ya construidos en «Sistema de diseño v1» (`TarjetaDeWidget`, `Indicador`, `ListaDeAvisos`, `AvisoDeAprobacion`, `AvatarDeAgente`), y el contenedor de rejilla que la persona reordena, estira y oculta.
- `apps/web`: la página de inicio del panel, el catálogo cerrado de widgets (saludo con encargo por frase, indicadores del contador y de la ficha, tu equipo, vencido por antigüedad, lo último), el panel de avisos a la derecha, la disposición elegida por persona, y el cliente que conecta con Centrifugo para el estado de los agentes en tiempo real, reutilizando el patrón ya construido en Sala v1.
- `apps/api`: dos rutas de lectura y escritura mínimas detrás de la sesión que ya resuelve Acceso al panel — encargar una tarea con texto libre (crea la tarea raíz con `registrarTareaRaiz` y arranca `tareaAgente`) y decidir una aprobación en línea (con `registrarDecision` y `entregarSenal`) — sin tocar `packages/ledger` ni `packages/rooms`.

## Endpoints, flujos y datos

- Lectura del inicio: estado de cada agente de la organización, su tarea en curso y sus últimas completadas, y las aprobaciones pendientes; se alimenta de la proyección de estado de Temporal y de la salida transaccional de eventos que ya usa Sala v1, no de una tabla nueva.
- `POST` para encargar: cuerpo con el encargo en texto libre y el puesto destino; crea la tarea raíz (`registrarTareaRaiz`) y arranca `tareaAgente` como cliente de Temporal desde `apps/api`, igual que hace hoy el guion `demo-cobros.ts` pero desde una petición HTTP con sesión, sin tocar `apps/worker`.
- `POST` para decidir una aprobación en línea: cuerpo con el sentido; llama a `registrarDecision` y `entregarSenal` ya construidos en `packages/ledger`, con la persona de la sesión como quien decide, en vez del enlace de correo.
- Disposición del panel por persona (qué widgets, en qué orden y tamaño, cuáles ocultos): dato nuevo por persona. Si cabe en una columna de la tabla `usuario` que ya trajo Acceso al panel, no hay migración de zona crítica; si el Constructor decide que necesita tabla propia, la rebanada pasa a zona crítica y se marca en el PR (ver pregunta abierta).
- Sin cambio de esquema en `packages/ledger` ni en `packages/rooms`.

## Criterios de hecho

1. El inicio muestra cada agente de la organización con su estado (propuesto, en prueba, activo, pausado, degradado — los del ciclo de vida del agente, no los de presencia de la sala), su tarea en curso y sus últimas tareas completadas, actualizado en tiempo real sin sondeo, reutilizando la conexión de Centrifugo de Sala v1.
2. El inicio es un panel de widgets: cada persona lo ordena, estira y oculta, y esa disposición se conserva entre sesiones para esa persona. El catálogo v1 es cerrado: saludo con encargo por frase, indicadores del contador y de la ficha, tu equipo, vencido por antigüedad y lo último.
3. Escribir un encargo en el widget de saludo crea una tarea raíz con su entrada en el libro de auditoría y suma al contador; la tarea aparece en «lo último» al arrancar.
4. El panel de avisos a la derecha muestra las aprobaciones pendientes y las tareas escaladas («necesita a una persona»); aprobar en línea decide sin salir del inicio y la aprobación desaparece de la lista.
5. El contador del periodo en curso es visible en el inicio.
6. Cada tarjeta de agente lleva un enlace a la sala de su departamento (existe, Sala v1) y el sello de plantilla o de puesto propio del ADR-019; los enlaces a la página del equipo y a la página del propio agente están preparados pero no llevan todavía a ninguna página, porque esas páginas son rebanadas propias que aún no existen.
7. Diseño según ADR-020: componentes y tokens de `packages/ui`, sin clases de Tailwind escritas a mano fuera del sistema.
8. Prueba de Playwright de extremo a extremo con los puestos de Cobros y Conciliación sembrados: encargar una tarea, verla llegar en tiempo real y aprobar una pendiente en línea.
9. El inicio se usa con teclado: orden de tabulación por todo el panel, y los widgets se reordenan también sin ratón.
10. Ningún dato de otro tenant aparece en el inicio: prueba de aislamiento con dos organizaciones sembradas.

## Casos de prueba y de eval

- Unitario (`packages/ui`): cada widget con sus estados, incluidos los vacíos («sin tareas», «sin avisos»); el contenedor de rejilla ordena, estira y oculta.
- Unitario (`apps/web`): persistencia de la disposición por persona; la fuente que conecta el estado de los agentes en tiempo real, con la caída de Centrifugo cubierta igual que ya lo hace Sala v1.
- Unitario e integración (`apps/api`): las dos rutas nuevas con sesión válida y sin ella (401), con tenant ajeno (aislamiento, criterio 10), encargo vacío o demasiado largo (400), y una aprobación ya decidida (idempotente, como en Aprobación por correo v0).
- E2E: criterio de hecho 8, y la comprobación de teclado del criterio 9.
- Eval: sin comportamiento de agente nuevo. Encargar una tarea ya lo cubre el caso dorado de la prueba técnica del stack; esta rebanada solo añade una vía nueva para arrancarla.
- Auditoría y contador: encargar y aprobar se comprueban contando entradas del libro y el contador, reutilizando las pruebas ya existentes de `registrarTareaRaiz` y `registrarDecision`.
- Secretos: sin credenciales nuevas; la prueba de secretos ya existente de `apps/api` cubre las rutas nuevas.

## Fuera de alcance

- La maqueta isométrica de la oficina (ADR-020, fase posterior).
- Avisos push nativos en móvil y en el navegador (ADR-021): rebanada «Avisos push en móvil y navegador».
- La página del equipo y la página del agente (ADR-019, ADR-020): rebanadas propias; aquí solo el enlace preparado, sin destino todavía.
- Widgets que aportan los propios agentes y el catálogo abierto de widgets: fase posterior al catálogo v1 cerrado.
- Duplicar, contratar o dar de baja un puesto desde el inicio: ciclo de vida sin código, Ciclo 3.

## Presupuesto de tokens

Presupuesto: 50 €. Referencia: «Sala v1 · interfaz estilo Discord» costó 35 € tocando `ui` y `web`; esta rebanada reutiliza los mismos patrones de presencia en tiempo real y añade además las dos rutas de `apps/api` (encargar tarea y aprobar en línea) y la persistencia de la disposición del panel, así que un presupuesto algo mayor es razonable. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

¿La disposición del panel por persona se guarda en una columna nueva de la tabla `usuario` que ya trajo Acceso al panel, o necesita una tabla propia? Una columna no cambia la zona crítica de esta rebanada; una tabla nueva la convierte en zona crítica por migración. Lo decide el Constructor al ver el tamaño real del dato, salvo que Jesús prefiera fijarlo antes.

**Resuelta (PR #53):** columna. `persona.disposicion_panel` (jsonb), migración `0008_disposicion_panel_inicio.sql` con su reverso, mismo patrón que `mostrar_presencia` (0007). El dato es pequeño (entradas `{id, tamano, oculto}` del catálogo cerrado v1), así que no hizo falta tabla propia. La migración sigue siendo zona crítica por tocar `packages/db` (CODEOWNERS), con revisión humana obligatoria de Jesús, independientemente de columna-vs-tabla.

## Seguimiento: el encargo llega a la API

- Rebanada: [Notion](https://app.notion.com/p/3ed53066189881f7bb94e2d3283a68e7) · Tipo Producto · Paquetes `web`, `api` · P1 · Rama `rebanada/inicio-encargo-llega-a-la-api` · Zona crítica: no (no toca `apps/api/src/identidad`).
- **Fallo.** El Probador (ensayo del 1-10) vio que «Encargar» devuelve siempre 400 «Falta el encargo», también con un POST JSON bien formado a `/api/inicio/encargar`.
- **Causa confirmada.** En `apps/api/src/servidor.ts`, los manejadores de sala, inicio y perfil leían el flujo de la petición con `leerJson(peticion)` cada uno. El flujo solo se consume una vez: la sala, que va antes que el inicio en la cadena, lo vaciaba en cualquier POST aunque la ruta no fuera suya, y el inicio recibía `undefined`. La ruta del panel y `reenviarInicio` reenviaban bien el cuerpo. Afectaba también a decidir en línea desde los avisos.
- **Arreglo.** El servidor lee el cuerpo una sola vez por petición (POST, PATCH, PUT) y lo pasa a cada manejador. El acceso de Better Auth conserva su propia lectura, porque responde antes de la cadena.
- **Criterios de hecho.**
  1. Una prueba que pasa por `arrancarApi` entero, con la sala montada delante, sale en rojo antes del arreglo y en verde después.
  2. La misma prueba cubre encargar, decidir desde los avisos, mensaje de sala, decisión de propuesta de sala y los dos PATCH del perfil (presencia y disposición).
  3. Siguen en 400 el encargo realmente vacío y el cuerpo que no es JSON.
  4. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm evals:smoke` y `pnpm build` en verde.
  5. El Probador lo verifica tras la fusión en la máquina de Jesús con una frase real.
- **Casos de prueba.** `apps/api/src/pruebas/cuerpo-http.test.ts`, sin PostgreSQL ni Temporal: puertos dobles y sesión inyectada (`resolverSesion`, `puertoPerfil` son opciones solo para pruebas, como `puertoSala` y `puertoInicio`).
- **Sin cambios** en esquema, libro de auditoría, contador ni evals: no hay comportamiento de agente nuevo y las acciones ya emiten su entrada.
- **Presupuesto:** 5 €.
