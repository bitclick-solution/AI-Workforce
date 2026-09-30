LISTO PARA ENCARGO

# Especificación · Tarifas de Opus 5 en Bedrock UE y Vertex UE con los precios de la consola

- Rebanada: [Notion](https://app.notion.com/p/3eb5306618988196a448cd42487728e6) · Ciclo 1 · Tipo Plataforma · Paquetes `ledger`, `docs` · P1
- Rama: `rebanada/tarifas-opus-5`
- Plan de referencia: ADR-017 (residencia UE), ADR-018 (coste por tarea con tarifa versionada), ADR-023. Especificación de Modelos v1, sección «Tarifas reales de Bedrock UE».
- Zona crítica: sí — tarifas del contador (`packages/ledger`). Marca «Revisión humana obligatoria».

## Objetivo

El catálogo de desarrollo del contador lleva los precios de Opus 5 que Jesús confirma el 30-9: AWS 5,00 / 25,00 USD por millón de tokens (entrada / salida) y Google Cloud 0,40 USD más en cada columna. Hoy lleva 5,50 / 27,50 USD en Bedrock y la lista pública en Vertex. Cuando llegue la cuota de Opus 5, el contador cobra el precio de la consola.

## Paquetes tocados

- `packages/ledger`: `src/datos/tarifas-ejemplo.json` (dos filas nuevas) y su prueba.
- `docs`: esta especificación y una nota en la de Modelos v1.

## Endpoints, flujos y datos

Sin endpoints, sin flujos y sin migración. Una tarifa se versiona, no se reescribe: las dos filas nuevas tienen `vigenteDesde` del 2026-09-30 y las anteriores se quedan, así que los importes ya cobrados no cambian (`tarifaVigente` elige la de mayor `vigente_desde` que no sea posterior al uso). Importes, en USD por millón y en euros al tipo de referencia de 0,92 EUR/USD:

| Columna                  | AWS (USD) | AWS (EUR) | Vertex (USD) | Vertex (EUR) |
| ------------------------ | --------- | --------- | ------------ | ------------ |
| Entrada                  | 5,00      | 4,60      | 5,40         | 4,968        |
| Salida                   | 25,00     | 23,00     | 25,40        | 23,368       |
| Caché leída              | 0,50      | 0,46      | 0,90         | 0,828        |
| Escritura de caché 5 min | 6,25      | 5,75      | 6,65         | 6,118        |
| Escritura de caché 1 h   | 10,00     | 9,20      | 10,40        | 9,568        |

## Criterios de hecho

1. `claude-opus-5` en `bedrock-eu` tiene una fila con los importes de la columna AWS.
2. `claude-opus-5` en `vertex-eu` tiene una fila con los importes de la columna Vertex.
3. Las filas anteriores no cambian; las nuevas llevan `vigenteDesde` posterior.
4. Una prueba fija los importes y comprueba que los euros son el precio de origen por el tipo de cambio.
5. Ningún endpoint, residencia ni modelo servido cambia.
6. `pnpm lint`, `typecheck`, `test`, `evals:smoke` y `build` en verde.

## Casos de prueba y de eval

- Unitario: `contador.test.ts`, «catálogo de tarifas» (importes de las dos filas, conversión, filas antiguas intactas). La prueba de las filas del 25-9 se acota a esa fecha: las nuevas son de inferencia entre regiones y no llevan una región única.
- Eval: sin comportamiento de agente nuevo.
- Auditoría y contador: sin cambios de código. Cada `registrarTarifa` que cargue Operación deja su entrada en el libro, como hasta ahora.
- Secretos: no aplica, solo datos públicos de precios.

## Fuera de alcance

- **Cargar la fila en un tenant que ya tiene la vieja.** El catálogo es de desarrollo: un tenant ya sembrado sigue con su fila hasta que Operación dé de alta la nueva con `registrarTarifa` (mismo proveedor, modelo y plataforma, `vigenteDesde` del 30-9). Que `bitclick:sembrar` cargue una fila más nueva del catálogo cuando ya existe otra es un cambio pequeño de la siembra, que llega con el PR #57.
- Precios de Sonnet 4.6 y Haiku 4.5 (los que hoy se cobran en Bedrock): Jesús no los ha dado. Siguen los del 25-9.
- Cualquier cambio de endpoint. Jesús dice que estos precios son los de la inferencia global entre regiones. Los endpoints globales no garantizan la residencia UE (ADR-017; el arranque de Vertex rechaza `global`): esta rebanada solo cambia importes.
- El tipo de cambio: 0,92 sigue siendo el de referencia; Operación lo sustituye por el versionado real.

## Presupuesto de tokens

Presupuesto: 3 €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

Ninguna.
