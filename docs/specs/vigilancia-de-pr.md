VIGENTE

# Especificación · Vigilancia de PR para las sesiones de agentes

- Rebanada: [Notion](https://app.notion.com/p/3e9530661898816fad4ac4a9a54fe426) · Ciclo actual · Tipo Operación · Paquetes `docs` · P1
- Rama: `rebanada/vigilancia-de-pr`
- Plan de referencia: [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn); `docs/runbooks/proteccion-de-rama.md` y el runbook de `docs/runbooks/ejecutores-auto-hospedados.md` (rama `rebanada/ejecutores-auto-hospedados`, PR #38).
- Zona crítica: sí — toca `CLAUDE.md` y `.claude/`. Marcada "Revisión humana obligatoria" en Notion por decisión explícita de Jesús, que autoriza a esta rebanada a tocar esos dos sitios solo para esto.

## Objetivo

Ninguna sesión que vigila un PR tenía dónde encontrar una guía propia del repositorio: el Operador de ejecutores, vigilando el PR #38, respondió «No hay guía propia en el repositorio, así que sigo con las reglas generales». Esta rebanada da a toda sesión que vigile o autocorrija un PR un sitio único con pasos concretos: qué hacer ante un fallo de CI (infraestructura, inestable o real), ante el veredicto del Revisor o un comentario, cómo programar las revisiones y cuándo parar y avisar a dirección.

## Paquetes tocados

- `.claude/skills/vigilar-pr/SKILL.md` (nuevo): el texto canónico de la guía.
- `CLAUDE.md`: sección breve «Mientras tu PR está abierto» que enlaza la guía, sin cambiar ninguna otra regla.
- `docs/specs/vigilancia-de-pr.md` (esta especificación).

## Endpoints, flujos y datos

No aplica: no hay código de producto, ni esquema, ni migración.

## Criterios de hecho

1. El repositorio tiene una guía propia de vigilancia de PR en el sitio donde Claude Code busca las instrucciones del repositorio (comprobado en la documentación oficial y citado en el PR). El texto canónico vive en un solo sitio; `CLAUDE.md` lo enlaza en una sección breve «Mientras tu PR está abierto».
2. La guía cubre con pasos: clasificación de la CI (fallo del código, infraestructura —facturación, ejecutor sin asignar, caído u ocupado— e inestable); qué se relanza y cuándo; comprobaciones locales antes de empujar y un solo push por ronda; veredicto del Revisor y comentarios de Jesús; conflictos con `main` y numeración de migraciones; jobs que solo corren en `main`; revisiones programadas (cadencia, una sola pendiente, silenciosas, fin al fusionar o cerrar); tablero y coste; cuándo parar y cómo avisar a dirección; lo que nunca se hace.
3. Recoge los hechos reales del repositorio: workflows y disparadores de `ci.yml`, `revisor.yml` y `rutinas-nocturnas.yml`; `AIW_RUNS_ON` y el ejecutor `vps-aiw` (un job a la vez) según el PR #38; la firma exacta del bloqueo de facturación; y los checks requeridos por la protección de `main` (`docs/runbooks/proteccion-de-rama.md`).
4. Coherente con `CLAUDE.md`, `.claude/agents/` y los runbooks existentes, sin duplicar texto ni cambiar ninguna otra regla de `CLAUDE.md`.
5. Sin secretos en ningún archivo; formato comprobado con `pnpm exec prettier --check`.
6. PR abierto con la plantilla de `.github/`, «Zona crítica: sí» y el resumen de quince líneas para Jesús; rebanada en **En revisión** con el enlace del PR, el de esta especificación y el coste real en tokens.

## Casos de prueba y de eval

- Unitario: no aplica — no hay código, solo documentación y una skill de proyecto.
- Eval: no aplica — no hay comportamiento de agente nuevo que certificar.
- Auditoría y contador: no aplica — es documentación de proceso, no una acción de la plataforma.
- Secretos: revisión manual de que la guía no contiene tokens, IDs de cuenta ni nombres de host sensibles; el job `secretos` (gitleaks) de la CI la cubre igualmente.

## Fuera de alcance

- Cualquier cambio en `.github/workflows/` o en el resto de `.github/` (pertenece a la rebanada `ejecutores-auto-hospedados`, PR #38, u otras).
- Automatizar la vigilancia (bots, cron de GitHub Actions): esta rebanada documenta el comportamiento de las sesiones, no crea infraestructura nueva.
- Cambiar `docs/runbooks/proteccion-de-rama.md` o `docs/runbooks/ejecutores-auto-hospedados.md`: la guía los cita, no los sustituye.

## Presupuesto de tokens

Presupuesto: 8 €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

Ninguna. El encargo de dirección (28-9-2026) ya fija el alcance, el sitio canónico por defecto (`.claude/skills/vigilar-pr/SKILL.md` si la documentación oficial no dice otra cosa) y la autorización para tocar `CLAUDE.md` y `.claude/` en esta rebanada.
