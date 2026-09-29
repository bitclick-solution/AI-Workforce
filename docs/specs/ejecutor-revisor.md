REGISTRO HISTÓRICO

> Retirado el 29-9-2026 junto con el resto de ejecutores auto-hospedados: el Revisor vuelve a los ejecutores de GitHub y no espera a la CI. Ver `docs/specs/retirada-ejecutores.md`.

# Especificación · Ejecutor dedicado al Revisor y espera a la CI

- Rebanada: [Notion](https://app.notion.com/p/3ea530661898815e89dcd487035fb40b) · Ciclo actual · Tipo Operación · Paquetes `deploy`, `docs` · P0
- Rama: `rebanada/ejecutor-revisor`
- Plan de referencia: [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn), especificación y runbook de [ejecutores auto-hospedados](ejecutores-auto-hospedados.md).
- Zona crítica: sí, toca `.github/workflows/revisor.yml`. Marcada "Revisión humana obligatoria" en la rebanada.

## Objetivo

Con un solo ejecutor (`vps-aiw`), el Revisor ocupa el ejecutor mientras la CI del mismo commit espera en cola. Revisa siempre con la CI a medias y pide cambios; en el PR #38 hubo que relanzarlo a mano. Con esta rebanada, el Revisor corre en un ejecutor propio sin Docker y espera a que termine la CI del commit antes de revisar, de modo que su veredicto se basa siempre en la CI completa.

## Paquetes tocados

- `.github/workflows/revisor.yml`: `runs-on` con variable propia y paso de espera a la CI.
- `docs/runbooks/ejecutores-auto-hospedados.md`: instalación, vuelta atrás y retirada del segundo ejecutor.
- Ningún paquete de producto.

## Endpoints, flujos y datos

No aplica.

## Criterios de hecho

1. Segundo ejecutor `vps-aiw-revisor` en el VPS como servicio: usuario propio sin privilegios, sin Docker, etiquetas `self-hosted, linux, x64, aiw-revisor` (sin `aiw`, para que ningún job de la CI caiga en él) y límites de systemd bajos (`MemoryMax=3G`, `CPUQuota=100%`, prioridad baja).
2. `revisor.yml` decide `runs-on` con `AIW_RUNS_ON_REVISOR`; sin ella usa `AIW_RUNS_ON` y, sin esta, `ubuntu-24.04`. Volver atrás es borrar la variable.
3. Solo cuando existe `AIW_RUNS_ON_REVISOR`, el Revisor espera a que termine la ejecución de `ci.yml` del SHA de cabeza del PR, con un plazo de 3 horas: con varios PR en cola sobre un solo ejecutor de CI, una ejecución completa puede tardar más de una hora. Sin la variable no espera: compartiría el ejecutor con la CI y se bloquearían mutuamente hasta agotar el plazo. El resultado (`success`, `failure`, `cancelled` o `sin-terminar`) llega al prompt del Revisor, que lo cita en su veredicto; si la CI falla, revisa igualmente.
4. `ci.yml` y `rutinas-nocturnas.yml` no cambian. El check requerido sigue llamándose `Revisor`.
5. Runbook actualizado con el segundo ejecutor: instalación con comprobaciones y sin paquetes de Docker, vuelta atrás y retirada.
6. Comprobado con un PR real: el Revisor corre en `vps-aiw-revisor`, espera a la CI de `vps-aiw` y da su veredicto con la CI completa, sin relanzarlo a mano.

## Casos de prueba y de eval

- Unitario: no aplica (sin código de producto). Prueba real con el PR de esta rebanada: el paso de espera registra los estados de la CI hasta `completed` y el veredicto cita la conclusión. Vuelta atrás: sin `AIW_RUNS_ON_REVISOR`, el paso de espera se salta.
- Eval: no aplica; el comportamiento del Revisor no cambia, solo recibe un dato más en el prompt.
- Auditoría y contador: no aplica, infraestructura de CI.
- Secretos: el token de registro lo usa Jesús en su terminal; el job `secretos` sigue en la CI.

## Fuera de alcance

- Paralelizar la CI con varios ejecutores generales: exige puertos dinámicos en `ci.yml` y queda para otra rebanada.
- Cambios en el prompt de `.claude/agents/revisor.md`.

## Presupuesto de tokens

Presupuesto: 8 €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

Ninguna.
