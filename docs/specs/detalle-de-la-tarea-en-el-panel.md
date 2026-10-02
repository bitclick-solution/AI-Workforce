VIGENTE

# Especificación · Detalle de la tarea en el panel

- Rebanada: [Notion](https://app.notion.com/p/3ed530661898818382e3fc5609085e2f) · Ciclo 1 · Tipo Producto · Paquetes `apps/web`, `packages/ui`, `apps/api` · P0
- Rama: `rebanada/detalle-de-la-tarea-en-el-panel`
- Plan de referencia: [ADR-020](../adr/ADR-020.md) («Oficina cercana»); ADR-034 (la interfaz avanza solo sobre lo que ya existe; la decisión vive en Notion › Decisiones, aún sin archivo en `docs/adr/`). Parte de [Inicio · widgets y avisos](inicio-panel-widgets-avisos.md) (PR #53, arreglo #78) y de [Aprobación por correo v0](aprobacion-por-correo-v0.md) (el resumen legible).
- Zona crítica: no. No toca identidad, políticas, gateway, `packages/ledger` (solo se lee), migraciones, `CLAUDE.md`, `.claude/` ni `.github/`.

## Objetivo

La demo del 2-10 no convenció porque el trabajo del agente solo se veía en la terminal. Cuando esta rebanada está hecha, una persona abre cualquier tarea en curso o reciente desde el Inicio y ve, en el panel, qué hace el agente paso a paso y qué va a escribir antes de aprobar, y aprueba o rechaza desde ahí.

## Paquetes tocados

- `apps/api`: una ruta de lectura, `GET /inicio/tareas/:id`, detrás de la sesión, en `rutas/inicio.ts`. Sin escrituras, sin flujos, sin tablas.
- `packages/ui`: componentes del detalle (`PasoDeTarea`, `ListaDePasos`) sobre los primitivos existentes.
- `apps/web`: proxy `/api/inicio/tareas/[id]`, página `/panel/inicio/tarea/[id]`, enlaces desde «Tu equipo», «Lo último» y los avisos.

## Endpoints, flujos y datos

`GET /inicio/tareas/:id` (misma bandera `AIW_INICIO_PANEL` y misma sesión que el resto de `/inicio`). Tenant y persona salen de la sesión. Responde:

- `tarea`: `tareaId`, `encargo`, `estado` (`pendiente`, `en_curso`, `esperando_aprobacion`, `completada`, `fallida`, `cancelada`), `puestoId`, `agente`, `departamento`, `desde`, `actualizadoEn`, `costeEuros` (suma de las entradas del libro de esa tarea).
- `pasos[]` en orden del libro (`numero_orden`): `orden`, `tipo` (`arranque`, `herramienta`, `aprobacion_pedida`, `decision`), `accion`, `herramienta`, `resultado` (`exito`, `error`, `rechazado`, `parcial`), `costeEuros`, `nivel` (`n0`–`n3` o `null`), `porque` (el `motivo` que ya anota el bucle del agente en `datos_referenciados` con tipo `motivo`, o `null`), `creadoEn`. Se omiten las entradas técnicas (correo enviado, enlace abierto, señal entregada).
- `delegadas[]`: todas las tareas descendientes (hijas, nietas…) por `tarea_padre_id`, en orden de creación, con `tareaId`, `tareaPadreId`, `encargo` (el de `delegacion`, o `null` si no hay fila: no se inventa), `estado`, `puestoId`, `agente`, `departamento`, `cruzaDepartamento`, `desde` y `costeEuros` (suma de sus entradas del libro). `costeTotalEuros` suma la tarea y sus delegadas. Cada delegada enlaza a su propio detalle. Sin tablas ni consultas nuevas más allá de leer `tarea`, `delegacion` y el libro. Decidido por Jesús el 2-10 (respuesta a la pregunta abierta).
- `aprobacionPendiente`: la aprobación sin decisión de esa tarea con `aprobacionId`, `claseAccion`, `nivelExigido`, `resumenLegible` (el mismo texto que lleva el correo), `creadoEn`, `venceEn` y `puedeDecidir` (`true` solo si se le pidió a la persona de la sesión, igual que la ruta de decidir). Si no hay, `null`.

Errores: 401 sin sesión, 400 con un id que no es UUID, 404 si la tarea no existe **o es de otra organización** (misma respuesta, para no revelar existencia), 405 con otro método.

Decidir **no** tiene ruta nueva: el detalle llama a `POST /inicio/avisos/:id/decidir`, la misma del panel de avisos (`decidirAviso` en `apps/web/lib/inicio.ts`).

Sin cambios de esquema. Tiempo real: se reutiliza `suscribirseAAgentesEnVivo` con la fuente de Sala v1; cada cambio relee el detalle. Respaldo de consulta periódica igual que el Inicio, porque el trabajador aún no publica un aviso al anotar cada paso (limitación conocida, fuera de alcance: tocar `apps/worker`).

## Criterios de hecho

1. Desde el Inicio, una tarea en curso o reciente («Tu equipo», «Lo último», avisos) enlaza a `/panel/inicio/tarea/:id`.
2. El detalle muestra el encargo, el agente, el estado, el coste y los pasos en orden del libro: herramientas usadas, aprobación pedida, decisión y resultado. Cada paso lleva su coste, su nivel de autonomía y el porqué cuando el libro lo tiene; cuando no, lo dice.
3. Una aprobación pendiente muestra el resumen legible y se decide desde el detalle con `AvisoDeAprobacion` (Aprobar y Rechazar), por la misma ruta del panel de avisos; si no se le pidió a esa persona, se ve el resumen sin botones y con el motivo.
4. El detalle se actualiza en tiempo real con la conexión de Centrifugo del Inicio, y con respaldo periódico si falla.
5. Diseño según ADR-020, con componentes de `packages/ui` y sin clases de Tailwind a mano fuera del sistema. Estados diseñados: vacío (sin pasos aún), error (no carga, no existe) y «necesita a una persona».
6. Ningún dato de otra organización aparece: prueba de aislamiento con dos organizaciones sembradas.
7. Las tareas delegadas aparecen dentro de la tarea raíz, con su estado y coste, y el coste total las suma.
8. Prueba de Playwright: encargar en el Inicio, abrir el detalle, ver llegar los pasos y aprobar desde el detalle; capturas en `docs/producto/capturas/`.

## Casos de prueba y de eval

- Unitario (`apps/api`): sesión válida y sin ella (401), id inválido (400), tarea inexistente (404), método incorrecto (405), pasos ordenados y sin entradas técnicas, aprobación pendiente con `puedeDecidir` verdadero y falso, tarea sin pasos, aislamiento entre dos organizaciones (la tarea de B da 404 a la sesión de A y nunca aparece en su respuesta), y una prueba por `arrancarApi` entero para que el cuerpo y la cadena de manejadores no la rompan. Integración con PostgreSQL del puerto real si hay base disponible; si no, el puerto se prueba con el cliente doble existente.
- Unitario (`packages/ui`): `PasoDeTarea` con cada resultado, con y sin porqué; estados vacío y error.
- Unitario (`apps/web`): cliente `leerDetalleDeTarea` (éxito, 404, 502), proxy, vista con los tres estados, decisión por la ruta compartida y relectura en tiempo real.
- E2E: criterio 7, con la API simulada por `page.route` y estado en memoria (el arnés solo arranca `apps/web`, como en `e2e/inicio.spec.ts`).
- Eval: no hay comportamiento de agente nuevo.
- Auditoría y contador: no aplica; la ruta solo lee. Decidir ya emite su entrada con `registrarDecision`.
- Secretos: la prueba de secretos existente de `apps/api` cubre la ruta; las capturas y fixtures usan datos de prueba.

## Fuera de alcance

- Datos que hoy no existen: el porqué de las llamadas que el bucle no anota con motivo y el desglose de tokens (se anotan en el PR con propuesta de rebanada).
- Roles por departamento (ADR-033, previsto 7-12): el detalle se limita a la organización de la sesión.
- Bandeja completa, aprobación en lote y plazos: «Bandeja humana v1».
- Aviso en tiempo real al completarse cada paso desde `apps/worker`.

## Presupuesto de tokens

Presupuesto: 30 €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

Ninguna. La anterior (¿mostrar las tareas delegadas?) la respondió Jesús: sí, y está en el alcance.
