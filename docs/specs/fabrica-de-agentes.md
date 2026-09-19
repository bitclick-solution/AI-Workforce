VIGENTE

# Especificación · Fábrica de agentes: roles, CLAUDE.md, rutinas nocturnas y Revisor por PR

- Rebanada: [Notion](https://app.notion.com/p/3e053066189881809038ebcce7f5c77d) · Ciclo 0 · Tipo Operación · Paquetes docs, deploy · P0
- Rama: `rebanada/fabrica-de-agentes`
- Plan de referencia: [Plan de construcción v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn), sección _Cómo llevarlo a cabo_ (la fábrica, la rebanada, la cadencia, el seguimiento en Notion, la definición de hecho) y ADR-008.
- Zona crítica: sí. `CLAUDE.md`, `.claude/` y `.github/` exigen la aprobación de Jesús.

## Objetivo

Configurar la fábrica que construye el producto: las reglas que toda sesión de Claude Code lee, los ocho roles con sus permisos y su definición de hecho, los once ADR con la misma redacción que el tablero, la plantilla de especificación, las rutinas nocturnas del Cronista y del Evaluador, y el Revisor que se dispara en cada PR.

## Paquetes tocados

Solo documentación y configuración: `CLAUDE.md`, `.claude/agents/`, `.claude/routines/`, `docs/adr/`, `docs/specs/PLANTILLA.md`, `docs/runbooks/`, `.github/workflows/revisor.yml`, `.github/workflows/rutinas-nocturnas.yml` y `.github/mcp/`. Sin código de producto.

## Criterios de hecho

1. `CLAUDE.md` contiene las diez reglas del tablero con su redacción, las fronteras de arquitectura, las zonas críticas, el protocolo de Notion al empezar y terminar cada sesión y el presupuesto de tokens, en menos de 200 líneas.
2. `.claude/agents/` tiene ocho archivos (planificador, constructor, revisor, evaluador, cronista, disenador, operador, investigador) con frontmatter válido de Claude Code: nombre, descripción, herramientas permitidas y esfuerzo; y cuerpo con prompt, entradas, salidas, método y definición de hecho.
3. `docs/adr/ADR-001.md` a `ADR-011.md` reproducen los campos de la base Decisiones sin cambios de redacción y con su estado en el tablero.
4. `docs/specs/PLANTILLA.md` sirve para escribir una especificación de una página.
5. `.claude/routines/cronista.md` y `evaluador.md` contienen los prompts de las rutinas nocturnas, y `.github/workflows/rutinas-nocturnas.yml` los programa, desactivados hasta que Jesús defina la variable `RUTINAS_NOCTURNAS`.
6. `.github/workflows/revisor.yml` dispara al Revisor en cada PR no borrador y deja el veredicto en el PR.
7. `docs/runbooks/proteccion-de-rama.md` describe la protección de `main`, los secretos y las variables que Jesús debe configurar.

## Casos de prueba

- Frontmatter de los ocho agentes válido: nombre en minúsculas y guiones, descripción, lista de herramientas y esfuerzo; verificado con un script al abrir el PR.
- Los once ADR existen, empiezan por la línea de estado y su campo Código coincide con el nombre del archivo.
- Los workflows validan con `actionlint` en local o, si no está disponible, con `docker compose config` no aplica: se comprueba la sintaxis YAML con Node.
- Sin secretos: los workflows solo referencian `secrets.ANTHROPIC_API_KEY`, `secrets.NOTION_TOKEN` y `secrets.GITHUB_TOKEN`.

## Fuera de alcance

Ejecutar las rutinas (requieren secretos que solo Jesús puede crear), la protección de rama en GitHub (ajuste de la organización), los hooks de Claude Code y las evals por puesto.

## Presupuesto de tokens

Presupuesto: 30 €. Consumo real estimado al abrir el PR: ver la rebanada en Notion.
