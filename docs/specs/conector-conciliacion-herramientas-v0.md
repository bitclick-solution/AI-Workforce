VIGENTE

# Especificación · Herramientas de conciliación bancaria en los conectores

- Rebanada: [Notion](https://app.notion.com/p/3eb53066189881fba024ef6665622736) · Ciclo 2 · Tipo Conector · Paquetes `connectors/odoo`, `connectors/factusol`, `connectors/demo` · P1
- Rama: `rebanada/conector-conciliacion-herramientas-v0`
- Plan de referencia: frontera «plano de control agnóstico del ERP» del [ADR-001](../adr/ADR-001.md); niveles por clase de acción del [ADR-005](../adr/ADR-005.md). Patrón: [Conector Odoo v0](conector-odoo-v0.md) y [Conector Factusol v0](conector-factusol-v0.md). Herramientas y guardrails de la [ficha de Finanzas](../producto/finanzas.md).
- Zona crítica: no. No toca `packages/mcp-gateway`, `packages/ledger` ni migraciones. El nivel de cada herramienta por puesto lo fija el gateway, no el conector.

## Objetivo

La plantilla `finanzas.conciliacion-bancaria` ya declara `leer_extracto_bancario` y `proponer_asiento_diferencia`, pero ningún conector las sirve: el caso dorado `conciliacion-001` comprueba justo eso, que el agente dice «me falta el extracto» en vez de inventar un cobro. Esta rebanada añade las dos herramientas a `connectors/odoo` y a `connectors/demo`, con un solo contrato, para que la CI y el caso dorado corran sobre datos falsos. **Factusol queda fuera** (ver «Decisiones de construcción»): Factusol MCP 3.4.7 no tiene movimientos bancarios ni asientos. Con ellas, el puesto puede casar apuntes de verdad.

## Paquetes tocados

- `connectors/odoo`: las dos herramientas sobre el MCP de Odoo, con mapeo, errores e idempotencia como las dos de cobros.
- `connectors/factusol`: **fuera de alcance**. Solo cambia su README (variables de entorno, mejora 9 para Factusol MCP). Ver «Decisiones de construcción».
- `connectors/demo`: las dos herramientas sobre un extracto inventado, con fallo inyectable, que es la referencia del contrato compartido.

## Endpoints, flujos y datos

Sin endpoints, sin flujos, sin tablas ni migraciones. Contrato común; los nombres de campo son los del dominio.

1. `leer_extracto_bancario` (lectura).
   - Entrada: `{ cuenta_id?: texto, desde?: YYYY-MM-DD, hasta?: YYYY-MM-DD, solo_sin_casar?: booleano (por defecto true), limite?: entero 1–200 (por defecto 50) }`. `hasta` anterior a `desde` es `invalido`.
   - Salida: `{ apuntes: [{ id, cuenta_id, fecha, concepto, importe, moneda, casado, documento_id }], total }`. `importe` con signo y dos decimales; `moneda` ISO 4217; `documento_id` es `null` si no está casado. Ordenados del más antiguo al más reciente.
2. `proponer_asiento_diferencia` (escritura, siempre borrador).
   - Entrada: `{ apunte_id, documento_id, importe_diferencia (distinto de cero, dos decimales), cuenta_contrapartida, motivo (1 a 500 caracteres, sin HTML), clave_idempotencia?: texto }`.
   - Salida: `{ id, apunte_id, estado: 'borrador', creado_en (ISO 8601) }`. El conector nunca contabiliza ni confirma el asiento: una persona lo hace en el ERP con sus credenciales (ficha de Finanzas, clase «Alto»). Sin `documento_id` o sin `cuenta_contrapartida` sale `invalido` y no llega al ERP.
   - Con la misma `clave_idempotencia` devuelve el mismo `id` sin crear un segundo borrador; con la misma clave y otros datos sale `invalido`.
3. Identificadores: cadenas con el identificador nativo del ERP (`"301"` en Odoo), como en `connectors/factusol`. `cuenta_id` es el diario de banco; `cuenta_contrapartida`, el código de la cuenta contable (por ejemplo `629000`). Una diferencia positiva es que el banco recibió más que el documento: va al debe del banco. En Odoo, `documento_id` de un apunte casado es el asiento propio del apunte.
4. Errores, credenciales e idempotencia: igual que en Odoo. Todo fallo es un error MCP con `datos.motivo` en `{ no_encontrada, no_autorizado, temporal, invalido }`; solo `temporal` es reintentable; el detalle nativo se recorta a la primera línea y 300 caracteres; las credenciales llegan solo por entorno.

## Criterios de hecho

1. `odoo` y `demo` anuncian sus herramientas de cobros más estas dos, con esquemas Zod idénticos en forma; un test compara los dos (`connectors/odoo/src/contrato-comun.test.ts`). Factusol no las anuncia.
2. `leer_extracto_bancario` devuelve los apuntes ordenados, con `total` igual al número devuelto; con `solo_sin_casar` no aparece ninguno con `casado: true`; una entrada fuera de rango sale `invalido` sin llegar al ERP.
3. `proponer_asiento_diferencia` crea solo un borrador y devuelve `estado: 'borrador'`; ninguna ruta del código llama a la contabilización del ERP (lo comprueba una prueba sobre las llamadas registradas).
4. La idempotencia, los cuatro motivos de error y el recorte del detalle nativo se comportan como en `connectors/odoo`.
5. Ninguna salida ni registro contiene el valor de una credencial: prueba de rastreo como `connectors/odoo/src/secretos.test.ts`.
6. Las pruebas de contrato contra el ERP real corren solo con credenciales presentes y se saltan diciendo qué falta; en la CI corren sobre grabaciones de `src/grabaciones/` con datos inventados y sin datos personales reales.
7. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm evals:smoke` y `pnpm build` pasan en verde, y `conciliacion-001` sigue certificado.

## Casos de prueba y de eval

- Unitario: esquemas de entrada y salida; orden y recorte por `limite`; filtro `solo_sin_casar`; borrador sin documento o sin contrapartida; importe cero; idempotencia con misma clave y otros datos, con dos llamadas simultáneas y tras una escritura fallida.
- Contrato: las dos herramientas contra Odoo (empresa de pruebas de Bitclick); en la CI, contra grabaciones.
- Eval: sin comportamiento de agente nuevo; `conciliacion-001` no baja. El caso nuevo con extracto real es de «Conciliación bancaria sobre el extracto real».
- Auditoría y contador: las emite el gateway; el conector no escribe en `packages/ledger`.
- Secretos: criterio 5, más `gitleaks` en la CI.

## Fuera de alcance

- Puestos, prompts y casos dorados: «Conciliación bancaria sobre el extracto real: caso dorado conciliacion-002 y plantilla actualizada».
- Conector bancario directo por PSD2: fuera de la primera versión (ficha de Finanzas).
- Contabilizar, anular o modificar asientos, pagos y remesas: no se ofrecen a ningún agente.
- Herramientas de previsión de tesorería: «Herramientas de previsión de tesorería en los conectores».
- Registrar las herramientas en la lista blanca del gateway y fijar su nivel por puesto: rebanada de registro, como en Odoo.

## Decisiones de construcción (2-10)

1. **Factusol no se implementa.** El informe del Probador (rebanada «Conector Factusol v0», «Descubrimiento de Factusol MCP (1-10)») lista las 97 herramientas de Factusol MCP 3.4.7: ninguna lee movimientos bancarios ni crea asientos. Solo hay `list_bancos`/`get_banco` (cuentas propias), `draft_registrar_cobro_factura`, `draft_registrar_pago_factura_recibida` y `list_documentos_por_importe`, que no equivalen al contrato. No se simula. Se añade como mejora 9 en el README del conector. Los criterios 1 y 6 se cumplen para `odoo` y `demo`.
2. **Odoo.** `leer_extracto_bancario` lee `account.bank.statement.line` con `search_records`. `proponer_asiento_diferencia` lee apunte, documento, diario y cuenta (por código) y crea un `account.move` de tipo `entry` por `preview_write` → `validate_write` → `execute_approved_write`, sin `state` ni contabilización. El mapeo está en el README del conector.
3. **Sin contabilizar.** El asiento queda en borrador y lo publica una persona en el ERP.
4. **Grabaciones sin contrastar.** La empresa de pruebas de Odoo no tenía extractos importados. Las grabaciones usan la forma real del MCP dinámico (envolvente `result`) con datos inventados, pero la forma de `account.bank.statement.line` no se ha visto en una instancia. Falta que Jesús importe un extracto ficticio para que el Probador verifique la lectura y la escritura reales, y confirme `documento_id` de los apuntes casados.

## Presupuesto de tokens

Presupuesto: 45 €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

¿La empresa de pruebas de Odoo de Bitclick (ADR-024) tiene extractos bancarios importados con datos ficticios? Si no, el Constructor necesita que se carguen antes de grabar las respuestas de contrato de `leer_extracto_bancario`.
