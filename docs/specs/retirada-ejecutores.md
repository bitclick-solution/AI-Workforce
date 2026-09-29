VIGENTE

# Especificación · Retirada de los ejecutores auto-hospedados

- Rebanada: [Notion](https://app.notion.com/p/3ea53066189881eca1b7f57158b74a7d) · Ciclo actual · Tipo Operación · Paquetes `docs` · P0
- Rama: `rebanada/retirada-ejecutores`
- Plan de referencia: [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn), especificaciones de [ejecutores auto-hospedados](ejecutores-auto-hospedados.md) y [ejecutor dedicado al Revisor](ejecutor-revisor.md).
- Zona crítica: no. No toca `.github/` ni código de producto.

## Objetivo

Jesús decide (29-9-2026) retirar los tres ejecutores auto-hospedados (`vps-aiw`, `vps-aiw-revisor` y `wsl-aiw`) porque eran lentos, consumían mucho y le impedían trabajar. Además, va a hacer público el repositorio para que GitHub Actions sea gratis. Esta rebanada deja constancia de la retirada y quita de la documentación los detalles de la infraestructura de Bitclick antes de publicar el repositorio.

## Paquetes tocados

- `docs/runbooks/ejecutores-auto-hospedados.md`: pasa a registro histórico sin detalles del host (servicios, puertos, rutas, usuarios).
- `docs/specs/ejecutores-auto-hospedados.md` y `docs/specs/ejecutor-revisor.md`: pasan a registro histórico con nota de retirada.
- Ningún workflow: sin las variables `AIW_RUNS_ON` y `AIW_RUNS_ON_REVISOR`, `ci.yml`, `revisor.yml` y `rutinas-nocturnas.yml` ya usan `ubuntu-24.04`.

## Endpoints, flujos y datos

No aplica.

## Criterios de hecho

1. Los ejecutores no aparecen en **Settings → Actions → Runners**, las variables `AIW_RUNS_ON` y `AIW_RUNS_ON_REVISOR` no existen, y en el VPS no queda ningún servicio `actions.runner`, usuario de ejecutor ni perfil de AppArmor suyo. Los contenedores de producción siguen arriba. Comprobado por Jesús en su terminal el 29-9-2026.
2. El runbook es un registro histórico: qué se montó, por qué se retiró, el estado tras la retirada, las lecciones y cómo reactivarlo. No nombra servicios, puertos, rutas ni usuarios del VPS.
3. Las dos especificaciones anteriores están en `REGISTRO HISTÓRICO` con la nota de retirada, sin el dimensionado del VPS ni referencias a sus servicios.
4. La CI de este PR corre entera en ejecutores de GitHub y en verde.

## Casos de prueba y de eval

- Unitario: no aplica (solo documentación). La CI del PR demuestra la vuelta a `ubuntu-24.04`.
- Eval: no aplica.
- Auditoría y contador: no aplica, infraestructura de CI.
- Secretos: gitleaks sobre todo el historial sin hallazgos. Búsqueda manual de nombres de host, rutas y servicios del VPS en `docs/` antes de publicar el repositorio.

## Fuera de alcance

- Reescribir el historial de git para borrar los detalles del VPS que siguen en commits anteriores. Es decisión de Jesús y exige force-push sobre `main`.
- Quitar de los workflows el soporte de `AIW_RUNS_ON`: sin la variable no hace nada, y permite reactivar un ejecutor sin tocar el YAML.

## Presupuesto de tokens

Presupuesto: 3 €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

Ninguna.
