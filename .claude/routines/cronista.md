VIGENTE

# Rutina nocturna · Cronista

Prompt que ejecuta cada noche `.github/workflows/rutinas-nocturnas.yml` con el rol `.claude/agents/cronista.md`. También se puede lanzar a mano desde Claude Code pegando el bloque siguiente.

```text
Actúa como el Cronista definido en .claude/agents/cronista.md y sigue CLAUDE.md. Hoy es la fecha del sistema. Esfuerzo bajo: lee solo lo necesario y no vuelques ficheros completos.

1. Reconcilia GitHub con Notion.
   - Lista los PR del repositorio (abiertos, fusionados y cerrados en los últimos 3 días).
   - Para cada PR, localiza su rebanada por el campo PR de la base Rebanadas (collection://c028362d-e6a6-4930-bb4f-fe7976f9931a).
   - PR fusionado: pasa la rebanada a Hecha y pon Fin con la fecha de fusión. Actualiza Especificación al enlace en main.
   - PR abierto con rebanada en En curso: pásala a En revisión y enlaza el PR.
   - PR cerrado sin fusionar: pasa la rebanada a Lista y anota en Bloqueo "PR #N cerrado sin fusionar: <motivo si consta>".
   - PR sin rebanada o rebanada con dos PR: no lo arregles; anótalo en el resumen.
2. Replica los ADR. Para cada fila de Decisiones (collection://f37cc833-a27f-48ea-b76f-53adc9162c5d) cuya redacción difiera de docs/adr/ADR-NNN.md o que no tenga archivo, prepara la copia literal en la rama cronista/adr-<fecha> y abre un PR titulado "docs: ADR sincronizados <fecha>". Actualiza el campo Repositorio con el enlace al archivo.
3. Si hoy es viernes, crea la fila de Métricas semanales (collection://414d5339-8f25-466e-9373-a68573669d07) de la semana: rebanadas hechas, rebanadas planificadas en el ciclo, tiempo medio de ciclo (Inicio a Fin) de las hechas, suma de Coste real (€), errores en producción (0 mientras no haya producción), objetivo del ciclo cumplido sí/no según la página del ciclo. Deja Horas de Jesús en blanco.
4. Escribe el Resumen de dirección en la página del ciclo en curso (base Ciclos, collection://94eb9b8a-ab80-4ed3-a028-99131fcdbb9d, Estado En curso), sustituyendo el anterior. Quince líneas como máximo, con este orden:
   - Fecha y ciclo.
   - Hecho desde el último resumen (rebanadas y PR).
   - En revisión: PR esperando al Revisor y PR esperando a Jesús, con días de espera. Si hay más de tres esperando a Jesús durante dos días seguidos, primera línea en mayúsculas: "PARAR PRODUCCIÓN DE REBANADAS NUEVAS HASTA VACIAR LA COLA".
   - Bloqueadas: rebanada, motivo y a quién bloquea.
   - Riesgos (collection://334d9f9b-c17c-444c-bee8-9fcddc0fcf36) con señal activada, si consta.
   - Decisiones pendientes para el próximo miércoles.
   - Consumo de tokens del ciclo frente a la suma de presupuestos.
5. Termina con una línea en el registro de la ejecución: fecha, número de transiciones aplicadas, PR de ADR abierto sí/no. Sin preguntas: si algo no encaja, va al resumen.

Prohibido: cambiar código, pasar rebanadas a Lista o Demostrada, fusionar, borrar contenido del tablero.
```
