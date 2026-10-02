VIGENTE

# Conector Odoo

Conector MCP de Odoo sobre el MCP dinámico ya existente en Bitclick. Es el primer conector del plan porque la instancia de Odoo está en casa, sin coste de licencia, y sirve de dogfooding.

- Rebanada que lo implementa: «Conector Odoo v0: facturas vencidas y nota de seguimiento sobre el MCP dinámico existente».
- Especificación: [`docs/specs/conector-odoo-v0.md`](../../docs/specs/conector-odoo-v0.md).
- Las credenciales de Odoo se cifran por tenant y las inyecta el gateway MCP. Nunca aparecen en este paquete ni en el contexto del modelo.

## Licencia del MCP dinámico

Requisito previo de este conector, ya cumplido. El «MCP dinámico existente» es el servicio `odoo-mcp` que corre en la pila de Bitclick: el flujo de n8n «Odoo Agent (odoo-mcp)» lo consume en `http://odoo-mcp:8000/mcp` y su superficie de herramientas (`search_records`, `read_record`, `get_model_fields`, `preview_write`, `validate_write`, `execute_approved_write`, `chatter_post`…) lo identifica como [erpipe-org/mcp-odoo](https://github.com/erpipe-org/mcp-odoo), publicado como `odoo-mcp` en PyPI y como imagen en `ghcr.io/erpipe-org/mcp-odoo`.

| Dato         | Valor                                                  |
| ------------ | ------------------------------------------------------ |
| Proyecto     | erpipe-org/mcp-odoo                                    |
| Licencia     | MIT                                                    |
| Runtime      | Python 3.10 o superior                                 |
| Distribución | PyPI `odoo-mcp` e imagen `ghcr.io/erpipe-org/mcp-odoo` |
| Transporte   | stdio y HTTP «streamable»                              |

La licencia MIT permite usarlo, distribuirlo y modificarlo conservando el aviso de copyright, así que no bloquea nada. Aun así **no se importa ni se copia código aquí**: es Python, y el ADR-002 confina Python a servicios aislados. Se consume como imagen de contenedor, igual que Factusol, y lo que vive en este paquete es el **adaptador en TypeScript**. Si alguien cambia la imagen por otra, repite esta revisión antes.

Motivo de fondo, además del runtime: el MCP dinámico expone el ERP entero con herramientas genéricas por modelo, que es lo contrario de una lista blanca por puesto. El adaptador reduce esa superficie a dos herramientas con contrato cerrado, que es lo que el gateway puede autorizar por puesto y nivel.

### Forma exacta de respuesta de cada herramienta que se consume

`src/cliente.ts` y `src/mapeo.ts` no adivinan la forma: la sacan del código fuente de [erpipe-org/mcp-odoo](https://github.com/erpipe-org/mcp-odoo) (MIT), leído para esta rebanada sin copiarlo. `search_records` declara su tipo de vuelta como un modelo con campos propios (`SearchRecordsResponse`): su `structuredContent` es ese objeto tal cual, sin envolvente añadida. Las cuatro herramientas de escritura (`chatter_post`, `preview_write`, `validate_write`, `execute_approved_write`) declaran su tipo de vuelta como un diccionario genérico (`Dict[str, Any]`), sin campos propios que FastMCP pueda anunciar: para esas, FastMCP envuelve el diccionario entero en `{ "result": <diccionario> }`, y el `result` que cada una ya usa como nombre de campo queda anidado un nivel más adentro.

| Herramienta              | Fichero                                          | Devuelve en `structuredContent` (éxito)                                                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `search_records`         | `tools_read.py`                                  | `{ success, count, result: [<registros>], smart_fields_applied, fields_used }`. Sin envolvente de FastMCP: la lista ya va en `result`, no en `records`.                                                                                                                                                                  |
| `chatter_post`           | `tools_write.py`                                 | Entrada: `model`, `record_id` (entero, obligatorio — no `res_id`), `body`, el resto opcional. Salida: `{ result: { success, mode, model, record_id, approval_required, result } }`. `record_id` repite el registro sobre el que se escribe (la factura); el identificador del mensaje creado va en el `result` interior. |
| `preview_write`          | `tools_write.py` (`build_write_preview_report`)  | `{ result: { success, tool, model, operation, approval: { model, operation, record_ids, values, context, instance, values_list, token }, execute_method, issues, warnings, metadata_used } }`.                                                                                                                           |
| `validate_write`         | `tools_write.py` (`validate_write_report`)       | El mismo `result.{…}` de `preview_write`, con `result.approval_status: { stored, expires_in_seconds, source }` añadido; el identificador de aprobación sigue en `result.approval.token`, no en un `approval_id` suelto.                                                                                                  |
| `execute_approved_write` | `tools_write.py` (`execute_approved_write_tool`) | Entrada: `approval` (el objeto entero de `result.approval`, obligatorio — no un `approval_id` ni un `token` sueltos), `confirm`. Salida: `{ result: { success, tool, model, operation, result, instance } }`. El identificador de lo creado va en el `result` interior.                                                  |

Seis consecuencias en el adaptador, las seis cubiertas por prueba:

- `leerRegistros` (`src/mapeo.ts`) acepta `result` como envolvente de lista, además de `records`, `results`, `data` y `rows`: sin ella, `search_records` contra el servidor real fallaba con «no trae ninguna lista de registros» aunque la grabación de prueba (que usaba `records`, una forma supuesta) pasara.
- `leerIdentificador` (`src/mapeo.ts`) prueba primero la envolvente (`result`, `data`, `record`, `records`, `ids`), recursivamente, y solo si no trae nada usable cae a una clave suelta (`message_id`, `activity_id`, `id`, `res_id`, `record_id`): `record_id` en la respuesta de `chatter_post` es la factura, no el mensaje creado, y con la prioridad al revés `crear_nota_seguimiento` devolvía el identificador equivocado. Como prueba recursivamente, da igual que haya una o dos envolventes `result` anidadas.
- `extraerAprobacion` (`src/herramientas.ts`) prueba también la envolvente `result`, además de `approval`: sin ella, nunca encontraba `approval` anidado dentro de la envolvente de FastMCP, y `crear_nota_seguimiento` con `tipo: 'actividad'` fallaba siempre con `invalido` sin escribir nada en Odoo (criterio de hecho 6 de la rebanada «Bitclick como primera organización»).
- `leerCarga` (`src/cliente.ts`) trata `{ success: false, error }` como un fallo aunque el protocolo MCP no marque `isError`: las herramientas del MCP dinámico pueden devolver así un rechazo de Odoo (permiso, registro inexistente…) dentro de una respuesta «correcta» del protocolo; sin esto, el motivo real del ERP se perdía detrás de «no trae ninguna lista de registros» o «la escritura no devuelve identificador». Prueba también, recursivamente, la envolvente `result`: para `chatter_post`, `preview_write`, `validate_write` y `execute_approved_write` el fallo real va anidado ahí, no en el nivel superior.
- `anotarEnHistorial` (`src/herramientas.ts`) llama a `chatter_post` con `record_id`, no `res_id`: el esquema real de la v1.3.1 lo exige entero y obligatorio con ese nombre exacto, verificado contra el `tools/list` del MCP vivo (Pydantic respondía «1 validation error for chatter_postArguments»). Tercera deriva de forma supuesta, después de `records`/`result` y de la envolvente de aprobación.
- `crearActividad` (`src/herramientas.ts`) llama a `execute_approved_write` con `{ approval: <objeto> }`, no `{ approval_id: <token> }`: la herramienta real exige el objeto de aprobación entero, no un identificador suelto. Hallazgo propio de esta rebanada (no reportado por el Probador): nunca se había ejercitado contra el MCP real porque `tipo` por defecto en `crear_nota_seguimiento` es «nota», que no pasa por `crearActividad`. Verificado contra la firma de `execute_approved_write_tool` y el uso real en los tests del propio proyecto (`tests/test_batch_write.py`, que pasa `validation["approval"]` entero).

`src/conformidad.ts` valida cada llamada real del conector contra el `inputSchema` de su herramienta, no contra lo que la grabación espera encontrar (`clienteGrabado` solo casa por subconjunto de argumentos, así que una grabación con una forma supuesta pasaría igual). `src/conformidad.test.ts` lo ejercita con los esquemas vivos que capturó el Probador contra el `tools/list` de la imagen real (`src/grabaciones/esquemas-vivos.json`) para `search_records`, `preview_write`, `validate_write` y `execute_approved_write`, y con un esquema de `chatter_post` sacado de `tools_write.py` mientras el Probador no deje ese también en la rebanada: es la única de las cinco herramientas que las de conciliación no llaman, así que su captura quedó fuera. Esta prueba es la que de verdad habría atrapado las tres derivas de nombre/forma de esta rebanada antes de llegar al ERP real.

`src/grabaciones/odoo-pruebas.json` usa la forma real de las cinco herramientas, con la envolvente `result` donde corresponde y datos inventados: `search_records` lleva además la forma con `records` para no romper la prueba que ya la cubría. `listar_facturas_vencidas` declara `annotations: { readOnlyHint: true }` en el catálogo del servidor (`src/servidor.ts`): sin ella, el gateway MCP tipa cualquier herramienta como escritura —lo más restrictivo por defecto— y pediría aprobación N1 hasta para leer las facturas vencidas.

## Las dos herramientas de cobros

Mismo contrato que sirve `connectors/demo` en la prueba técnica del stack: el gateway cambia de servidor MCP sin tocar el agente ni el caso dorado.

- `listar_facturas_vencidas` (lectura). Entrada `{ dias_vencida_minimo?, limite? }`; salida `{ facturas, total }` ordenada de más a menos días vencida. Nunca devuelve una factura que no está vencida.
- `crear_nota_seguimiento` (escritura). Entrada `{ factura_id, texto, tipo?, fecha_limite?, clave_idempotencia? }`; salida `{ id, factura_id, tipo, creado_en }`. Con la misma `clave_idempotencia` devuelve la misma nota sin crear otra.

Todo fallo sale como error MCP con `code`, `message` en español y `datos.motivo` en `{ no_encontrada, no_autorizado, temporal, invalido }`. Solo `temporal` es reintentable, y lo dice en `datos.reintentable`. El detalle que viene del ERP se recorta a su primera línea y a 300 caracteres: una traza de Odoo con SQL y nombres de tabla no tiene por qué llegar al contexto del modelo ni a los registros de aguas abajo, y la traza completa sigue en el MCP dinámico.

### Idempotencia

`clave_idempotencia` guarda junto a la nota la huella de los datos que la crearon. La misma clave con los mismos datos devuelve la misma nota; con datos distintos sale como `invalido`, en vez de devolver la nota vieja en silencio. Dos llamadas simultáneas con la misma clave esperan a la misma escritura y el ERP se escribe una vez. El almacén vive en el proceso y guarda 1000 claves, olvidando la más antigua al pasarlas; la garantía duradera entre reinicios es del flujo de Temporal y del gateway, que ya llevan clave por paso.

## Conciliación bancaria

Dos herramientas más, con el contrato de [`docs/specs/conector-conciliacion-herramientas-v0.md`](../../docs/specs/conector-conciliacion-herramientas-v0.md) (rebanada «Herramientas de conciliación bancaria en los conectores»). Los identificadores son **cadenas con el identificador nativo** (`"301"`), como en `connectors/factusol`; en Odoo son enteros positivos escritos como cadena y cualquier otra cosa sale `invalido` sin llegar al ERP.

- `leer_extracto_bancario` (lectura). Entrada `{ cuenta_id?, desde?, hasta?, solo_sin_casar? (true), limite? (1–200, 50) }`; salida `{ apuntes: [{ id, cuenta_id, fecha, concepto, importe, moneda, casado, documento_id }], total }`, del más antiguo al más reciente. `hasta` anterior a `desde` sale `invalido`.
- `proponer_asiento_diferencia` (escritura, **siempre borrador**). Entrada `{ apunte_id, documento_id, importe_diferencia, cuenta_contrapartida, motivo, clave_idempotencia? }`; salida `{ id, apunte_id, estado: 'borrador', creado_en }`. Nunca contabiliza: una persona publica el asiento en Odoo.

### Mapeo con el MCP dinámico (v1.3.1)

| Contrato                      | MCP dinámico / Odoo                                                                                                                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `leer_extracto_bancario`      | `search_records { model: 'account.bank.statement.line', domain, fields, limit, order: 'date asc, id asc' }`. `cuenta_id` es el diario de banco (`journal_id`); `solo_sin_casar` es `is_reconciled = false`.                                                              |
| `apunte.concepto`             | `payment_ref` (`false` en Odoo es cadena vacía). `importe` es `amount` con signo; `moneda`, el nombre de `currency_id`.                                                                                                                                                  |
| `apunte.documento_id`         | `null` si no está casado. **Casado:** el asiento propio del apunte (`move_id`): Odoo no cuelga del apunte la factura casada. Pendiente de confirmar con el Probador sobre un extracto real.                                                                              |
| `proponer_asiento_diferencia` | Lee el apunte, el documento (`account.move`), el diario (`default_account_id`) y la cuenta por su **código** (`account.account.code`); después `preview_write` → `validate_write` → `execute_approved_write` de un `account.move` (`move_type: 'entry'`) con dos líneas. |

El asiento lleva el banco y la contrapartida: una diferencia positiva (el banco recibió más que el documento) va al debe del banco y al haber de la contrapartida; una negativa, al revés. No lleva `state` ni se llama a `action_post`: un `create` de Odoo deja el asiento en borrador. Una prueba comprueba que las únicas llamadas son `search_records`, `preview_write`, `validate_write` y `execute_approved_write`. Un apunte, documento o cuenta que no existen salen `no_encontrada` antes de escribir.

La idempotencia, los cuatro motivos de error y el recorte del detalle nativo son los de las herramientas de cobros (`src/conciliacion.ts` repite el mecanismo de `src/herramientas.ts` sin tocarlo).

Las grabaciones de `src/grabaciones/odoo-pruebas.json` llevan la forma real (envolvente `result`) con datos inventados, pero **no se han contrastado con un extracto real**: la empresa de pruebas de Odoo no tenía extractos importados al construir esta rebanada. La verificación real de `leer_extracto_bancario` y de la escritura la hará el Probador cuando Jesús importe un extracto ficticio (ver «Pruebas»).

## Cómo se lanza

```sh
AIW_CONECTOR_ODOO=1 pnpm --filter @aiw/connector-odoo iniciar   # MCP por stdio, que es como lo lanza el gateway
AIW_CONECTOR_ODOO=1 ODOO_CONECTOR_HTTP=1 pnpm --filter @aiw/connector-odoo iniciar   # además, HTTP «streamable»
pnpm --filter @aiw/connector-odoo demo:odoo   # demostración sobre las respuestas grabadas, sin Odoo
```

Sin `AIW_CONECTOR_ODOO=1` el proceso no abre transporte ni toca el ERP: bandera de funcionalidad hasta la demo.

## Credenciales

Llegan solo por variables de entorno que el gateway inyecta al lanzar el proceso. Nunca en el código, en el prompt, en los registros ni como argumento de herramienta: el esquema de entrada de las dos herramientas no tiene un solo campo de credencial y lo comprueba `src/secretos.test.ts`, que además rastrea las salidas y el registro buscando el valor de la clave.

| Variable         | Qué es                                                            |
| ---------------- | ----------------------------------------------------------------- |
| `ODOO_URL`       | URL de la instancia, sin usuario ni contraseña dentro.            |
| `ODOO_BASE`      | Base de datos de Odoo.                                            |
| `ODOO_USUARIO`   | Usuario del puesto en Odoo.                                       |
| `ODOO_CLAVE_API` | Clave de API. Vive en memoria del proceso y no sale de ahí.       |
| `ODOO_MCP_URL`   | Extremo del MCP dinámico. Por defecto `http://odoo-mcp:8000/mcp`. |

El conector rechaza al arrancar una `ODOO_CLAVE_API` de menos de ocho caracteres: por debajo de ese tamaño la redacción no la taparía —un valor tan corto puede ser una palabra común y taparlo dejaría los mensajes ilegibles—, y lo que no se puede redactar no se usa.

Convención de despliegue: **una imagen del MCP dinámico por tenant**, arrancada con esas cuatro variables mapeadas a los nombres del proyecto original (`ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_API_KEY`). El conector las valida al arrancar y falla rápido si falta alguna. El cifrado por tenant y la resolución de `conector.referencia_secreto` son del gateway MCP (`packages/mcp-gateway`, zona crítica): fuera del alcance de esta rebanada.

## Pruebas

```sh
CI=1 pnpm --filter @aiw/connector-odoo test
```

- Unitarias de esquemas, mapeo de campos de Odoo, motivos de error e idempotencia: corren siempre.
- De contrato: contra la instancia de pruebas de Odoo cuando están las cuatro variables de entorno, y contra las respuestas grabadas de `src/grabaciones/` cuando no, que es lo que pasa en la CI. Sin entorno se saltan con un mensaje que dice qué falta, igual que las pruebas de base de datos sin `DATABASE_URL`. Para probar también la escritura contra el ERP real, añade `ODOO_FACTURA_PRUEBA` con el identificador de una factura de pruebas. Las de conciliación se saltan sin un extracto importado: `leer_extracto_bancario` solo necesita las cuatro variables y apuntes sin casar; el borrador de asiento necesita además `ODOO_APUNTE_PRUEBA`, `ODOO_DOCUMENTO_PRUEBA` y `ODOO_CONTRAPARTIDA_PRUEBA` (código de cuenta). `src/contrato-comun.test.ts` compara la forma del contrato con `connectors/demo`.
- Las grabaciones llevan datos inventados; una prueba comprueba que no hay correos, teléfonos ni documentos de identidad dentro.
