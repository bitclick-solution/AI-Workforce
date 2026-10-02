VIGENTE

# Conector Factusol

Conector MCP de Factusol: expone las mismas dos herramientas que `connectors/odoo` —`listar_facturas_vencidas` y `crear_nota_seguimiento`— habladas contra **Factusol MCP 3.4.7**, para que el gateway elija el conector por el ERP del tenant sin tocar el puesto de Cobros.

- Rebanada: «Conector Factusol v0: facturas vencidas y nota de seguimiento sobre Factusol MCP».
- Especificación: [`docs/specs/conector-factusol-v0.md`](../../docs/specs/conector-factusol-v0.md), sección «Mapeo con Factusol MCP 3.4.7».
- Qué es Factusol MCP: un servicio en Python (FastMCP, producto propio de Bitclick) con 97 herramientas sobre la API SaaS de Sdelsol. **No se reescribe** (ADR-002): se consume como imagen aislada, versión fijada **3.4.7**, y lo que vive aquí es el adaptador en TypeScript. Las 97 herramientas no llegan al agente: el adaptador expone dos.
- Las credenciales las inyecta el gateway MCP. Nunca aparecen en este paquete ni en el contexto del modelo.

## Las dos herramientas

Mismo contrato que `connectors/odoo`, con una diferencia: `id`, `factura_id` y `cliente.id` son **cadenas con el identificador nativo** de Factusol (`1-000123`, `12`), como ya asumen `connectors/demo` y el guion del puesto de Cobros.

- `listar_facturas_vencidas` (lectura). Entrada `{ dias_vencida_minimo?, limite? }`; salida `{ facturas, total }` de más a menos días vencida. Nunca devuelve una factura que no está vencida.
- `crear_nota_seguimiento` (escritura). Entrada `{ factura_id, texto, tipo?, fecha_limite?, clave_idempotencia? }`; salida `{ id, factura_id, tipo, creado_en }`. **`id` es el `draft_id`**: la nota existe como borrador hasta que alguien lo confirma.

Todo fallo sale como error MCP con `code`, `message` en español y `datos.motivo` en `{ no_encontrada, no_autorizado, temporal, invalido }`. Solo `temporal` es reintentable. El detalle de Factusol se recorta a su primera línea y a 300 caracteres.

## Mapeo real con Factusol MCP 3.4.7

Descubierto por el Probador el 1-10 en la instancia local; el adaptador no se conecta a ella.

| Contrato                 | Factusol MCP                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Transporte               | SSE (`GET /sse` + `POST` de sesión), no HTTP «streamable».                                                                |
| Autenticación            | JWT HS256 en `Authorization: Bearer`, en el flujo y en cada `POST`. Toda llamada lleva `tenant_id`, que añade el cliente. |
| Lista de pendientes      | `list_facturas_emitidas { estado: 'pendiente', limite }`.                                                                 |
| Detalle y cobros         | `get_factura { serie, numero }`: `**Cobros:**` con `- ninguno registrado`.                                                |
| Código de cliente        | `get_cliente { termino_busqueda: <NIF> }`, `- Código: N`. Una vez por cliente y por llamada.                              |
| Nota                     | `draft_modificar_cliente { cliente, observaciones }`; el adaptador **no** llama a `confirmar_operacion`.                  |
| Lectura de observaciones | `get_cliente` no las trae: se leen del `valor_actual` de un borrador de sondeo, que se cancela con `cancelar_borrador`.   |

Todas las respuestas son Markdown (`structuredContent.result` repite el texto). Un único módulo, `src/markdown.ts`, lo analiza: bloques `**Factura S-NNNNNN**` con `- Cliente: NOMBRE (NIF)`, `- Fecha`, `- Estado`, `- Total: 1.21 €`. Un bloque que no encaja sale como `invalido` con el motivo; nunca un dato a medias. Un «no encontrado» llega como texto con `isError: false` y se reconoce por `No se ha encontrado …`.

### Reglas de derivación

- **Vencimiento.** Fecha de la factura + los días que diga el nombre de su forma de pago, solo si tiene un único vencimiento: `CONTADO` (0) o `… N DIAS`. Varios vencimientos, un nombre sin días, un código desconocido o una factura sin forma no se derivan: la factura no se devuelve y se cuenta en el registro (`facturas_sin_vencimiento`). Es una tabla de patrones sobre un nombre libre, frágil por naturaleza: pide al ingeniero el vencimiento por factura.
- **Importe pendiente.** Total menos la suma de los cobros legibles (`- AAAA-MM-DD: 69.76 € (cobro) — …`). Un cobro de otra forma, o cualquier abono (los importes de la factura no los restan), descarta la factura y la cuenta (`con_cobros_ilegibles`, `con_abonos`).
- **`numero` y `id`** valen lo mismo, `SERIE-NNNNNN`: Factusol no tiene un identificador interno distinto del número.
- **Sin informe todavía:** el nombre del estado de un borrador caducado.
- **Una versión más nueva puede cambiar las formas.** El adaptador está validado contra la imagen del 1-10; si las lecturas pasan a JSON, hace falta la rama estructurada del analizador.

### La nota: `observaciones` del cliente

No hay herramienta de notas. La línea `[AAAA-MM-DD] texto` se **añade al final** de las observaciones del cliente de la factura y nunca sustituye lo que había. Un `tipo: 'actividad'` con `fecha_limite` lleva `(Fecha límite: AAAA-MM-DD)` dentro del texto. Un borrador caduca a los 30 minutos.

## Confirmación del borrador (ADR-031)

Toda escritura es un borrador que caduca a los 30 minutos. La aprobación N1 de la plataforma es la única confirmación humana, y el conector confirma con un token `confirmar` distinto del del agente:

1. El gateway, tras la aprobación, abre una conexión efímera con las dos credenciales (cada una en su variable) y llama a `crear_nota_seguimiento`. Sin la de confirmación, falla como `no_autorizado` antes de llegar aquí.
2. El conector crea el borrador, comprueba en su diff que **solo cambia `observaciones`** y que el valor nuevo es **el actual más la nota aprobada**; si no coincide, lo cancela y falla como `invalido`.
3. `confirmar_operacion` va por un cliente aparte que lleva el token de confirmación y no hace nada más; se verifica con `get_estado_borrador`.
4. Con `clave_idempotencia`, el borrador pendiente se guarda en `FACTUSOL_ESTADO_DIR`; tras una caída, la repetición consulta su estado y no crea un segundo: si sigue pendiente, confirma ese mismo borrador (ya comprobado).

El conector se niega a arrancar si el token del agente trae el scope `confirmar`. `FACTUSOL_CONFIRMACION=A` (solo desarrollo, sin gateway) deja el borrador pendiente para que una persona lo confirme en el panel. Detalle y secuencia exacta: la especificación, «Confirmación de la escritura».

## Conciliación bancaria: fuera de este conector

Las herramientas `leer_extracto_bancario` y `proponer_asiento_diferencia` (rebanada «Herramientas de conciliación bancaria en los conectores») **no se sirven en Factusol**. El catálogo de Factusol MCP 3.4.7 (97 herramientas, informe del Probador del 1-10) es de facturación: solo tiene `list_bancos`/`get_banco` (las cuentas bancarias propias, datos maestros), el registro de cobros y pagos de facturas y `list_documentos_por_importe`. Ninguna lee movimientos bancarios ni crea asientos contables, y simularlas con otra cosa daría al agente una conciliación inventada. Hasta que Factusol MCP ofrezca las dos (mejora 9), el puesto de Conciliación bancaria no funciona con un tenant de Factusol: el gateway no encontrará las herramientas.

## Idempotencia

`clave_idempotencia` guarda junto a la nota la huella de los datos que la crearon. La misma clave con los mismos datos devuelve el mismo `draft_id`; con datos distintos sale `invalido`. Dos llamadas simultáneas escriben una vez. El almacén vive en el proceso y guarda 1000 claves; la garantía duradera es del flujo de Temporal y del gateway. Los borradores de Factusol no admiten clave: la idempotencia es de este adaptador.

## Cómo se lanza

```sh
AIW_CONECTOR_FACTUSOL=1 pnpm --filter @aiw/connector-factusol iniciar   # MCP por stdio, como lo lanza el gateway
AIW_CONECTOR_FACTUSOL=1 FACTUSOL_CONECTOR_HTTP=1 pnpm --filter @aiw/connector-factusol iniciar   # además, HTTP «streamable»
pnpm --filter @aiw/connector-factusol demo:factusol   # demostración sobre las respuestas grabadas
```

Sin `AIW_CONECTOR_FACTUSOL=1` el proceso no abre transporte ni toca Factusol: bandera de funcionalidad hasta la demo.

## Variables de entorno

Solo nombres; los valores los inyecta el gateway.

| Variable                                                                      | Qué es                                                                                                                                                    |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FACTUSOL_MCP_URL`                                                            | Extremo SSE de Factusol MCP, sin usuario ni contraseña dentro.                                                                                            |
| `FACTUSOL_MCP_TOKEN`                                                          | JWT HS256 del agente, **sin** scope `confirmar`. Mínimo ocho caracteres.                                                                                  |
| `FACTUSOL_MCP_TOKEN_CONFIRMAR`                                                | Opcional. JWT con scope `confirmar`, distinto del anterior y de ocho caracteres como mínimo. Solo lo guarda el gateway; confirma el borrador aprobado.    |
| `FACTUSOL_TENANT_ID`                                                          | Tenant que Factusol MCP exige en cada llamada.                                                                                                            |
| `FACTUSOL_CONFIRMACION`                                                       | `B` (por defecto): el gateway confirma con el token de confirmación tras la aprobación N1. `A`: solo desarrollo, el borrador queda pendiente en el panel. |
| `FACTUSOL_ESTADO_DIR`                                                         | Opcional. Directorio donde se guarda el borrador pendiente por clave de idempotencia, para no crear un segundo tras una caída.                            |
| `AIW_CONECTOR_FACTUSOL`, `FACTUSOL_CONECTOR_HTTP`, `FACTUSOL_CONECTOR_PUERTO` | Banderas y puerto del transporte.                                                                                                                         |
| `FACTUSOL_FACTURA_PRUEBA`                                                     | Solo pruebas: `serie-número` de una factura de la empresa de pruebas.                                                                                     |

Las variables del servidor de Factusol MCP (`MCP_AUTH_SECRET`, `HITL_CONFIRMACION_SECRET`…) no entran nunca aquí. El cifrado por tenant y la resolución de `conector.referencia_secreto` son del gateway (`packages/mcp-gateway`).

## Pruebas

```sh
CI=1 pnpm --filter @aiw/connector-factusol test
```

- Unitarias del analizador, los esquemas, los errores, el token y la idempotencia: corren siempre.
- De contrato: contra la instancia de pruebas cuando están las tres variables, y contra las grabaciones de `src/grabaciones/` cuando no, que es lo que pasa en la CI. Sin entorno se saltan con un mensaje que dice qué falta.
- Las grabaciones llevan valores inventados con la forma exacta del informe del Probador; una prueba comprueba que no hay correos, teléfonos ni documentos de identidad.

## Mejoras que conviene pedir a Factusol MCP

Salen del descubrimiento del 1-10. La numeración es de este README salvo la 8, que el Probador numeró; la 9 sale de la rebanada de conciliación bancaria.

1. **Respuestas en JSON** además del Markdown: hoy el adaptador analiza texto y cualquier cambio de formato lo rompe.
2. **Vencimiento e importe pendiente por factura** en `list_facturas_emitidas` y `get_factura`.
3. **Una herramienta de notas** de cliente y de factura, en vez de reescribir `observaciones`.
4. **Clave de idempotencia** en los `draft_*`.
5. **«No encontrado» como error estructurado** (`isError: true` con código), no como texto con `isError: false`.
6. **Código de cliente** en el listado de facturas, para no resolverlo por NIF con una llamada más.
7. **Documentar como camino oficial** el flujo de confirmación desde un proceso anfitrión con el scope `confirmar`.
8. **`observaciones`** y el resto de campos editables en la respuesta de `get_cliente`, para poder verificar una escritura sin leer el diff de un borrador.
9. **Movimientos bancarios y asientos**: una herramienta de lectura de los movimientos importados de cada cuenta bancaria (fecha, concepto, importe con signo, si están conciliados y con qué documento) y otra de borrador de asiento contable (`draft_crear_asiento`), con la misma confirmación humana y clave de idempotencia. Sin ellas no hay conciliación bancaria sobre Factusol.
