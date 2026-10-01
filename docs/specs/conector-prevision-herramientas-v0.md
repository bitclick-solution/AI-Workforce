VIGENTE

# Especificación · Herramientas de previsión de tesorería en los conectores

- Rebanada: [Notion](https://app.notion.com/p/3eb53066189881fa9e75f370b400d66f) · Ciclo 2 · Tipo Conector · Paquetes `connectors/odoo`, `connectors/factusol`, `connectors/demo` · P1
- Rama: `rebanada/conector-prevision-herramientas-v0`
- Plan de referencia: frontera «plano de control agnóstico del ERP» del [ADR-001](../adr/ADR-001.md). Patrón: [Conector herramientas de conciliación](conector-conciliacion-herramientas-v0.md), [Conector Odoo v0](conector-odoo-v0.md) y [Conector Factusol v0](conector-factusol-v0.md). Herramientas del puesto en la [ficha de Finanzas](../producto/finanzas.md).
- Zona crítica: no. No toca gateway, libro ni migraciones.

## Objetivo

La ficha de Previsión de tesorería lista lo que el puesto lee del ERP: vencimientos de cobro y de pago, historial de pago por cliente, nóminas e impuestos programados y saldos. Ningún conector lo sirve. Esta rebanada añade cuatro herramientas de solo lectura, con un contrato único para Odoo, Factusol y la demostración. No hay ninguna herramienta de escritura: el puesto de Previsión no escribe en ningún sistema.

## Paquetes tocados

- `connectors/odoo`, `connectors/factusol` y `connectors/demo`: las cuatro herramientas con mapeo, errores y grabaciones, como las de cobros y conciliación. La parte de Factusol espera al código de su adaptador.

## Endpoints, flujos y datos

Sin endpoints, flujos, tablas ni migración. Contrato común, con los nombres del dominio.

1. `listar_vencimientos` (lectura). Entrada: `{ tipo: 'cobro' | 'pago', desde?: YYYY-MM-DD, hasta: YYYY-MM-DD, limite?: 1–200 (50) }`. Salida: `{ vencimientos: [{ id, documento_id, tercero: { id, nombre }, importe_pendiente, moneda, fecha_vencimiento }], total }`, ordenados por fecha. Solo documentos con importe pendiente.
2. `leer_historial_de_pago` (lectura). Entrada: `{ cliente_id, meses?: 1–36 (12) }`. Salida: `{ cliente_id, facturas_pagadas, dias_medios_de_pago, dias_maximos_de_pago, ultimos_pagos: [{ documento_id, fecha_vencimiento, fecha_cobro, importe }] }`. Calculado por el conector; el agente no recalcula estadísticas sobre facturas sueltas.
3. `listar_obligaciones_programadas` (lectura). Entrada: `{ desde?: YYYY-MM-DD, hasta: YYYY-MM-DD }`. Salida: `{ obligaciones: [{ id, tipo: 'nomina' | 'impuesto' | 'otro', descripcion, fecha, importe_estimado, moneda }], total }`. **Las nóminas salen agregadas por fecha, sin nombre ni importe por persona**: el puesto no necesita datos de empleados y su tratamiento queda fuera de la primera versión (ficha de Finanzas).
4. `leer_saldos` (lectura). Entrada: `{ cuenta_id?: texto }`. Salida: `{ saldos: [{ cuenta_id, nombre, saldo, moneda, fecha_saldo }] }`.

Errores, credenciales e idempotencia como en Odoo: cuatro motivos `{ no_encontrada, no_autorizado, temporal, invalido }`; solo `temporal` es reintentable; detalle nativo recortado; credenciales solo por entorno. No aplica idempotencia de escritura, porque no hay escritura.

## Criterios de hecho

1. Cada conector anuncia sus herramientas anteriores más estas cuatro, con esquemas Zod idénticos en forma entre `odoo`, `factusol` y `demo`; un test compara los tres.
2. Ninguna de las cuatro puede escribir: una prueba sobre las llamadas registradas comprueba que no hay ninguna operación de creación, modificación ni borrado en el ERP.
3. `listar_vencimientos` devuelve solo documentos con importe pendiente, ordenados por fecha; `hasta` anterior a `desde` o `tipo` desconocido salen como `invalido` sin llegar al ERP.
4. `listar_obligaciones_programadas` no devuelve ningún campo con nombre o identificador de empleado: lo comprueba una prueba sobre el esquema de salida y sobre una grabación con nóminas.
5. Los cuatro motivos de error y el recorte del detalle nativo se comportan como en Odoo.
6. Ninguna salida ni registro contiene una credencial: prueba de rastreo como `connectors/odoo/src/secretos.test.ts`.
7. Las pruebas de contrato contra el ERP real corren solo con credenciales presentes y se saltan diciendo qué falta; en la CI, contra grabaciones con datos inventados y sin datos personales reales.
8. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm evals:smoke` y `pnpm build` pasan en verde.

## Casos de prueba y de eval

- Unitario: esquemas y límites; orden; `meses` y `limite` fuera de rango; cálculo de días medios y máximos con historial vacío, con un pago y con varios; obligaciones agregadas.
- Contrato: las cuatro herramientas contra Odoo (empresa de pruebas) y, cuando exista, Factusol; en la CI, grabaciones.
- Eval: sin comportamiento de agente nuevo; el caso del puesto es de «Puesto Previsión de tesorería».
- Auditoría y contador: las emite el gateway; el conector no escribe en `packages/ledger`.
- Secretos: criterio 6 y `gitleaks` en la CI.

## Fuera de alcance

- La plantilla, el prompt y el caso dorado de Previsión: «Puesto Previsión de tesorería: ficha, prompt y certificación».
- Datos de nóminas por persona, y cualquier escritura.
- Herramientas de indicadores materializados: [Cuadro de mando de finanzas](https://app.notion.com/p/3e05306618988106bd79fe5679d77427) (otro ciclo).
- Registrar las herramientas en la lista blanca del puesto y fijar su nivel: rebanada de registro, como en Odoo.

## Presupuesto de tokens

Presupuesto: 40 €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

¿La empresa de pruebas de Odoo tiene vencimientos de pago, nóminas y saldos ficticios además de los extractos? Sin ellos, la carga que ya es requisito previo de las herramientas de conciliación debe cubrirlos también.
