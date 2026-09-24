VIGENTE

# Runbook · Promocionar y revertir una lección del aprendizaje v0

Cómo convertir a mano una lección propuesta en una versión nueva de un puesto, y cómo volver atrás. En v0 ninguna lección se promociona sola: la promociona una persona y la puerta del Evaluador la certifica o la bloquea ([especificación](../specs/aprendizaje-v0.md)).

## Requisitos previos

- PostgreSQL migrado y `DATABASE_URL` en el entorno (`pnpm dev:up` en desarrollo).
- La bandera `AIW_APRENDIZAJE_V0=1`.
- El identificador de la organización (`--tenant` o `AIW_TENANT`) y el tuyo como persona de esa organización (`--persona` o `AIW_PERSONA`). La promoción queda a tu nombre en el libro de auditoría.

## Ver el expediente del puesto

```bash
pnpm --filter @aiw/worker aprendizaje expediente <puestoId> --tenant <tenantId>
```

Muestra la versión activa, todas las versiones y cada lección con su estado derivado: `propuesta`, `vigente` o `retirada`.

## Promocionar una lección

1. Lee la línea de la lección en el expediente. Es exactamente lo que verán las tareas siguientes bajo «Lo que ya sabes».
2. Promociónala:

   ```bash
   pnpm --filter @aiw/worker aprendizaje promocionar <leccionId> \
     --persona <personaId> --tenant <tenantId> --motivo "por qué"
   ```

3. Comprueba que todos los casos salen `ok`. Si alguno sale `NO`, el Evaluador bloqueó la promoción: no se creó ninguna versión y el libro tiene `aprendizaje.promocion.bloqueada` con los casos que fallaron.

Las tareas que ya estaban en curso siguen con su versión. La siguiente tarea del puesto arranca con la nueva.

## Revertir a otra versión

```bash
pnpm --filter @aiw/worker aprendizaje revertir <puestoId> --a <versionPuestoId> \
  --persona <personaId> --tenant <tenantId> --motivo "por qué"
```

El mandato mueve el puntero de la versión activa, caduca la memoria viva de las lecciones retiradas y anota `aprendizaje.version.revertida` con cada lección retirada o repuesta. No borra ni modifica ninguna versión: puedes volver a la versión nueva con el mismo mandato.

## Errores esperados

| Código            | Qué significa                                           | Qué haces                                            |
| ----------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| `ya_promocionada` | La lección ya tiene su versión.                         | Para recuperarla tras revertir, vuelve a su versión. |
| `sin_persona`     | Falta la persona o no pertenece a la organización.      | Pasa `--persona` con tu identificador.               |
| `version_ajena`   | La versión de destino es de otro puesto.                | Copia el identificador desde el expediente.          |
| `ya_activa`       | La versión de destino ya es la activa.                  | Nada.                                                |
| `no_encontrada`   | La lección o la versión no existen en esa organización. | Revisa `--tenant`.                                   |
