VIGENTE

# Especificación · Conector Factusol v0: facturas vencidas y nota de seguimiento sobre Factusol MCP

- Rebanada: [Notion](https://app.notion.com/p/3eb53066189881349709d81c2679316e) · Ciclo 2 · Tipo Conector · Paquetes `connectors/factusol` · P0
- Rama: `rebanada/conector-factusol-v0`
- Plan de referencia: frontera «plano de control agnóstico del ERP» y «registro de herramientas como interfaz con descubrimiento en runtime» del [ADR-001](../adr/ADR-001.md); [ADR-002](../adr/ADR-002.md) («Factusol MCP se conserva íntegro como conector en Python»; «Python solo en servicios aislados»); [ADR-005](../adr/ADR-005.md) (niveles por clase de acción). Patrón de referencia, no plan: [Conector Odoo v0](conector-odoo-v0.md), la otra mitad del mismo par multi-ERP, y [`connectors/factusol/README.md`](../../connectors/factusol/README.md), que ya fija que Factusol MCP no se reescribe y se consume como imagen a través del gateway MCP.
- Zona crítica: no. El conector no toca `packages/mcp-gateway`, `packages/domain`, `packages/ledger`, `.github/` ni ninguna migración. El cifrado por tenant y la `referencia_secreto` son del gateway y quedan fuera de esta rebanada, igual que en el conector de Odoo.
- No toca el prototipo IAGENT-COMPANY: no se cosecha ni se copia nada de él para esta rebanada (prohibición de `CLAUDE.md`). Factusol MCP es un producto propio de Bitclick, previo a la plataforma (documento original citado en el ADR-001, «Factusol MCP SaaS»), distinto del prototipo IAGENT-COMPANY.

## Objetivo

PUBLIEXPE —el primer candidato a socio externo— usa Factusol, no Odoo. Con este conector, el puesto «Reclamación de cobros» deja de depender de qué ERP tenga el cliente: expone exactamente las mismas dos herramientas que ya sirve `connectors/odoo` (`listar_facturas_vencidas`, `crear_nota_seguimiento`), con idéntico contrato de entrada, salida y errores, esta vez habladas contra Factusol MCP. El gateway elige el conector por el ERP del tenant sin que el puesto, el prompt ni el caso dorado `cobros` cambien una línea: es la frontera «plano de control agnóstico del ERP» del ADR-001 hecha realidad con el segundo ERP, no solo declarada.

## Decisión: Factusol MCP se conserva íntegro; lo que se escribe aquí es el adaptador

Factusol MCP es un servicio en Python que ya existe, con 451 pruebas y clientes en marcha (`connectors/factusol/README.md`). El ADR-002 lo dice explícitamente: «Factusol MCP se conserva íntegro como conector en Python» y «no se reescribe». Por tanto:

- **No se reescribe ni se copia código Python al repositorio.** Se consume como imagen de contenedor aislada a través del gateway MCP, igual que el MCP dinámico de Odoo.
- **Lo que esta rebanada construye en TypeScript es el adaptador** en `connectors/factusol`: un servidor MCP propio, con el mismo esqueleto que `connectors/odoo` (esquemas Zod, cliente MCP hacia la imagen de Factusol, mapeo de campos, traducción de errores a los cuatro motivos del contrato, idempotencia, servidor stdio y HTTP «streamable», grabaciones para la CI), que expone exactamente `listar_facturas_vencidas` y `crear_nota_seguimiento`.
- **Diferencia con Odoo, no en la arquitectura sino en el origen:** el MCP dinámico de Odoo es un proyecto de terceros de superficie genérica (todo el ERP, un modelo cualquiera) que el adaptador reduce a dos herramientas. Factusol MCP es un producto propio de Bitclick, ya acotado a su dominio (facturación, no un ORM genérico), así que es razonable esperar que su superficie nativa ya esté más cerca del contrato final; aun así, sus nombres de herramienta y de campo son los suyos, no los del dominio de la plataforma (`factura_id`, `dias_vencida`, `cliente.nombre`…), y el adaptador es quien hace esa traducción, igual que con Odoo.
- **Cómo se descubre el contrato nativo:** por descubrimiento en tiempo de ejecución contra la imagen real de Factusol MCP (ADR-001), no por documentación externa —esta especificación no tiene acceso a ella—. El Constructor conecta como cliente MCP contra la instancia de pruebas (ver pregunta abierta), lista sus herramientas y esquemas, y documenta el mapeo exacto en el README del conector, con el mismo nivel de detalle que `connectors/odoo/README.md` documenta `erpipe-org/mcp-odoo`.
- Motivo de fondo, igual que en Odoo: lo que el gateway puede autorizar por puesto y nivel es una lista blanca de herramientas con contrato cerrado y tipado, no la superficie entera de un ERP.

## Paquetes tocados

- `connectors/factusol`: el adaptador completo (esquemas, mapeo, errores, cliente del MCP de Factusol, servidor stdio y HTTP, grabaciones y pruebas), sustituyendo el `README.md` de solo referencia actual por uno con el mismo nivel de detalle que el de Odoo, y su entrada en el catálogo de `pnpm-workspace.yaml` (automática por el glob `connectors/*`, sin cambio de configuración).
- `.env.example`: las variables de Factusol y el extremo de su MCP, vacías o con `GENERAR`, con el mismo comentario de bandera y de inyección por el gateway que ya tienen las de Odoo.

## Mapeo con Factusol MCP 3.4.7

Fuente única: el descubrimiento del Probador del 1-10 en la rebanada («Descubrimiento de Factusol MCP», «Escritura de prueba», «Prueba supervisada del canal anfitrión»). Esta sección sustituye al párrafo «Mapeo con Factusol» de arriba y fija lo que el descubrimiento cambia. Nada de lo que sigue sale de adivinar una forma: lo que el informe no trae queda marcado «sin informe» y el adaptador lo rechaza con `invalido` en vez de suponerlo.

1. **Transporte y autenticación.** El adaptador es cliente MCP sobre **SSE** (`GET /sse`, endpoint de sesión por `POST`) con `Authorization: Bearer <JWT HS256>`. El token es el del agente y llega por entorno. Toda llamada lleva `tenant_id`, que también llega por entorno y nunca como argumento de herramienta. El servidor propio del adaptador no cambia: stdio y HTTP «streamable» hacia el gateway.
2. **Token sin `confirmar`.** Al arrancar, el adaptador decodifica el JWT **sin verificarlo** (no tiene el secreto) y se niega a arrancar si el scope `confirmar` aparece en `scope`, `scopes` o `scp`, como cadena separada por espacios o como lista. El mensaje nombra la variable y jamás el token.
3. **Un único analizador de Markdown** (`src/markdown.ts`). Todas las respuestas son texto; `structuredContent.result` repite el texto, así que el adaptador lee `content[].text`. Formas soportadas, las del informe: bloques `**Factura S-NNNNNN**` con `- Cliente: NOMBRE (NIF)`, `- Fecha: AAAA-MM-DD`, `- Estado: …`, `- Total: 1.21 €`; el detalle de `get_factura` añade `- Base imponible: … · IVA: …`, `**Líneas:**` y `**Cobros:**`; `get_cliente` trae `**NOMBRE** (NIF · NIE)` y `- Código: 12`. Un bloque que no encaja, un importe o fecha ilegibles o un campo obligatorio ausente devuelve `invalido` con el motivo; nunca un dato a medias.
4. **Identificadores nativos, como cadena.** `factura.id` y `factura_id` son `SERIE-NNNNNN` tal como la imprime el informe (`1-000123`); `cliente.id` es el `Código` de `get_cliente` (`12`). Esto **desvía el contrato de Odoo en una cosa**: `id` y `cliente.id` son cadena y no entero, que es lo que ya asumen `connectors/demo` y el guion del puesto de Cobros (`id: string`). El listado no trae el código de cliente, solo nombre y NIF: el adaptador lo resuelve con `get_cliente` por NIF, una vez por cliente y por llamada.
5. **Importe pendiente.** El listado trae el `Total` y el estado, no lo cobrado. Una factura en estado `pendiente` lleva `importe_pendiente` = `Total` solo si su detalle (`get_factura`) dice `**Cobros:**` con `- ninguno registrado`; con cobros parciales sin un importe legible, la factura no se devuelve y se cuenta en el registro. Moneda: `EUR`, porque el informe solo da `€`; otro símbolo es `invalido`.
6. **Vencimiento (sin informe).** Ninguna respuesta del informe trae vencimiento. Se deriva de la forma de pago y la fecha de la factura, pero el informe no documenta la forma de `get_formas_de_pago` ni dónde aparece la forma de pago de una factura. Hasta que el Probador lo aporte, el derivador queda tras una interfaz (`ResolutorDeVencimiento`) cuya implementación por defecto no deriva nada: el adaptador **no devuelve la factura y la cuenta en el registro** (`facturas_sin_vencimiento`). El contrato dice «nunca devuelve una factura que no está vencida» y manda sobre la utilidad. `get_saldo_cliente` solo da «Recibos vencidos sin cobrar» agregado por cliente, sin fechas: no sirve para derivar.
7. **Errores.** `isError: true` o fallo de transporte: se traduce por texto como en Odoo (`no_autorizado` por 401/403 o «token»; `temporal` por caída, tiempo agotado o `circuit`/`rate`; lo desconocido es `temporal`). `isError: false` con un texto `No se ha encontrado …` es `no_encontrada`. Los textos reconocidos se fijan por prueba con el literal del informe. El detalle sale recortado a una línea y 300 caracteres.
8. **Nota de seguimiento = campo `observaciones` del cliente de la factura.** No hay herramienta de notas. `tipo: 'actividad'` con `fecha_limite` se traduce a la misma nota con «Fecha límite: AAAA-MM-DD» dentro del texto. La línea que se añade es `[AAAA-MM-DD] texto`, **al final** de lo que ya había, separada por salto de línea, y nunca sustituye nada. `get_cliente` no devuelve `observaciones` (hallazgo 8): el valor actual se lee del `valor_actual` del borrador de `draft_modificar_cliente`. Esa lectura obliga a crear un primer borrador de sondeo, cancelarlo con `cancelar_borrador` y crear el definitivo con el texto concatenado; si la forma del borrador no es la esperada, `invalido` y no se escribe. **Forma del borrador: parcialmente sin informe** (solo constan `draft_id` y `valor_actual`, y que el borrador es JSON estructurado con caducidad de 30 minutos); la prueba de contrato posterior a la fusión (criterio 6) la fija.
9. **Idempotencia en el adaptador**, con el patrón de Odoo (huella de datos, escritura en vuelo registrada antes del primer `await`, 1000 claves). `Salida.id` es el `draft_id`: la nota existe como borrador hasta que alguien lo confirma. Sin `clave_idempotencia` hay un borrador por llamada.
10. **El borrador caduca a los 30 minutos y es la única escritura.** El adaptador nunca llama a `confirmar_operacion` por sí mismo. La confirmación va detrás de una interfaz de dos métodos, `ConfirmadorDeBorrador`: **Opción A**, el adaptador deja el borrador pendiente y una persona lo confirma en el panel de Factusol (`/panel`, origen `panel`); **Opción B (la que recomienda la dirección)**, tras la aprobación N1 de la plataforma el gateway confirma con un token `confirmar` que solo guarda el gateway, solo el borrador aprobado y tras comprobar que su contenido coincide con la carga aprobada (origen `mcp_externo`). La B vive en `packages/mcp-gateway`, zona crítica, y **no se construye aquí**: el adaptador deja la interfaz y la A. **Decidido por Jesús el 1-10: la B ([ADR-031](../adr/ADR-031.md)).** Se construye en un segundo PR («confirmación», zona crítica); este PR deja la A como camino transitorio.
11. **Variables (solo nombres).** `FACTUSOL_MCP_URL`, `FACTUSOL_MCP_TOKEN`, `FACTUSOL_TENANT_ID`, más las de bandera `AIW_CONECTOR_FACTUSOL` y `FACTUSOL_CONECTOR_HTTP`. Las del servidor de Factusol MCP (`MCP_AUTH_SECRET` y demás) no entran nunca en el adaptador.
12. **Datos de la instancia.** Ni nombres, NIF ni importes reales en el repositorio (ADR-029): las grabaciones y las pruebas llevan valores inventados con la forma exacta del informe.

## Endpoints, flujos y datos

Sin endpoints de la API, sin flujos de Temporal, sin tablas ni migraciones. El conector es un proceso que el gateway lanza y con el que habla por MCP, igual que `connectors/odoo`.

**Herramientas expuestas.** Mismo contrato que `connectors/odoo` y que `connectors/demo`; los nombres de campo son los del dominio, no los de Factusol.

1. `listar_facturas_vencidas` (lectura).
   - Entrada: `{ dias_vencida_minimo?: entero ≥ 0 (por defecto 1), limite?: entero 1–200 (por defecto 50) }`.
   - Salida: `{ facturas: [{ id, numero, cliente: { id, nombre }, importe_pendiente, moneda, fecha_emision, fecha_vencimiento, dias_vencida }], total }`. `moneda` en ISO 4217; fechas en `YYYY-MM-DD`. Identificadores de cliente y de factura en el formato nativo de Factusol (p. ej. `CLI/17`, como ya anticipa `packages/db/src/conocimiento.ts`), sin traducirlos a un UUID que Factusol no tiene.
   - Ordenadas de más a menos días vencida. Nunca devuelve una factura no vencida: `dias_vencida ≥ máx(1, dias_vencida_minimo)` para todas.
2. `crear_nota_seguimiento` (escritura).
   - Entrada: `{ factura_id, texto (1 a 2000 caracteres, sin HTML), tipo?: 'nota' | 'actividad' (por defecto 'nota'), fecha_limite?: YYYY-MM-DD solo con 'actividad', clave_idempotencia?: texto }`.
   - Salida: `{ id, factura_id, tipo, creado_en (ISO 8601) }`.
   - Con la misma `clave_idempotencia` devuelve el mismo `id` y no crea una segunda nota. Si la superficie nativa de Factusol no distingue nota de actividad, `tipo: 'actividad'` con `fecha_limite` se traduce a lo más parecido que exponga (por ejemplo, una nota con la fecha límite en el texto) y el README documenta la equivalencia exacta.

**Mapeo con Factusol.** Fijado en la sección «Mapeo con Factusol MCP 3.4.7» de arriba. El README del conector lo documenta, como hace `connectors/odoo/README.md`.

**Errores.** Igual que Odoo: todo fallo sale como error MCP con `code`, `message` en español y `datos.motivo` en `{ no_encontrada, no_autorizado, temporal, invalido }`. Solo `temporal` es reintentable (`datos.reintentable: true`). El detalle nativo de Factusol se recorta a su primera línea y a 300 caracteres antes de salir del conector: una traza con estructura interna de Factusol no tiene por qué llegar al contexto del modelo ni a los registros de aguas abajo.

**Idempotencia.** Mismo mecanismo que Odoo: `clave_idempotencia` guarda junto a la nota la huella de los datos que la crearon; repetirla con los mismos datos devuelve la misma nota, con datos distintos sale `invalido`; el almacén vive en el proceso, guarda 1000 claves y una escritura en vuelo se registra antes del primer `await`. La garantía duradera entre reinicios sigue siendo del flujo de Temporal y del gateway.

**Credenciales.** Llegan solo por entorno, inyectadas por el gateway al lanzar el proceso, nunca en el código, el prompt, los registros ni como argumento de herramienta. El nombre exacto de las variables (extremo de Factusol MCP, usuario o clave de API, empresa o razón social si Factusol la exige) se fija con el mismo patrón que `connectors/odoo/src/entorno.ts` (validación al arrancar, fallo rápido nombrando lo que falta, redacción de secretos de al menos 8 caracteres antes de que un texto salga del proceso) una vez confirmada la superficie real de Factusol MCP.

## Criterios de hecho

1. `connectors/factusol` arranca como servidor MCP por stdio (`pnpm --filter @aiw/connector-factusol iniciar`) y anuncia exactamente dos herramientas, con los esquemas Zod del contrato de arriba, idénticos en forma a los de `connectors/odoo`. El transporte HTTP «streamable» se activa con una variable de bandera propia, siguiendo el patrón `ODOO_CONECTOR_HTTP`.
2. `listar_facturas_vencidas` devuelve la lista ordenada de más a menos días vencida, con `total` igual al número de facturas devueltas, y ninguna con `dias_vencida` por debajo del mínimo pedido. Una entrada fuera de rango sale como error con `motivo: invalido` y no llega a Factusol.
3. `crear_nota_seguimiento` crea la nota y devuelve `{ id, factura_id, tipo, creado_en }`. Con la misma `clave_idempotencia` devuelve el mismo `id` sin una segunda escritura. Un texto con HTML, vacío o de más de 2000 caracteres, o una `fecha_limite` con `tipo: 'nota'`, salen como `motivo: invalido`.
4. Una factura inexistente da `motivo: no_encontrada`; un usuario sin permiso, `no_autorizado`; una caída o un tiempo agotado de Factusol MCP, `temporal` con `reintentable: true`.
5. Ninguna salida ni ningún registro del conector contiene el valor de la credencial de Factusol: lo comprueba una prueba que ejecuta las dos herramientas con una clave sembrada y rastrea respuestas, errores y todo lo escrito en `stdout` y `stderr` (mismo patrón que `connectors/odoo/src/secretos.test.ts`).
6. Las pruebas de contrato contra la instancia de pruebas de Factusol corren solo con las credenciales presentes en el entorno, y se saltan con un mensaje que dice qué falta si no lo están. En la CI, sin acceso a Factusol, el mismo cuerpo de prueba corre sobre respuestas grabadas en `src/grabaciones/`, con datos inventados y sin un solo dato personal real.
7. `CI=1 pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build` y `pnpm evals:smoke` pasan en verde.
8. El caso dorado `cobros` de la prueba técnica del stack pasa sin cambios contra `connectors/factusol` cuando el gateway lo registre en vez de `connectors/odoo`: mismo prompt, mismo puesto, mismo resultado esperado, otro conector.
9. El README del conector deja de decir «este directorio no contiene código» y documenta: qué es Factusol MCP, la versión de imagen fijada, el mapeo exacto descubierto entre sus herramientas nativas y las dos del contrato, las variables de entorno y la frontera con el gateway — con el mismo nivel de detalle que `connectors/odoo/README.md`.

## Casos de prueba y de eval

- Unitario: esquemas Zod de entrada y salida de las dos herramientas (valores por defecto, límites, HTML rechazado, `fecha_limite` solo con `actividad`); mapeo de la factura nativa de Factusol al contrato, incluidos el identificador nativo, el importe pendiente, la moneda y el cálculo de `dias_vencida`; orden y recorte por `limite`; traducción de los fallos nativos de Factusol a los cuatro motivos, con una traza larga que debe llegar recortada; idempotencia por clave, con la misma clave y otros datos, con dos llamadas simultáneas y tras una escritura fallida.
- Contrato: las dos herramientas contra la instancia de pruebas de Factusol cuando el entorno está; en la CI, contra las grabaciones de `src/grabaciones/`, con datos inventados.
- Eval: sin comportamiento de agente nuevo. El caso dorado `cobros` de la prueba técnica no cambia: este conector expone el mismo contrato que `connectors/odoo` y `connectors/demo`, y se evalúa con él cuando el gateway lo registre para un tenant con Factusol. `pnpm evals:smoke` sigue en verde.
- Auditoría y contador: las emite el gateway al llamar a la herramienta, con un único punto de escritura en `packages/ledger`. El conector no escribe en el libro.
- Secretos: criterio de hecho 5, más el rastreo de credenciales literales en el paquete al estilo de `@aiw/connector-odoo` y `gitleaks` en la CI. `.env.example` lleva las variables de Factusol vacías o con `GENERAR`.

## Fuera de alcance

- Cifrado por tenant de las credenciales y resolución de `conector.referencia_secreto`: del gateway MCP (`packages/mcp-gateway`), zona crítica.
- Registrar el conector, su lista blanca y su nivel por puesto: la rebanada que sembró `autorizacion_herramientas` para Odoo, replicada para Factusol.
- Preparar la instancia de pruebas de Factusol con datos ficticios y las credenciales de un usuario de permisos mínimos, si no existe ya: es la pregunta abierta de esta especificación; si hace falta, es una rebanada de acceso propia, como lo fue «Solicitar cuenta de WhatsApp Business y preparar el acceso a Odoo y a Factusol MCP» y como lo fue el ADR-024 para la empresa de pruebas de Odoo.
- Más herramientas de Factusol (conciliación, previsión, administración): las piden las rebanadas de esos puestos, igual que en Odoo.
- Envío de recordatorios por correo o WhatsApp: rebanadas de canales.
- Migrar o adaptar nada del prototipo IAGENT-COMPANY: prohibido por `CLAUDE.md`, y no hace falta — Factusol MCP es un producto propio distinto y anterior a ese prototipo.

## Presupuesto de tokens

Presupuesto: 45 €. Comparado con el conector de Odoo (40 €, mismo tipo de rebanada y patrón), con un margen algo mayor por el trabajo de descubrimiento del contrato nativo de Factusol MCP en tiempo de ejecución, que Odoo no necesitó porque el proyecto de terceros ya estaba identificado por su nombre en un flujo de n8n existente. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

¿Existe ya, o la preparas tú como hiciste con la empresa de pruebas de Odoo (ADR-024), una instancia o empresa de pruebas de Factusol MCP con datos ficticios y un usuario de permisos mínimos contra la que el Constructor pueda descubrir el contrato nativo y grabar las respuestas de contrato? Sin ella, el Constructor no puede completar los criterios de hecho 6, 8 y 9, y esta rebanada quedaría bloqueada en cuanto se pase a Lista.
