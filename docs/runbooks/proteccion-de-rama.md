VIGENTE

# Runbook · Protección de la rama main, secretos y variables

Ajustes de GitHub que Jesús configura una vez para que la fábrica funcione. Ninguno se puede hacer desde el código.

## Requisitos previos

- Permiso de administración sobre `bitclick-solution/AI-Workforce`.
- Una clave de la API de Claude para el Revisor y las rutinas, y una integración interna de Notion con acceso a la página **AI Workforce** y a sus seis bases.

## Proteger main

1. En GitHub, abre **Settings > Rules > Rulesets** y crea un ruleset para `main`.
2. Activa **Require a pull request before merging** con una aprobación y **Require review from Code Owners**. `CODEOWNERS` asigna las zonas críticas a Jesús.
3. Activa **Dismiss stale pull request approvals when new commits are pushed**.
4. Activa **Require status checks to pass** y añade los checks de `ci.yml`: `Lint y formato`, `Tipos`, `Pruebas`, `Evals de humo`, `Build`, `Playwright`, `Sin secretos en el repositorio`, `Compose de desarrollo arranca` y las cinco `Imagen <app>`. Añade `Revisor` cuando haya corrido al menos una vez.
5. Activa **Block force pushes** y **Restrict deletions**.
6. Deja la fusión con **squash** como única opción para que cada rebanada sea un commit en `main`.

## Secretos y variables

1. En **Settings > Secrets and variables > Actions**, crea los secretos:
   - Autenticación de Claude para el Revisor y las rutinas, una de las dos:
     - `ANTHROPIC_API_KEY`: clave de la consola de la API de Anthropic. La organización de la clave debe tener acceso al modelo que fija `claude_args` en los workflows (`claude-sonnet-5`) y crédito disponible.
     - `CLAUDE_CODE_OAUTH_TOKEN`: token de una suscripción de Claude, generado en tu equipo con `claude setup-token`. Úsalo si no tienes clave de la API.
   - `NOTION_TOKEN`: token de la integración interna de Notion, con permisos de lectura y escritura sobre la página **AI Workforce**.
2. Comparte la página **AI Workforce** con la integración desde Notion (**Conexiones** en el menú de la página).
3. Solo si eliges GitHub Actions como vía de las rutinas nocturnas (ver la sección siguiente), crea la variable `RUTINAS_NOCTURNAS` con el valor `true` y el secreto `CRONISTA_TOKEN`: un token de acceso personal de grano fino con permisos de contenido y de pull requests sobre este repositorio, o un token de GitHub App. Sin `CRONISTA_TOKEN`, el Cronista usa `GITHUB_TOKEN` y los PR que abre no disparan la CI ni al Revisor, así que no se podrían fusionar con el ruleset.
4. Si quieres que el Revisor pueda emitir aprobaciones formales además de comentarios, activa **Settings > Actions > General > Allow GitHub Actions to create and approve pull requests**. Sin este ajuste, el Revisor deja el veredicto como comentario de revisión y pide cambios cuando bloquea.

## Vía de ejecución de las rutinas nocturnas

Hay dos formas de ejecutar `.claude/routines/cronista.md` y `evaluador.md`. Elige una como primaria antes de activar nada: con las dos activas, el tablero recibe cada actualización por duplicado.

| Vía                                      | Cómo se activa                                                                                                                        | Ventajas                                                                                                  | Límites                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Rutinas de Claude Code (recomendada)     | Ya existen en la cuenta de Bitclick: "Cronista nocturno · AI Workforce" (22:00 UTC) y "Evaluador nocturno · AI Workforce" (22:30 UTC) | Sin clave de API; la app de GitHub de Claude dispara la CI y al Revisor sobre los PR que abre el Cronista | Dependen de la suscripción de Claude Code y de la sesión a la que están ligadas  |
| GitHub Actions (`rutinas-nocturnas.yml`) | Variable `RUTINAS_NOCTURNAS=true` más `ANTHROPIC_API_KEY`, `NOTION_TOKEN` y `CRONISTA_TOKEN`                                          | Auditable en el repositorio e independiente de cualquier sesión                                           | Consume clave de API; sin `CRONISTA_TOKEN` los PR del Cronista no disparan la CI |

Recomendación del Revisor y del Constructor: Rutinas de Claude Code como vía primaria y el workflow apagado como respaldo documentado. Si eliges Actions, desactiva antes las dos Rutinas de Claude Code.

## Comprobación

1. Abre un PR de prueba desde una rama `rebanada/<nombre>`. El workflow `Revisor` debe dejar un comentario con veredicto en menos de diez minutos. Si el job falla, el paso **Diagnóstico si el action falla** imprime en el registro el tipo de resultado, `is_error`, el número de turnos y el mensaje de error recortado. Un fallo en menos de un segundo con un turno y coste cero es de autenticación o de modelo: revisa el secreto y el acceso al modelo, no el prompt.
   Errores conocidos que imprime ese paso:
   - `Credit balance is too low`: la organización de la clave `ANTHROPIC_API_KEY` no tiene crédito. Recárgalo en la consola de la API (Plans & billing) o crea el secreto `CLAUDE_CODE_OAUTH_TOKEN` con `claude setup-token` desde una cuenta con suscripción; el workflow acepta cualquiera de los dos. Fue el motivo real de la primera ejecución (PR #8, 2026-09-19).
   - Modelo no encontrado o sin permiso: la clave no tiene acceso al modelo fijado en `claude_args`. Cambia el modelo o pide acceso en la consola.
   - `authentication_error` o `invalid x-api-key`: el secreto está vacío o caducado. Vuelve a crearlo.
2. Si la vía elegida es Actions, ejecuta **Actions > Rutinas nocturnas > Run workflow** con la rutina `cronista`. La página del ciclo en curso debe recibir un resumen de dirección nuevo.

**Precaución:** Los secretos no se copian nunca al repositorio, a `.env.example`, a los prompts ni a los registros de los workflows.
