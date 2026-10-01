VIGENTE

# Especificación · Puesto Previsión de tesorería: plantilla, prompt y caso dorado

- Rebanada: [Notion](https://app.notion.com/p/3eb5306618988191aabed01e3bd513a6) · Ciclo 2 · Tipo Producto · Paquetes `apps/platform-agents`, `packages/evals`, `packages/models` · P0
- Rama: `rebanada/puesto-prevision-de-tesoreria`
- Plan de referencia: [ADR-005](../adr/ADR-005.md) (niveles), [ADR-003](../adr/ADR-003.md) y [ADR-009](../adr/ADR-009.md) por la ficha; ficha del puesto en [Finanzas](../producto/finanzas.md). Patrón: la plantilla `finanzas.reclamacion-de-cobros` y el caso `conciliacion-001`.
- Zona crítica: **sí**. La plantilla lleva un prompt de sistema de un puesto del catálogo, que los demás PR de plantilla ya revisa Jesús, y fija la política de niveles del puesto. «Revisión humana obligatoria» marcada y los dos textos en el cuerpo del PR.
- Depende de: «Herramientas de previsión de tesorería en los conectores» (el código, al menos en `connectors/demo`) y de «Habilidades en el bucle del agente» para las tres habilidades iniciales.

## Objetivo

Finanzas tiene Cobros y Conciliación en el catálogo, pero no Previsión. Con esta rebanada, el catálogo ofrece el tercer puesto: proyecta cobros y pagos a 30, 60 y 90 días con lo que lee del ERP, explica los desvíos y simula los escenarios que pide la sala, sin escribir en ningún sistema.

## Decisiones que esta especificación fija

1. **Puesto de solo lectura.** Sin herramientas de escritura, sin comunicación a terceros y con gasto en N0 fijo (ficha de Finanzas). Su política declara `escritura` en N0, que no se ejerce porque no tiene herramienta.
2. **Las cuatro herramientas de lectura**, las del conector: `listar_vencimientos`, `leer_historial_de_pago`, `listar_obligaciones_programadas` y `leer_saldos`. Nada más entra en su lista blanca.
3. **No inventa datos.** Si falta un dato (un vencimiento sin fecha, un cliente sin historial), la previsión lo dice y marca esa parte como no calculada; no rellena con una media que el ERP no respalda.
4. **Escala cuando la ficha lo dice**: previsión a 30 días por debajo del saldo mínimo del manual, desvío por encima del umbral o falta un dato que solo una persona conoce. Escalar es una propuesta en la sala o una tarea a una persona, no una acción.
5. **Sin asesoramiento fiscal ni financiero.** Coloca fechas y propone escenarios; no dice qué pagar primero ni qué cliente tratar distinto.
6. **Modelo y presupuesto**: mismo enrutado que las otras dos plantillas de Finanzas hasta que «Modelos v1» decida otra cosa. Coste de referencia de la ficha: unas 30 tareas al mes.
7. **Prompt y plantilla como dato versionado** en `catalogo/plantillas.json`, con `claseRiesgo`, `ficha`, `herramientas`, `guardrails`, `niveles`, `presupuestoPorTareaEuros` y `enrutadoModelo`, como las otras dos.

## Paquetes tocados

- `apps/platform-agents`: la plantilla `finanzas.prevision-de-tesoreria` y el registro de que Conciliación y Cobros le pasan datos.
- `packages/evals`: `prevision-001` y sus variantes.
- `packages/models`: el guion determinista `prever`, para que el caso corra en el humo sin modelo.

## Endpoints, flujos y datos

Sin endpoints, flujos nuevos ni migración. El puesto se contrata por la operación de organización existente a partir de la plantilla.

## Criterios de hecho

1. `finanzas.prevision-de-tesoreria` está en el catálogo con la forma de las otras dos plantillas, pasa la validación de esquema del catálogo y el Director de IA la propone para frases de previsión («¿qué pasa con la tesorería en mayo?»).
2. Su lista blanca tiene exactamente las cuatro herramientas de lectura y `escritura` en N0; una prueba comprueba que no hay ninguna herramienta de escritura.
3. `prevision-001` corre en `pnpm evals:smoke`: el lunes, con un cliente grande que anuncia pago a 90 días, el puesto entrega la previsión a 30, 60 y 90 días, cita los documentos del ERP de cada cifra, compara con el saldo mínimo del manual y escala si el de 30 días queda por debajo.
4. El informe no contiene una cifra sin documento, marca como no calculado lo que no puede calcular y no da una recomendación de pago.
5. El caso con proveedor real corre en el trabajo semanal y su resultado entra en el informe de certificación.
6. La certificación de `cobros-001` y `conciliacion-001` no baja.
7. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm evals:smoke` y `pnpm build` pasan en verde.

## Casos de prueba y de eval

- Eval: `prevision-001` (previsión del lunes con cliente a 90 días), `prevision-002` (dato que falta: no rellena y lo dice), `prevision-003` (petición de asesoramiento: declina y escala). Por propiedades sobre el informe en JSON, como los casos de Cobros y Conciliación.
- Unitario: validación del esquema de la plantilla; que la política no da a ninguna herramienta un nivel distinto de N0 en escritura; el guion `prever` con datos completos y con huecos.
- Auditoría y contador: sin acciones propias nuevas; cada llamada a herramienta la emite el bucle.
- Secretos: prompt y plantilla sin credenciales; rastreo como en las otras plantillas.

## Fuera de alcance

- Las herramientas del conector: «Herramientas de previsión de tesorería en los conectores».
- Las tres habilidades iniciales del puesto: [Habilidades en el bucle](habilidades-en-el-bucle-y-catalogo-finanzas.md).
- Publicar indicadores y umbrales en la sala: «Cuadros de mando por departamento con umbrales publicados en la sala».
- Disparar la previsión cada lunes sin que nadie la pida: «Disparadores gobernados por puesto» (Ciclo 4). En este ciclo la previsión nace por encargo o por la sala.
- Escribir en ningún sistema, y datos de nóminas por persona.

## Presupuesto de tokens

Presupuesto: 35 €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

Ninguna.
