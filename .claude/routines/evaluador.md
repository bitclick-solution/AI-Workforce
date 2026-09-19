VIGENTE

# Rutina nocturna · Evaluador

Prompt de la rutina nocturna del Evaluador, con el rol `.claude/agents/evaluador.md`. Se ejecuta por una sola de estas dos vías, nunca por las dos a la vez (la decisión está en `docs/runbooks/proteccion-de-rama.md`): una Rutina de Claude Code que pega el bloque siguiente en una sesión, o el workflow `.github/workflows/rutinas-nocturnas.yml` como respaldo. También se puede lanzar a mano pegando el bloque en una sesión. Con el workflow, el servidor MCP de Notion es `@notionhq/notion-mcp-server`, que expone herramientas REST `API-*` en vez de las del MCP alojado; los identificadores `collection://...` del prompt son los UUID de las bases y valen igual como `data_source_id`.

```text
Actúa como el Evaluador definido en .claude/agents/evaluador.md y sigue CLAUDE.md. Hoy es la fecha del sistema. Esfuerzo medio. No llames a ningún modelo fuera de los casos de eval definidos en el repositorio.

1. Prepara el entorno: pnpm install --frozen-lockfile.
2. Ejecuta los evals de humo: pnpm evals:smoke. Guarda el resumen (casos, superados, fallidos, duración).
3. Ejecuta los evals por puesto disponibles en packages/evals (directorios distintos de smoke/) con su script, si existen. Si no existen, anótalo: "sin evals por puesto todavía".
4. Compara con la última certificación:
   - Busca el último informe del Evaluador en los comentarios de la página del ciclo en curso (base Ciclos, collection://94eb9b8a-ab80-4ed3-a028-99131fcdbb9d).
   - Cualquier caso dorado que pasaba y ahora falla es una regresión. La certificación de un puesto nunca baja en silencio.
5. Promociones pendientes del aprendizaje: si existe una lista de promociones pendientes (packages/learning o el panel), certifica cada una solo si pasa los casos dorados de su puesto y las últimas 50 tareas en sombra sin empeorar ninguna métrica; en caso contrario, bloquéala con el motivo. Si no existe todavía, anótalo.
6. Registra puntuaciones en Langfuse cuando las variables LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY y LANGFUSE_HOST estén definidas; si no, anótalo y sigue.
7. Publica el informe como comentario en la página del ciclo en curso, con este formato:
   - "Evals · <fecha>"
   - Humo: n casos, n superados, n fallidos.
   - Por puesto: tabla puesto, casos, superados, variación frente a la certificación anterior.
   - Regresiones: lista con caso, puesto y rebanada sospechosa (por fecha de fusión).
   - Promociones: certificadas y bloqueadas, con motivo.
8. Para cada regresión, escribe en el campo Bloqueo de la rebanada afectada (collection://c028362d-e6a6-4930-bb4f-fe7976f9931a): "Regresión de eval <caso> detectada el <fecha> por el Evaluador". Si la regresión afecta a un puesto en producción, ponla además en estado Bloqueada.
9. Termina con una línea: fecha, casos ejecutados, regresiones, promociones certificadas y bloqueadas.

Prohibido: editar código, prompts, especificaciones o casos dorados; promocionar versiones; pasar rebanadas a Lista, Demostrada o Hecha.
```
