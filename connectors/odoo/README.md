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

## Las dos herramientas

Mismo contrato que sirve `connectors/demo` en la prueba técnica del stack: el gateway cambia de servidor MCP sin tocar el agente ni el caso dorado.

- `listar_facturas_vencidas` (lectura). Entrada `{ dias_vencida_minimo?, limite? }`; salida `{ facturas, total }` ordenada de más a menos días vencida. Nunca devuelve una factura que no está vencida.
- `crear_nota_seguimiento` (escritura). Entrada `{ factura_id, texto, tipo?, fecha_limite?, clave_idempotencia? }`; salida `{ id, factura_id, tipo, creado_en }`. Con la misma `clave_idempotencia` devuelve la misma nota sin crear otra.

Todo fallo sale como error MCP con `code`, `message` en español y `datos.motivo` en `{ no_encontrada, no_autorizado, temporal, invalido }`. Solo `temporal` es reintentable, y lo dice en `datos.reintentable`. El detalle que viene del ERP se recorta a su primera línea y a 300 caracteres: una traza de Odoo con SQL y nombres de tabla no tiene por qué llegar al contexto del modelo ni a los registros de aguas abajo, y la traza completa sigue en el MCP dinámico.

### Idempotencia

`clave_idempotencia` guarda junto a la nota la huella de los datos que la crearon. La misma clave con los mismos datos devuelve la misma nota; con datos distintos sale como `invalido`, en vez de devolver la nota vieja en silencio. Dos llamadas simultáneas con la misma clave esperan a la misma escritura y el ERP se escribe una vez. El almacén vive en el proceso y guarda 1000 claves, olvidando la más antigua al pasarlas; la garantía duradera entre reinicios es del flujo de Temporal y del gateway, que ya llevan clave por paso.

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

Convención de despliegue: **una imagen del MCP dinámico por tenant**, arrancada con esas cuatro variables mapeadas a los nombres del proyecto original (`ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_API_KEY`). El conector las valida al arrancar y falla rápido si falta alguna. El cifrado por tenant y la resolución de `conector.referencia_secreto` son del gateway MCP (`packages/mcp-gateway`, zona crítica): fuera del alcance de esta rebanada.

## Pruebas

```sh
CI=1 pnpm --filter @aiw/connector-odoo test
```

- Unitarias de esquemas, mapeo de campos de Odoo, motivos de error e idempotencia: corren siempre.
- De contrato: contra la instancia de pruebas de Odoo cuando están las cuatro variables de entorno, y contra las respuestas grabadas de `src/grabaciones/` cuando no, que es lo que pasa en la CI. Sin entorno se saltan con un mensaje que dice qué falta, igual que las pruebas de base de datos sin `DATABASE_URL`. Para probar también la escritura contra el ERP real, añade `ODOO_FACTURA_PRUEBA` con el identificador de una factura de pruebas.
- Las grabaciones llevan datos inventados; una prueba comprueba que no hay correos, teléfonos ni documentos de identidad dentro.
