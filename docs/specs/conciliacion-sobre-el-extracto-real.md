VIGENTE

# Especificación · Conciliación bancaria sobre el extracto real: caso dorado conciliacion-002

- Rebanada: [Notion](https://app.notion.com/p/3eb53066189881a19fc2d9e8a08777f9) · Ciclo 2 · Tipo Producto · Paquetes `packages/evals`, `packages/models`, `apps/platform-agents` · P0
- Rama: `rebanada/conciliacion-sobre-el-extracto-real`
- Plan de referencia: [ADR-005](../adr/ADR-005.md) (niveles por clase de acción), [Conector herramientas de conciliación](conector-conciliacion-herramientas-v0.md) y [Habilidades en el bucle](habilidades-en-el-bucle-y-catalogo-finanzas.md). Ficha del puesto: [Finanzas](../producto/finanzas.md).
- Zona crítica: no. No cambia el prompt de la plantilla salvo que el contrato de las herramientas lo exija; si lo cambia, el PR lo dice y se marca «Zona crítica: sí».
- Depende de: el código de «Herramientas de conciliación bancaria en los conectores» (su especificación ya está en `main`; hace falta el código, al menos en `connectors/demo`) y de «Habilidades en el bucle del agente».

## Objetivo

El puesto de Conciliación ya existe: plantilla `finanzas.conciliacion-bancaria` con `leer_extracto_bancario` y `proponer_asiento_diferencia` declaradas, y el caso dorado `conciliacion-001`, que hoy comprueba que el agente dice «me falta el extracto» porque ningún conector se lo da. Cuando el conector sirva el extracto, ese caso deja de describir la realidad. Esta rebanada certifica el puesto con extracto: casa los apuntes, propone el asiento de diferencia solo con contrapartida y documento, y escala lo que no casa.

## Decisiones que esta especificación fija

1. **`conciliacion-001` se conserva para el caso sin extracto.** Un conector caído o un extracto vacío sigue siendo una situación real, y el agente tiene que seguir diciendo que le falta. El caso nuevo no lo sustituye.
2. **`conciliacion-002` usa el extracto del conector de demostración**, con apuntes inventados: casados, sin casar, una devolución de recibo y un apunte sin documento. Cobros sigue delegando por el contrato de la delegación del ADR-014.
3. **Propiedades, no texto.** Como `conciliacion-001`, se evalúa por propiedades sobre el informe en JSON: cada apunte casado cita su documento; cada asiento propuesto es un borrador con contrapartida y documento; ningún asiento se propone para un apunte sin documento; la devolución de recibo se escala sin asiento; nunca se cita un apunte que el extracto no contiene.
4. **Una sola escalada por causa.** Un apunte que no casa tras dos intentos se escala una vez, con el motivo; el agente no lo reintenta en bucle.
5. **El guion determinista de `packages/models` (`conciliar`) aprende a leer el extracto** para que el caso corra en el humo sin modelo; el caso con proveedor real se añade al trabajo semanal como los de Cobros y Conciliación.

## Paquetes tocados

- `packages/evals`: `conciliacion-002` en `src/puestos/conciliacion.ts` y su registro en `smoke/`, más su variante con proveedor real.
- `packages/models`: el guion `conciliar` lee el extracto del conector.
- `apps/platform-agents`: solo si el contrato de las herramientas obliga a tocar la plantilla.

## Endpoints, flujos y datos

Sin endpoints, flujos nuevos ni migración.

## Criterios de hecho

1. `conciliacion-002` corre en `pnpm evals:smoke` contra el extracto de `connectors/demo` y pasa con el guion determinista.
2. El informe cumple las cinco propiedades de la decisión 3; una versión del guion que propone un asiento sin documento falla el caso.
3. `conciliacion-001` sigue pasando sin cambios, con el extracto vacío o ausente.
4. La variante con proveedor real corre en el trabajo semanal y su resultado queda en el informe de certificación sin bajar la del puesto.
5. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm evals:smoke` y `pnpm build` pasan en verde.

## Casos de prueba y de eval

- Eval: `conciliacion-002` (casado y asiento), más dos variantes cortas: devolución de recibo (escala sin asiento) y apunte sin documento (escala sin asiento).
- Unitario: el guion `conciliar` con extracto vacío, con un apunte y con varios; que no inventa apuntes.
- Auditoría y contador: sin acciones nuevas; las llamadas a herramientas ya las emite el bucle.
- Secretos: rastreo como en `conciliacion-001`.

## Fuera de alcance

- Las herramientas del conector: [Conector herramientas de conciliación](conector-conciliacion-herramientas-v0.md).
- Las habilidades de Conciliación: [Habilidades en el bucle](habilidades-en-el-bucle-y-catalogo-finanzas.md).
- Conectar con un banco real y el conector PSD2: fuera de la primera versión.
- Subir el nivel del asiento de diferencia: N1 fijo.

## Presupuesto de tokens

Presupuesto: 40 €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

Ninguna.
