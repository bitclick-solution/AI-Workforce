VIGENTE

# Especificación · Revisor en GitHub Actions: primera ejecución real y modelo del action

- Rebanada: [Notion](https://app.notion.com/p/3e053066189881649484fc0c378c0852) · Ciclo 0 · Tipo Operación · Paquetes deploy, docs · P1
- Rama: `rebanada/revisor-en-actions`
- Plan de referencia: _Cómo llevarlo a cabo_ ("Cada PR dispara al Revisor desde GitHub Actions"; "nivel de esfuerzo medio para el Revisor") y ADR-008.
- Zona crítica: sí. Toca `.github/workflows/`; requiere la aprobación de Jesús.

## Objetivo

Que el job `Revisor` termine con un veredicto en cada PR. En los PR 4 y siguientes, con `ANTHROPIC_API_KEY` ya presente, el job acababa con `is_error: true` en menos de medio segundo, un turno y coste cero: la primera llamada a la API fallaba y el registro ocultaba el motivo.

## Paquetes tocados

`.github/workflows/revisor.yml`, `.github/workflows/rutinas-nocturnas.yml` (misma autenticación, vía de respaldo apagada) y `docs/runbooks/proteccion-de-rama.md`.

## Criterios de hecho

1. El job `Revisor` acepta dos formas de autenticación: `ANTHROPIC_API_KEY` (clave de la consola de la API) o `CLAUDE_CODE_OAUTH_TOKEN` (token de una suscripción de Claude generado con `claude setup-token`). El job `comprobar` se omite en verde solo cuando faltan las dos.
2. El modelo del Revisor queda fijado en `claude_args` y no depende del valor por defecto del action, que apuntaba a la variante de un millón de tokens de contexto. Esfuerzo medio según el ADR-008.
3. Si el action falla, un paso posterior imprime solo el diagnóstico del resultado (tipo, `is_error`, número de turnos y el mensaje de error recortado), sin volcar la transcripción.
4. `rutinas-nocturnas.yml` acepta la misma doble autenticación.
5. `docs/runbooks/proteccion-de-rama.md` explica los dos secretos posibles, qué debe admitir la clave y dónde leer el diagnóstico.
6. En este mismo PR, el check `Revisor` termina con veredicto o, si sigue fallando, el paso de diagnóstico muestra el motivo real en el registro.

## Casos de prueba

- YAML de los dos workflows válido; formato con Prettier.
- El propio PR de la rebanada ejecuta el Revisor: es el caso de prueba real.
- Sin ninguno de los dos secretos, `comprobar` deja el check en verde con aviso (comportamiento anterior conservado).

## Resultado de la primera ejecución

El PR #8 ejecutó el workflow nuevo el 2026-09-19. El check `Revisor` falló y el paso de diagnóstico mostró el motivo real: `subtype=success is_error=true turnos=1 coste=0` y `error: Credit balance is too low`. Con `claude-sonnet-5` fijado, la causa no es el modelo: la organización de la clave no tiene crédito. El criterio 6 se cumple por su segunda rama. Que el Revisor deje veredicto en cada PR depende de una acción de Jesús: recargar crédito en la consola de la API o crear `CLAUDE_CODE_OAUTH_TOKEN` con `claude setup-token`. El runbook recoge ambas.

## Fuera de alcance

Cambiar el rol del Revisor (`.claude/agents/revisor.md`), la plantilla de PR o la vía primaria de las rutinas nocturnas, que ya está decidida como Rutinas de Claude Code.

## Presupuesto de tokens

Presupuesto: 5 €. Consumo real estimado al abrir el PR: ver la rebanada en Notion.
