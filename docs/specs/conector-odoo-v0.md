VIGENTE

# Especificación · Conector Odoo v0: facturas vencidas y nota de seguimiento sobre el MCP dinámico existente

- Rebanada: [Notion](https://app.notion.com/p/3e0530661898816298d0d1c3bf03d049) · Ciclo 0 · Tipo Conector · Paquetes `connectors/odoo` · P0
- Rama: `rebanada/conector-odoo-v0`
- Plan de referencia: secciones «Arquitectura» (gateway MCP, credenciales fuera del contexto del modelo) y «Los primeros diez días» del [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn); [ADR-001](../adr/ADR-001.md) (plano de control agnóstico del ERP, registro de herramientas con descubrimiento en runtime, borrador de aprobación con carga opaca), [ADR-002](../adr/ADR-002.md) (TypeScript de extremo a extremo, Python solo en servicios aislados) y [ADR-005](../adr/ADR-005.md) (niveles por clase de acción).
- Zona crítica: no. El conector no toca `packages/mcp-gateway`, `packages/domain`, `packages/ledger`, `.github/` ni migraciones. El cifrado por tenant y la `referencia_secreto` son del gateway y quedan fuera de esta rebanada.

## Objetivo

El puesto «Reclamación de cobros» deja de trabajar contra datos de prueba y lee la instancia de Odoo de Bitclick: pide las facturas vencidas y anota el seguimiento en la factura. El conector expone exactamente las dos herramientas que la [prueba técnica del stack](prueba-tecnica-del-stack.md) sirve hoy desde `connectors/demo`, con el mismo contrato, así que el gateway cambia de servidor MCP sin tocar el agente, el flujo ni el caso dorado. Es además el primer dogfooding: la instancia está en casa y no cuesta licencia.

## Decisión: el MCP dinámico se consume como imagen, no se importa

El «MCP dinámico existente» que el [README del conector](../../connectors/odoo/README.md) pide revisar es el servicio `odoo-mcp` que ya corre en la pila de Bitclick: el nodo `MCP Client (Odoo)` del flujo de n8n «Odoo Agent (odoo-mcp)» lo consume por HTTP en `http://odoo-mcp:8000/mcp`, y su superficie de herramientas (`search_records`, `read_record`, `aggregate_records`, `get_model_fields`, `list_models`, `build_domain`, `preview_write`, `validate_write`, `execute_approved_write`, `chatter_post`, `submit_async_task`…) identifica el proyecto [erpipe-org/mcp-odoo](https://github.com/erpipe-org/mcp-odoo), publicado como `odoo-mcp` en PyPI y como imagen en `ghcr.io/erpipe-org/mcp-odoo`.

- **Licencia: MIT**, declarada en el repositorio y en la ficha de PyPI. Permite uso, distribución y modificación conservando el aviso de copyright. Queda documentada en el README del conector, como exigía su requisito previo.
- **Runtime: Python** (requiere 3.10 o superior). No es un paquete de TypeScript y no existe como dependencia de npm.
- Por tanto, y aunque la licencia permitiría importarlo, **no se reescribe ni se copia al repositorio**: se consume como imagen de contenedor aislada, igual que Factusol, según la frontera del ADR-002 («Python solo en servicios aislados»). Lo que esta rebanada escribe en TypeScript es el **adaptador**: un servidor MCP propio que expone las dos herramientas del contrato y habla con la imagen como cliente MCP.
- Motivo de fondo: el MCP dinámico expone el ERP entero con herramientas genéricas por modelo. Eso no es una lista blanca por puesto, es lo contrario. El adaptador reduce esa superficie a dos herramientas con contrato cerrado, tipado y estable, que es lo que el gateway puede autorizar por puesto y nivel y lo que el caso dorado puede evaluar.

## Paquetes tocados

- `connectors/odoo`: el adaptador completo (esquemas, mapeo, errores, cliente del MCP dinámico, servidor stdio y HTTP, grabaciones y pruebas), su README y su entrada en el catálogo de `pnpm-workspace.yaml`.
- `.env.example`: las cuatro variables de Odoo y el extremo del MCP dinámico, vacías o con `GENERAR`.

## Endpoints, flujos y datos

Sin endpoints de la API, sin flujos de Temporal, sin tablas ni migraciones. El conector es un proceso que el gateway lanza y con el que habla por MCP.

**Herramientas expuestas.** Contrato compartido con el conector de demostración de la prueba técnica; los nombres de campo son los del dominio, no los de Odoo.

1. `listar_facturas_vencidas` (lectura).
   - Entrada: `{ dias_vencida_minimo?: entero ≥ 0 (por defecto 1), limite?: entero 1–200 (por defecto 50) }`.
   - Salida: `{ facturas: [{ id, numero, cliente: { id, nombre }, importe_pendiente, moneda, fecha_emision, fecha_vencimiento, dias_vencida }], total }`. `moneda` en ISO 4217; las fechas en `YYYY-MM-DD`.
   - Ordenadas de más a menos días vencida. Nunca devuelve una factura no vencida: `dias_vencida ≥ máx(1, dias_vencida_minimo)` para todas.
2. `crear_nota_seguimiento` (escritura).
   - Entrada: `{ factura_id, texto (1 a 2000 caracteres, sin HTML), tipo?: 'nota' | 'actividad' (por defecto 'nota'), fecha_limite?: YYYY-MM-DD solo con 'actividad', clave_idempotencia?: texto }`.
   - Salida: `{ id, factura_id, tipo, creado_en (ISO 8601) }`.
   - Con la misma `clave_idempotencia` devuelve el mismo `id` y no crea una segunda nota.

**Mapeo con Odoo.** `listar_facturas_vencidas` llama a `search_records` sobre `account.move` con dominio `move_type = out_invoice`, `state = posted`, `payment_state ∈ {not_paid, partial}` y `invoice_date_due ≤ hoy − dias_vencida_minimo`, y lee `name`, `partner_id`, `amount_residual`, `currency_id`, `invoice_date`, `invoice_date_due`. Los campos relación de Odoo llegan como par `[id, nombre]` y se convierten en `cliente` y `moneda`. `dias_vencida` se calcula en el conector con la fecha de hoy en UTC, no se pide a Odoo. `crear_nota_seguimiento` con `tipo: 'nota'` llama a `chatter_post` sobre `account.move`; con `tipo: 'actividad'` pasa por la secuencia `preview_write` → `validate_write` → `execute_approved_write` sobre `mail.activity`, que es la puerta de escritura del MCP dinámico.

**Errores.** Todo fallo sale como error MCP con `code`, `message` en español y `datos.motivo` en `{ no_encontrada, no_autorizado, temporal, invalido }`. `temporal` (red, tiempo agotado, 5xx, bloqueo de Odoo) es el único reintentable y así lo declara `datos.reintentable`. El mensaje nunca incluye la credencial ni el cuerpo íntegro de la respuesta del ERP: el detalle ajeno se queda en su primera línea y en 300 caracteres, porque un fallo de Odoo puede traer una traza con SQL y nombres de tabla que no tiene por qué llegar al contexto del modelo ni a los registros de aguas abajo. La traza entera sigue en el MCP dinámico, que es donde se produjo.

**Idempotencia.** `clave_idempotencia` guarda junto a la nota la huella de los datos que la crearon (`factura_id`, `tipo`, `texto`, `fecha_limite`). Repetir la clave con los mismos datos devuelve la misma nota; repetirla con datos distintos sale como `invalido`, porque devolver la nota vieja en silencio sería mentir sobre lo que se escribió. La escritura en vuelo se registra antes del primer `await`, así que dos llamadas simultáneas con la misma clave esperan a la misma promesa y el ERP se escribe una vez. El almacén vive en el proceso y guarda 1000 claves; al pasarlas olvida la más antigua, y una repetición suya volvería a escribir. La garantía duradera entre reinicios es del flujo de Temporal y del gateway, que ya llevan clave por paso: fuera de alcance.

**Credenciales.** Llegan solo por entorno, inyectadas por el gateway al lanzar el proceso: `ODOO_URL`, `ODOO_BASE`, `ODOO_USUARIO`, `ODOO_CLAVE_API`. Nunca en el código, en el prompt, en los registros ni como argumento de herramienta: el esquema de entrada de las dos herramientas no tiene un solo campo de credencial y lo comprueba una prueba. La convención de despliegue es una imagen del MCP dinámico por tenant, arrancada con esas cuatro variables mapeadas a los nombres del proyecto original (`ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_API_KEY`); el conector las valida al arrancar y falla rápido si falta alguna. El cifrado por tenant y la resolución de `conector.referencia_secreto` son del gateway: fuera de alcance, documentados en el README.

## Criterios de hecho

1. `connectors/odoo` arranca como servidor MCP por stdio (`pnpm --filter @aiw/connector-odoo iniciar`) y anuncia exactamente dos herramientas, con los esquemas Zod del contrato de arriba. El transporte HTTP «streamable» se activa con `ODOO_CONECTOR_HTTP=1` y el mismo registro de herramientas.
2. `listar_facturas_vencidas` devuelve la lista ordenada de más a menos días vencida, con `total` igual al número de facturas devueltas, y ninguna con `dias_vencida` por debajo del mínimo pedido. Una entrada fuera de rango (`limite` 0 o 500, `dias_vencida_minimo` negativo) sale como error con `motivo: invalido` y no llega a Odoo.
3. `crear_nota_seguimiento` crea la nota y devuelve `{ id, factura_id, tipo, creado_en }`. Con la misma `clave_idempotencia` devuelve el mismo `id` sin una segunda escritura. Un texto con HTML, vacío o de más de 2000 caracteres, o una `fecha_limite` con `tipo: 'nota'`, salen como `motivo: invalido`.
4. Una factura inexistente da `motivo: no_encontrada`; un usuario sin permiso, `no_autorizado`; una caída o un tiempo agotado del MCP dinámico, `temporal` con `reintentable: true`.
5. Ninguna salida ni ningún registro del conector contiene el valor de `ODOO_CLAVE_API`: lo comprueba una prueba que ejecuta las dos herramientas con una clave sembrada y rastrea respuestas, errores y todo lo escrito en `stdout` y `stderr`.
6. Las pruebas de contrato contra la instancia de pruebas de Odoo corren solo con `ODOO_URL`, `ODOO_BASE`, `ODOO_USUARIO` y `ODOO_CLAVE_API` presentes, y se saltan con un mensaje que dice qué falta, como las pruebas de base de datos con `DATABASE_URL`. En la CI, sin acceso a Odoo, el mismo cuerpo de prueba corre sobre respuestas grabadas.
7. `CI=1 pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build` y `pnpm evals:smoke` pasan en verde.
8. El README del conector documenta la licencia MIT del MCP dinámico, la decisión de consumirlo como imagen, las cuatro variables de entorno y la frontera con el gateway.

## Casos de prueba y de eval

- Unitario: esquemas Zod de entrada y salida de las dos herramientas (valores por defecto, límites, HTML rechazado, `fecha_limite` solo con `actividad`); mapeo de `account.move` a la factura del contrato, incluidos el par `[id, nombre]`, el importe pendiente, la moneda ISO y el cálculo de `dias_vencida`; orden y recorte por `limite`; traducción de los fallos del MCP dinámico a los cuatro motivos, incluidos los nombres de excepción de Odoo (`AccessError`, `MissingError`, `ValidationError`) y una traza larga que debe llegar recortada y sin SQL; idempotencia por clave, con la misma clave y otros datos, con dos llamadas simultáneas y tras una escritura fallida.
- Contrato: las dos herramientas contra la instancia de pruebas de Odoo cuando el entorno está; en la CI, contra las grabaciones de `src/grabaciones/`. Las grabaciones son datos inventados —clientes «Cliente de pruebas SL», «Ferretería Ejemplo SA»—; no hay ni un dato personal real.
- Eval: sin comportamiento de agente nuevo. El caso dorado `cobros` de la prueba técnica no cambia: este conector expone el mismo contrato que `connectors/demo` y se evalúa con él cuando el gateway lo registre. `pnpm evals:smoke` sigue en verde.
- Auditoría y contador: las emite el gateway al llamar a la herramienta, con un único punto de escritura en `packages/ledger`. El conector no escribe en el libro y no debe hacerlo; lo que aporta es un resultado con forma estable para que la entrada sea legible.
- Secretos: criterio de hecho 5, más el rastreo de credenciales literales en el paquete al estilo de `@aiw/db` y `gitleaks` en la CI. `.env.example` lleva las cuatro variables vacías o con `GENERAR`.

## Fuera de alcance

- Cifrado por tenant de las credenciales y resolución de `conector.referencia_secreto`: del gateway MCP (`packages/mcp-gateway`), zona crítica.
- Registrar el conector, su lista blanca y su nivel por puesto: «Prueba técnica del stack» y la rebanada que siembre `autorizacion_herramientas`.
- El conector de demostración `connectors/demo`: rebanada «Prueba técnica del stack», en paralelo. Comparte contrato y no se toca.
- Más herramientas de Odoo (cobros, conciliación, extractos, asientos): las piden las rebanadas de Conciliación y Previsión.
- Envío de recordatorios por correo o WhatsApp: rebanadas de canales.
- Entrada del Compose de desarrollo para la imagen del MCP dinámico y su runbook: rebanada «Solicitar cuenta de WhatsApp Business y preparar el acceso a Odoo y a Factusol MCP».

## Presupuesto de tokens

Presupuesto: 40 €. La propiedad estaba vacía en el tablero y esta rebanada la propone; se registra junto al consumo real al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

La demo del viernes 2 de octubre contra el Odoo real necesita que el MCP dinámico esté publicado para la plataforma (hoy solo lo alcanza n8n en su red interna) y una instancia de pruebas con facturas vencidas de mentira. ¿Lo levantas tú en la pila de Bitclick o lo pide el Operador como rebanada de despliegue?
