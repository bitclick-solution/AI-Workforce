VIGENTE

# Especificación · Sala v1 · interfaz estilo Discord

- Rebanada: [Notion](https://app.notion.com/p/3e653066189881b0bcf7d3f003210f47) · Ciclo 2 (adelantada por Jesús el 2026-09-28) · Tipo Diseño · Paquetes `web`, `ui` · P0
- Rama: `rebanada/sala-v1-interfaz`
- Plan de referencia: [ADR-022](../adr/ADR-022.md) (salas estilo Discord, S2 en el panel y S4 en el móvil, estados de presencia), [ADR-020](../adr/ADR-020.md) (sistema de diseño «Oficina cercana») y el [lienzo de diseño](https://claude.ai/artifact/L96FBGK1NR7d7XkkQCupbs), página «Salas · versiones»: tableros S2, S4 y S0 (hoja de estados).
- Zona crítica: no. La rebanada toca `apps/web/app/panel/sala/**`, `apps/web/lib/sala-*.ts`, `packages/ui`, `e2e/` y `playwright.config.ts`; ninguna ruta está en `.github/CODEOWNERS`.

## Objetivo

La sala deja de ser una lista de mensajes sin contexto. En el panel ves las salas dentro de la navegación con sus sin leer y menciones, la conversación en el centro y a la derecha quién hay y en qué estado está, agrupado en personas y agentes. En el móvil ves la fila de presencia bajo la cabecera, la hoja de miembros y el cajón de salas. Todo detrás de la bandera `AIW_SALA_V1`.

## Paquetes tocados

- `packages/ui`: componentes de presentación nuevos y sus tokens.
- `apps/web`: pantallas de `/panel/sala`, el contrato, la fuente simulada y la bandera.

Trabajo en paralelo: el Constructor lleva la API, Centrifugo, la base de datos, el libro de auditoría y `apps/web/lib/sala.ts` en su propia rama. Esta rama no toca `apps/web/lib/sala.ts`, `apps/web/app/api/**`, `apps/api`, `apps/worker`, `packages/rooms` ni `packages/db`.

## Endpoints, flujos y datos

- Sin endpoints, flujos ni migraciones.
- Contrato `apps/web/lib/sala-contrato.ts`: copia literal acordada con el Constructor (`FuenteDeSala`, `MiembroDeSala`, `ResumenDeSala`, `CambioDeSala`, `EstadoDePresencia`).
- `apps/web/lib/sala-simulada.ts`: implementación de `FuenteDeSala` con datos sintéticos (nombres inventados) que cubre los siete estados del ADR-022 y simula presencia y escritura en vivo. También expone la conversación de ejemplo, que el contrato no cubre.
- `apps/web/lib/sala-fuente.ts`: la fuente que usa la vista. Hoy reexporta la simulada. El segundo PR en fusionarse (este o el del Constructor) la conecta a `crearFuenteDeSala()` de `apps/web/lib/sala.ts`.
- Bandera: `AIW_SALA_V1` en `apps/web/lib/sala-bandera.ts`, con el mismo patrón que `AIW_SALA_V0` y `AIW_PANEL_CONTADOR` (`'1'` o `'true'` la activan). Con `AIW_SALA_V1` activa, `/panel/sala` sirve la v1; si no, y `AIW_SALA_V0` está activa, sirve la v0 sin cambios; sin ninguna, 404.

## Criterios de hecho

1. `/panel/sala` con `AIW_SALA_V1=1` sigue S2 en escritorio (≥ 1024 px): «Salas» en la navegación con la general y una por equipo, cada una con sin leer y menciones; cabecera con quién está en la sala; conversación con la etiqueta IA en los agentes, tarjeta de aprobación y tarjeta de propuesta; indicador de escritura sobre el compositor; panel de miembros a la derecha agrupado en personas y agentes, con filtros Todos, En la sala, Inactivos y Añadidos y un botón para ocultarlo.
2. En el móvil (< 1024 px) sigue S4: cabecera con la fila de presencia, hoja de miembros y cajón de salas, con objetivos táctiles de 44 px como mínimo.
3. Los siete estados del ADR-022 (en la sala, escribiendo, inactivo, añadido; y solo para agentes trabajando, te necesita y en pausa) tienen una forma distinta de la marca y siempre un texto visible y accesible. Los agentes llevan la etiqueta IA.
4. Componentes nuevos en `packages/ui` con prueba unitaria y muestra en `/panel/muestras`: `MarcaDePresencia`, `AvatarConPresencia`, `EtiquetaIA`, `FilaDeMiembro`, `PanelDeMiembros`, `NavegacionDeSalas`, `IndicadorDeEscritura`, `FilaDePresencia`, `HojaMovil` y `TarjetaDePropuesta`.
5. La prueba de contraste de `packages/ui` cubre los pares nuevos: AA (4,5:1) para texto sobre fondo en claro y oscuro, y 3:1 para las marcas de presencia sobre la superficie (WCAG 1.4.11).
6. La sala se usa con teclado (orden de tabulación, `Escape` cierra la hoja y el cajón, el foco vuelve al botón que los abrió) y con lector de pantalla; el indicador de escritura se anuncia con `aria-live="polite"`.
7. Prueba de Playwright de `/panel/sala` en escritorio y en móvil con la fuente simulada.
8. Capturas de S2 y S4 en claro y oscuro en el PR, con cada estado de presencia visible al menos una vez.
9. Sin datos reales: solo nombres sintéticos.

## Casos de prueba y de eval

- Unitario (`packages/ui`): cada estado produce una forma distinta (`data-forma`) y su texto; los estados solo de agente no se aceptan para personas; los filtros del panel cuentan y agrupan bien, y el vacío de un filtro se explica con texto; la navegación marca la sala actual con `aria-current` y anuncia menciones y sin leer con texto; el indicador de escritura redacta uno, dos y tres o más nombres y queda vacío sin nadie; la hoja se cierra con `Escape`.
- Unitario (`apps/web`): la bandera; la fuente simulada cubre los siete estados, notifica cambios de presencia y de escritura, y deja de notificar al darse de baja; la conversión de `desde` a texto relativo.
- Contraste: `packages/ui/src/contraste.test.ts` ampliado con los pares nuevos y con la comprobación 3:1 de las marcas.
- E2E: `e2e/sala-v1.spec.ts` en escritorio (salas, filtros, ocultar el panel, teclado, estados) y en móvil (fila de presencia, hoja, cajón, `Escape`, objetivos de 44 px).
- Eval: no aplica. La rebanada no añade comportamiento de agente.
- Auditoría y contador: no aplica. La interfaz no ejecuta acciones: aprobar y contratar son locales en la fuente simulada hasta que llegue la del Constructor, que es quien las lleva al libro de auditoría.
- Secretos: la fuente simulada no lee el entorno ni llama a la red; la bandera solo lee `AIW_SALA_V1`. La prueba de secretos de la CI cubre la rama.

## Decisiones que el plan no fijaba

- **Privacidad de la presencia: supuesto temporal, no decisión.** Qué departamentos ven la presencia de qué salas se decide el miércoles 30 de septiembre de 2026. Mientras tanto, por defecto, solo los miembros de una sala ven su presencia. La interfaz solo pinta lo que la fuente le da para la sala abierta; el filtrado real es del Constructor.
- **En pausa cuenta como Inactivo en los filtros.** Los filtros del lienzo son Todos, En la sala, Inactivos y Añadidos; en pausa (solo agentes) no trabaja, así que cae en Inactivos. En la sala agrupa en la sala, escribiendo, trabajando y te necesita.
- **Panel de miembros por defecto:** abierto a partir de 1280 px y cerrado entre 1024 y 1279 px, con el botón para abrirlo. Es la pregunta abierta de la rebanada; este es el valor provisional.
- **Navegación del panel:** solo se pinta el grupo «Salas». Inicio, Equipos, Conexiones, Registro, Cumplimiento y Ajustes aparecen cuando sus rebanadas existan, para no dejar enlaces muertos.
- **Conversación fuera del contrato:** el contrato solo cubre salas, miembros, cambios y escritura. La conversación (mensajes, aprobación y propuesta) sale de `sala-simulada.ts` con un tipo de presentación propio; conectarla a los mensajes con `salaId` del Constructor es parte del segundo PR.
- **Texto de estado:** el contrato no trae el detalle del lienzo («extracto de ayer», «1 aprobación»). La interfaz muestra el estado y, si hay `desde`, cuánto hace («Inactivo · 15 min»).
- **Trabajando y te necesita** reutilizan los anillos de `AvatarDeAgente` (discontinuo y ámbar); la marca de la esquina es propia de cada estado.

## Fuera de alcance

- API, Centrifugo, base de datos, auditoría y presencia en vivo real: «Sala v1 · salas por equipo y presencia en vivo» (Constructor).
- Hilos, mensajes fijados y mensajes directos con agentes: sin rebanada todavía; sus botones no aparecen.
- La maqueta de la oficina.

## Tablero

El tablero se actualizó por MCP de Notion: la rebanada pasó a En curso con Agente Diseñador e Inicio 2026-09-28.

## Comandos de comprobación

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm evals:smoke` y `pnpm build` existen en `package.json` y pasan en verde. La prueba de Playwright se lanza con `pnpm e2e`; su servidor arranca con `AIW_SALA_V1=1` (`playwright.config.ts`).

Otros cambios de soporte:

- `.prettierignore` excluye `apps/web/lib/sala-contrato.ts`: Prettier compacta la unión de estados y rompería la copia literal acordada, y la CI ejecuta `pnpm format:check`.
- `scripts/capturas-sala-v1.mjs` genera las capturas del PR en `docs/specs/capturas/sala-v1-interfaz/`: escritorio y móvil, claro y oscuro, y la hoja de miembros y el cajón de salas en el móvil.

## Conexión con la fuente real

Al cerrar esta sesión (2026-09-28), `main` no tiene `crearFuenteDeSala()` en `apps/web/lib/sala.ts`, así que `sala-fuente.ts` sigue en la simulada. Si el PR del Constructor se fusiona después, su PR cambia `crearFuente` en `sala-fuente.ts` para que devuelva `crearFuenteDeSala()`.

## Presupuesto de tokens

Presupuesto: 35 €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

¿El panel de miembros se abre por defecto en pantallas de menos de 1280 px? Hasta que Jesús decida, se abre a partir de 1280 px.
