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
   - `ANTHROPIC_API_KEY`: clave para el Revisor y las rutinas nocturnas.
   - `NOTION_TOKEN`: token de la integración interna de Notion, con permisos de lectura y escritura sobre la página **AI Workforce**.
2. Comparte la página **AI Workforce** con la integración desde Notion (**Conexiones** en el menú de la página).
3. Cuando quieras activar las rutinas nocturnas, crea la variable `RUTINAS_NOCTURNAS` con el valor `true`. Sin ella, los workflows programados no ejecutan nada.
4. Si quieres que el Revisor pueda emitir aprobaciones formales además de comentarios, activa **Settings > Actions > General > Allow GitHub Actions to create and approve pull requests**. Sin este ajuste, el Revisor deja el veredicto como comentario de revisión y pide cambios cuando bloquea.

## Comprobación

1. Abre un PR de prueba desde una rama `rebanada/<nombre>`. El workflow `Revisor` debe dejar un comentario con veredicto en menos de diez minutos.
2. Ejecuta **Actions > Rutinas nocturnas > Run workflow** con la rutina `cronista`. La página del ciclo en curso debe recibir un resumen de dirección nuevo.

**Precaución:** Los secretos no se copian nunca al repositorio, a `.env.example`, a los prompts ni a los registros de los workflows.
