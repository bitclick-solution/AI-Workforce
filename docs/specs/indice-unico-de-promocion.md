VIGENTE

# Especificación · Índice único de promoción: una lección se promociona una sola vez

- Rebanada: [Notion](https://app.notion.com/p/3e5530661898818c870bef692e63b581) · Ciclo 0 · Tipo Datos · Paquetes `db`, `learning` · P1
- Rama: `rebanada/indice-unico-de-promocion`
- Plan de referencia: [ADR-005](../adr/ADR-005.md) (aprendizaje acotado, versiones inmutables con reversión) y [ADR-007](../adr/ADR-007.md) (filas inmutables). Especificación de origen: [Aprendizaje v0](aprendizaje-v0.md), que deja el índice pendiente en su «Pregunta abierta».
- Zona crítica: sí, migración de datos. «Revisión humana obligatoria» marcada.

## Objetivo

Hoy el invariante «una lección no se promociona dos veces» lo sostiene solo
`promocionarLeccion`, con un bloqueo por puesto. Esta rebanada lo sostiene también la
base: un `INSERT` en `promocion` para una lección ya promocionada falla aunque quien
inserte no pase por la aplicación, y `promocionarLeccion` traduce ese fallo al mismo
error de dominio que ya usa para el camino que sí pasa por la aplicación.

## Paquetes tocados

- `packages/db`: migración `0002_indice_unico_de_promocion` (con su reverso) que
  sustituye el índice único `promocion_tenant_leccion_version_key`
  `(tenant_id, leccion_id, version_puesto_resultante_id)` por
  `promocion_tenant_leccion_key` `(tenant_id, leccion_id)`; el esquema Drizzle de
  `promocion` se actualiza a juego.
- `packages/learning`: `promocionarLeccion` atrapa la violación de unicidad del
  `INSERT` en `promocion` y la traduce a `ErrorDeAprendizaje('ya_promocionada', …)`,
  igual que `registrarDecision` hace con `decision_aprobacion` en `packages/ledger`.

## Endpoints, flujos y datos

Migración `0002_indice_unico_de_promocion.sql` y su reverso en `drizzle/reverso/`.
Sin cambio de columnas ni de tipos: solo el índice único de `promocion`.

## Criterios de hecho

1. La migración 0002, con su reverso, crea un índice único `(tenant_id, leccion_id)`
   sobre `promocion`.
2. Un segundo `INSERT` de promoción para la misma lección falla en la base aunque la
   aplicación no lo compruebe.
3. `promocionarLeccion` traduce esa violación a `ya_promocionada`.
4. La prueba de migración y la de aislamiento siguen en verde.
5. Entra antes de la revisión del viernes 2 de octubre de 2026.

## Casos de prueba y de eval

- Migración (`packages/db`): aplicarla dos veces no cambia nada; el índice único
  `promocion_tenant_leccion_key` existe sobre `(tenant_id, leccion_id)` y ya no existe
  `promocion_tenant_leccion_version_key`; un segundo `INSERT` en `promocion` con el
  mismo `tenant_id` y `leccion_id` pero distinto `version_puesto_resultante_id`,
  hecho por SQL directo sin pasar por `promocionarLeccion`, falla con `23505`; el
  reverso deja la base como antes (el índice viejo vuelve, el nuevo desaparece) y las
  pruebas de la migración inicial (0000/0001) siguen en verde.
- Integración (`packages/learning`): el camino ya cubierto en
  `aprendizaje.test.ts` («una lección ya promocionada no se promociona otra vez») que
  hoy pasa por la comprobación previa de la aplicación sigue en verde tras cambiar el
  índice. Se añade un caso que fuerza el camino de la base: inserta una fila de
  `promocion` para la lección por SQL directo (sin pasar por `promocionarLeccion`, que
  es como se comprueba que el invariante no depende de que la aplicación lo mire) y
  comprueba que una llamada a `promocionarLeccion` para esa misma lección se rechaza
  con `ya_promocionada`.
- Auditoría y contador: sin cambio de comportamiento; el criterio 6 de
  `aprendizaje-v0.md` (cadena verificada y contador sumado) sigue cubierto por sus
  pruebas existentes, que no se tocan.
- Secretos: no aplica; esta rebanada no toca datos personales ni credenciales.

## Fuera de alcance

- Cualquier cambio de comportamiento de `promocionarLeccion` más allá de traducir la
  violación de unicidad: el bloqueo por puesto, la puerta del Evaluador y el resto del
  flujo no cambian.
- Migrar más columnas o tablas: solo el índice de `promocion`.

## Presupuesto de tokens

Presupuesto: 10 €. Consumo real: se registra en la rebanada al abrir el PR. Superar
el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.
