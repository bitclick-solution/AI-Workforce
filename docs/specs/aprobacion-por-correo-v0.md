VIGENTE

# Especificación · Aprobación por correo con enlaces firmados y libro de auditoría v0

- Rebanada: [Notion](https://app.notion.com/p/3e053066189881d5abb0e56f66720bd8) · Ciclo 0 (Fase 0 · Definir y validar) · Tipo Plataforma · Paquetes `channels`, `ledger` · P0
- Rama: `rebanada/aprobacion-por-correo-v0`
- Plan de referencia: secciones sobre aprobación con borrador, niveles N0 a N3 y libro de auditoría del [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn); ADR-001 (borrador de aprobación con carga opaca e interfaz de aprobación genérica), ADR-003 (tarea y contador), ADR-005 (niveles y versiones inmutables), ADR-007 (modelo de datos, libro append-only con hash encadenado), ADR-010 (exportación en CSV y JSON y verificador de cadena de hashes).
- Zona crítica: sí: `packages/ledger` (libro de auditoría y contador), `packages/domain` (esquemas compartidos), `packages/db` (una corrección en el cliente, sin tocar el esquema) y `.github/workflows/ci.yml` (una línea en el filtro del job «Base de datos»). «Revisión humana obligatoria» marcada en la rebanada. Sin migración: el modelo v1 ya cubre el caso.

## Objetivo

Una persona recibe un correo con el resumen legible de lo que un agente quiere hacer, abre un enlace firmado que solo sirve una vez, y aprueba o rechaza desde una página genérica. La decisión llega al flujo de la tarea como señal, y tanto el envío como la apertura, la decisión y el vencimiento quedan en el libro de auditoría encadenado, exportable en CSV y JSON con la cadena verificada. Cuando esta rebanada está hecha, existe el primer camino completo de escritura del libro desde fuera de las pruebas, y el bucle del agente de la prueba técnica ya tiene contra qué pedir permiso.

## Paquetes tocados

- `apps/channels` (`@aiw/channels`): configuración, firma y verificación del enlace, plantilla del correo, páginas genéricas, servidor HTTP, adaptadores de correo y de señal, y reintentos. Su responsabilidad declarada ya era «WhatsApp, correo y enlaces de aprobación firmados de un solo uso»; ahora la cumple. Pasa a depender de `@aiw/db` y `@aiw/ledger`.
- `packages/ledger`: `src/aprobacion.ts` (solicitar aprobación, registrar decisión, vencer, y las anotaciones con nombre de acción fijo) y `src/exportar.ts` (exportación en CSV, JSON y JSON por líneas con verificación de rango de la cadena). Ficheros nuevos; `libro.ts` y `hash.ts` no se tocan.
- `packages/domain`: `src/puertos.ts`, un fichero nuevo con los contratos puros `PuertoDeCorreo` y `PuertoDeSenal` y el esquema Zod de la carga de la señal. Sigue sin depender de ningún paquete del monorepo.
- `packages/db`: una corrección en `src/cliente.ts` y su prueba de regresión. No se toca el esquema ni hay migración.
- `deploy/compose`, `.env.example`, `scripts`: servicio Mailpit de desarrollo con healthcheck y las variables de entorno de la rebanada.
- `.github/workflows/ci.yml`: una línea, `--filter @aiw/channels` en el job «Base de datos».

## Decisiones que el plan no fija

1. **El enlace no decide: muestra.** El correo lleva **un** enlace firmado, no dos. Abrirlo (`GET`) es idempotente y solo pinta el resumen legible con los botones aprobar y rechazar; la decisión viaja en un `POST`. Con dos enlaces que decidieran al abrirse, cualquier antivirus, pasarela o cliente de correo que precarga enlaces aprobaría el pago solo. El criterio de hecho («enlace de un solo uso con resumen legible y botones aprobar y rechazar») describe exactamente esta forma.
2. **El token es una firma HMAC-SHA256 sin estado, no un secreto guardado.** Formato `v1.<carga en base64url>.<firma en base64url>`; la carga lleva tenant, aprobación, tarea y caducidad. La alternativa —token aleatorio guardado con su hash— exigiría una tabla nueva y, por tanto, una migración en zona crítica para algo que la única de `decision_aprobacion` ya garantiza. La clave llega por entorno (`AIW_APROBACION_CLAVE_FIRMA`, `GENERAR` en `.env.example`), se exige de 32 caracteres para arriba al arrancar y nunca se registra. Rotarla revoca todos los enlaces vivos, que es la revocación que pide la definición de hecho.
3. **El un solo uso lo impone la base, no la aplicación.** No hay comprobación «¿ya se usó?» que sea fiable bajo concurrencia: dos clics simultáneos pasarían los dos. La garantía es el índice único `decision_aprobacion_tenant_aprobacion_key`; el segundo `INSERT` choca con `23505` y la aplicación lo traduce a la página «este enlace ya se usó», que además muestra el sentido de la decisión que sí quedó. Idempotente, no un error.
4. **Un enlace con firma inválida no escribe en el libro de nadie.** Si el token no verifica, no hay tenant al que atribuir la entrada: anotarla exigiría creer al atacante sobre en qué cadena escribir, y eso convierte el libro en un buzón abierto. Un token con firma válida pero caducado o ya usado sí se anota (`aprobacion.enlace.rechazado`, resultado `rechazado`), porque su firma prueba que lo emitimos nosotros. La firma inválida solo produce la página genérica y un aviso sin token.
5. **`resultado` dice si la plataforma completó la acción, no el sentido de la decisión.** Un rechazo es una acción con éxito: `aprobacion.rechazada` se anota con `resultado: 'exito'`. `error` queda para el envío que falla y la señal que no llega; `rechazado`, para el enlace que la plataforma se niega a atender.
6. **El vencimiento lo resuelve la plataforma con una decisión propia.** `decision_aprobacion.persona_id` es nulo «si la resolvió la plataforma por vencimiento o política» (ADR-007). Al vencer, se inserta la decisión con sentido `rechazada`, persona nula y motivo, se anota `aprobacion.vencida` y se entrega la señal: el flujo no se queda esperando para siempre. La rutina que lo llama en producción llega con «Notificaciones y plazos»; aquí está la función y su prueba.
7. **El correo y la señal son puertos con dos implementaciones.** Los contratos (`PuertoDeCorreo`, `PuertoDeSenal`) viven en `@aiw/domain` porque son tipos puros y el bucle del agente los va a necesitar sin importar `apps/channels`. Las implementaciones viven en `apps/channels`: correo en memoria (desarrollo y pruebas, captura lo enviado) y SMTP con `nodemailer`; señal en memoria y señal contra Temporal con `@temporalio/client`. El proveedor se elige por entorno, así que ninguna prueba necesita un servidor real.
8. **La bandera apagada deja el proceso como estaba.** `AIW_APROBACION_CORREO` viene a `0`. Con la bandera apagada, `main.ts` imprime y termina, igual que hoy; no abre puerto ni envía correo. Esto no es solo prudencia: el job «Imagen channels» de la CI ejecuta `docker run --rm aiw/channels:ci` y espera que el contenedor **salga**. Un servidor que arranca siempre colgaría ese job hasta el tiempo límite.
9. **Escribir la decisión vive junto al punto único de escritura del libro.** `packages/ledger/src/aprobacion.ts` inserta en `aprobacion` y en `decision_aprobacion` y llama a `anotar()` en la misma transacción. Podría vivir en `apps/channels`, pero entonces «cada decisión emite entrada» sería una convención del código de la aplicación en vez de una propiedad del módulo que la escribe. Al lado del libro, o quedan las dos escrituras o no queda ninguna, y además la prueba la cubre el job «Base de datos» que ya existe.
10. **La exportación verifica el rango, no toda la cadena.** `verificarCadena` de `hash.ts` empieza a contar en 1 y por tanto solo sabe verificar la cadena completa; exportar un mes de un tenant con un millón de entradas no puede recorrerla entera. `exportar.ts` añade `verificarRango`, que lee el hash de la entrada inmediatamente anterior al rango y comprueba desde ahí: contigüidad, encadenado y hash de cada eslabón. No se cambia `hash.ts` ni la firma de `calcularHash`. Si el rango empieza en la primera entrada, el eslabón esperado es el génesis.
11. **La exportación con la cadena rota falla, salvo que se pida lo contrario.** Por defecto `exportarLibro` lanza si la verificación no pasa: entregar evidencia alterada sin decirlo es peor que no entregarla. Con `exigirCadenaValida: false` exporta igual y deja el veredicto en la cabecera, porque un auditor que investiga una manipulación necesita justo esas filas.
12. **El CSV neutraliza fórmulas; el JSON es la evidencia fiel.** Un valor que empieza por `=`, `+`, `-`, `@`, tabulador o retorno de carro se exporta con un apóstrofo delante: `datos_referenciados` puede contener identificadores de sistemas externos, y una hoja de cálculo los ejecutaría. El CSV es para personas; el JSON y el JSON por líneas no tocan ningún valor y son los que se verifican.
13. **Las páginas son genéricas y no revelan si la aprobación existe.** ADR-001: interfaz de aprobación genérica. Token inválido, aprobación de otro tenant y aprobación inexistente producen la misma página y el mismo mensaje. El resumen legible se escapa antes de pintarlo y antes de meterlo en el correo: lo escribe un agente y ninguna de las dos salidas se fía de él. El borrador opaco no se muestra nunca: la página lo trata como carga que no interpreta.
14. **`crearConexion` de `@aiw/db` devolvía un cliente que no sabía mandar fechas.** No es una decisión, es un fallo que esta rebanada ha encontrado por ser la primera que escribe en el libro desde una aplicación. `drizzle()` sustituye los serializadores de fecha del cliente de postgres.js que recibe por la identidad, porque su capa trabaja con cadenas; como `crearConexion` le pasaba el mismo cliente que devuelve para las consultas crudas, cualquier `${new Date()}` —el `vence_en` de una aprobación, la hora de una entrada de auditoría— fallaba con «Received an instance of Date». Las pruebas no lo veían porque usan el cliente de `@aiw/db/pruebas`, que no pasa por Drizzle. El arreglo es mínimo: el constructor de consultas se pide con `crearDb()` y abre su propia conexión, y una prueba de regresión en `packages/db/src/pruebas/conexion.test.ts` manda un `Date` y lo recupera. Nadie más usaba `Conexion.db`, así que el cambio de API no rompe nada.
15. **La demo es un guion, no una secuencia de pasos a mano.** `pnpm --filter @aiw/channels demo:aprobacion` siembra una organización, pide un permiso, manda el correo, arranca el servidor y escribe el enlace por pantalla. Con `AIW_CORREO_PROVEEDOR=smtp` el correo sale hacia Mailpit y se lee en su interfaz. Una demo que se reproduce con un comando se repite; una lista de doce pasos, no.
16. **Mailpit entra en el Compose de desarrollo.** No había servidor de correo y sin uno la demo no se puede reproducir en la máquina de Jesús. `axllent/mailpit` con SMTP en 1025, interfaz en 8025 y healthcheck `mailpit readyz`. El job «Compose de desarrollo arranca» lo levantará porque el cambio toca `deploy/`.

## Endpoints, flujos y datos

### Datos

Ninguna migración. El modelo v1 cubre el caso entero:

- `aprobacion`: fila inmutable con `borrador_opaco`, `resumen_legible`, `clase_accion`, `nivel_exigido`, `persona_id` y `vence_en`. Se inserta cuando el agente pide permiso.
- `decision_aprobacion`: una fila por decisión, con la única `(tenant_id, aprobacion_id)` que da el un solo uso. `persona_id` nulo cuando decide la plataforma.
- `entrada_auditoria` y `contador_consumo`: por `anotar()`, sin excepción.
- `tarea.flujo_temporal_id`: el identificador del flujo al que se envía la señal se lee de la tarea de la aprobación. No se guarda en el token.

### Acciones que se anotan

Nombres fijos en `ACCIONES` de `packages/ledger/src/aprobacion.ts`, con `herramienta: 'correo'` cuando el camino es el enlace:

| Acción                        | Actor      | Resultado          | Cuándo                                                               |
| ----------------------------- | ---------- | ------------------ | -------------------------------------------------------------------- |
| `aprobacion.solicitada`       | agente     | `exito`            | Se inserta la aprobación.                                            |
| `aprobacion.correo.enviado`   | plataforma | `exito` \| `error` | Una entrada por intento de envío, con `duracion_ms`.                 |
| `aprobacion.enlace.abierto`   | persona    | `exito`            | `GET` del enlace con firma válida y aprobación viva.                 |
| `aprobacion.enlace.rechazado` | persona    | `rechazado`        | Firma válida pero caducada, ya decidida o de aprobación inexistente. |
| `aprobacion.aprobada`         | persona    | `exito`            | Decisión `aprobada` registrada.                                      |
| `aprobacion.rechazada`        | persona    | `exito`            | Decisión `rechazada` registrada.                                     |
| `aprobacion.vencida`          | plataforma | `exito`            | La plataforma resuelve por vencimiento.                              |
| `aprobacion.senal.entregada`  | plataforma | `exito` \| `error` | Una entrada por intento de entrega de la señal.                      |

Toda entrada lleva `tarea_id`, `paso_id` cuando existe, `datos_referenciados` con la aprobación (`{tipo:'aprobacion', id}`) y `aprobada_por_persona_id` en las decisiones humanas. Cada `anotar()` suma una acción al contador. No se pasan incrementos de `tareas` ni de `pasos`: esta rebanada no abre tareas ni escribe filas de `paso`; eso lo hace el bucle del agente.

### Rutas (`apps/channels`, `node:http`, solo con la bandera encendida)

| Ruta                        | Qué hace                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /salud`                | `200` con `{ estado: 'ok' }`. Sin token, sin base.                                                                                              |
| `GET /aprobaciones/:token`  | Verifica firma y caducidad, lee la aprobación con el tenant fijado, anota la apertura y pinta la página con el resumen y los dos botones.       |
| `POST /aprobaciones/:token` | Cuerpo `application/x-www-form-urlencoded` con `sentido=aprobar\|rechazar`. Registra la decisión, anota, entrega la señal y pinta el resultado. |

Cabeceras de toda respuesta HTML: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` y `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`. Sin cookies y sin JavaScript: el token es la única credencial y no se guarda en el navegador.

### Flujo

1. El agente pide permiso: `solicitarAprobacion()` inserta la fila y anota.
2. `enviarSolicitud()` firma el enlace, compone el correo con el resumen legible y lo envía por el puerto de correo, con reintentos y una entrada por intento.
3. La persona abre el enlace, ve el resumen y pulsa un botón.
4. `decidir()` registra la decisión y la anota en la misma transacción.
5. `entregarSenal()` envía la señal al flujo de la tarea (`flujo_temporal_id`, nombre configurable) con reintentos, y anota cada intento. Un fallo de señal no deshace la decisión: la decisión es la verdad y la señal se puede reintentar; la entrada de auditoría con `resultado: 'error'` deja constancia de lo que hay que reintentar.
6. `vencerAprobaciones()` resuelve las caducadas sin decisión.

### Entorno

`AIW_APROBACION_CORREO` (bandera, `0`), `AIW_APROBACION_CLAVE_FIRMA` (`GENERAR`), `AIW_APROBACION_URL_PUBLICA`, `AIW_APROBACION_PUERTO`, `AIW_APROBACION_VALIDEZ_HORAS`, `AIW_CORREO_PROVEEDOR` (`memoria` \| `smtp`), `AIW_CORREO_REMITENTE`, `AIW_CORREO_SMTP_HOST`, `AIW_CORREO_SMTP_PUERTO`, `AIW_CORREO_SMTP_USUARIO`, `AIW_CORREO_SMTP_TLS`, `AIW_SENAL_PROVEEDOR` (`memoria` \| `temporal`), `AIW_SENAL_NOMBRE`, `AIW_TEMPORAL_DIRECCION`, `AIW_TEMPORAL_ESPACIO`, `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`. La contraseña SMTP se lee de `AIW_CORREO_SMTP_CONTRASENA` y en `.env.example` queda vacía: en producción llega del gestor de secretos, nunca del repositorio.

## Criterios de hecho

1. Un enlace firmado abre una página con el resumen legible de la aprobación y dos botones, aprobar y rechazar, sin JavaScript y sin cookies. Abrirlo no decide nada.
2. El mismo enlace usado dos veces registra una sola decisión: el segundo intento devuelve la página «ya se usó» con el sentido de la primera, y anota `aprobacion.enlace.rechazado`. Una prueba lanza los dos `POST` en paralelo y comprueba que solo hay una fila en `decision_aprobacion`.
3. Un enlace caducado, uno manipulado en la carga o en la firma, y uno de otro tenant devuelven la página genérica sin revelar si la aprobación existe, y no escriben ninguna decisión. El manipulado no escribe tampoco entrada de auditoría; el caducado sí.
4. La decisión llega al flujo como señal por el puerto `PuertoDeSenal`, con el identificador de flujo de la tarea y el nombre configurado; la implementación de Temporal usa `@temporalio/client` y la de pruebas captura la entrega. Cada intento, con éxito o con error, anota.
5. Cada paso de la rebanada —solicitud, envío, apertura, rechazo del enlace, decisión, vencimiento y entrega de la señal— emite exactamente una entrada por `anotar()`, la cadena de hashes sigue verificando después de la secuencia completa, y el contador del periodo suma una acción por entrada. Una prueba contra PostgreSQL recorre el camino entero y lo comprueba.
6. `exportarLibro` devuelve el libro de un tenant y un rango de fechas en CSV, JSON y JSON por líneas, con el veredicto de verificación de la cadena en la cabecera; con una entrada alterada, la exportación falla por defecto y, con `exigirCadenaValida: false`, exporta y marca el veredicto como no válido indicando en qué número de orden se rompe.
7. Con la bandera `AIW_APROBACION_CORREO` apagada no se abre puerto ni se envía correo, y el proceso de `apps/channels` termina como antes de esta rebanada. Una prueba comprueba que la configuración con la bandera apagada no exige clave de firma.
8. `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build` y `pnpm evals:smoke` pasan. El job «Base de datos» de la CI ejecuta además las pruebas de `@aiw/channels`, y sin `DATABASE_URL` esas pruebas se saltan con el mensaje de `@aiw/db/pruebas`.
9. `pnpm dev:up` levanta Mailpit sano y el correo de la demo se ve en su interfaz; el fichero del Compose valida con `docker compose config`.
10. `pnpm --filter @aiw/channels demo:aprobacion` con `DATABASE_URL` y la bandera encendida deja un enlace abierto en el navegador; abrirlo muestra el resumen, aprobar registra la decisión y volver a enviar el formulario dice que ya se usó. Una prueba de regresión en `@aiw/db` comprueba que el cliente de `crearConexion` manda y recibe fechas.

## Casos de prueba y de eval

### Unitario, sin base de datos

- **Firma**: ida y vuelta de firmar y verificar; carga manipulada, firma manipulada, firma de otra clave, versión desconocida, token sin las tres partes, token vacío, base64url no válida, caducidad pasada. La comparación de firmas usa `timingSafeEqual` y una prueba comprueba que una firma de longitud distinta no lanza.
- **Configuración**: con la bandera encendida y sin clave, falla al arrancar con mensaje claro; con clave corta, falla; con la bandera apagada, no exige nada. Ninguna función de configuración devuelve la clave en su representación de texto, y una prueba lo comprueba serializando la configuración entera.
- **Plantilla y páginas**: el resumen legible con `<script>`, con comillas y con `&` sale escapado en el HTML del correo y de las páginas; el borrador opaco no aparece en ninguna salida; el token aparece en el enlace del correo y **no** aparece en el HTML de la página de resultado.
- **Reintentos**: falla dos veces y acierta a la tercera; agota los intentos y lanza el último error; no reintenta un error marcado como definitivo; espera entre intentos según el retardo configurado.
- **Correo en memoria**: captura asunto, destinatario y cuerpos; el doble envío guarda dos.
- **Exportación**: CSV con comillas, comas y saltos de línea dentro de un valor; neutralización de fórmulas; JSON y JSON por líneas fieles; `verificarRango` con rango completo, rango intermedio, hueco en el número de orden, eslabón que no encadena y entrada alterada.

### Integración contra PostgreSQL (`@aiw/ledger` y `@aiw/channels`)

- Camino completo: solicitar, enviar, abrir, decidir, señal y exportar, sobre la organización sembrada de `@aiw/db/pruebas`; la cadena verifica y el contador cuadra con el número de entradas.
- Seguridad: enlace reutilizado (secuencial y concurrente), enlace caducado, enlace manipulado, enlace de otro tenant contra la aprobación de un tenant distinto, y aprobación inexistente.
- Vencimiento: `vencerAprobaciones` resuelve la caducada sin decisión, no toca la que tiene decisión, y es idempotente si se ejecuta dos veces.
- Camino de error: el envío que falla siempre anota `error` y deja la aprobación sin decisión; la señal que falla siempre no deshace la decisión ya registrada.
- Exportación: rango que excluye entradas, rango vacío, y exportación con una entrada alterada a mano por el rol migrador.

### Eval

No aplica: la rebanada no añade comportamiento de agente. El agente aquí es un actor que pide permiso, y quien decide es una persona. El primer caso dorado llega con la prueba técnica del bucle del agente, que es la que decide cuándo pedir aprobación.

### Auditoría y contador

Cubierto por el criterio 5: la prueba de integración cuenta las entradas de la secuencia, comprueba los nombres de acción contra `ACCIONES`, verifica la cadena con `verificarCadenaEnBase` y compara `contador_consumo.acciones` con el número de entradas anotadas.

### Secretos

`buscarSecretos` de `@aiw/db/pruebas` corre ya sobre `packages/ledger`. Se añade la misma prueba para `apps/channels`. Ninguna clave se escribe en el código ni en las pruebas: la clave de firma de las pruebas sale de `randomBytes`. Prueba explícita de que el token no aparece en ningún mensaje de error ni en ninguna traza que la aplicación emita, y de que la representación de texto de la configuración no contiene la clave.

## Fuera de alcance

- **Bandeja humana, preferencias por canal, plazos y suplencias** (tabla `notificacion`): rebanada de `@aiw/notifications`. Aquí el registro de que el correo salió es la entrada `aprobacion.correo.enviado` del libro, que es lo que pide el criterio.
- **Señal de aprendizaje** (tabla `senal`, `edicion_previa`, lección): rebanada «Aprendizaje v0». Aquí la decisión es aprobar o rechazar; el sentido `editada` y su edición previa llegan con el panel, que es donde se puede editar un borrador cuya forma sí se conoce.
- **Panel de aprobaciones pendientes en `apps/web`**: rebanada del panel. La consulta «aprobaciones sin decisión» ya está medida en el banco de carga de `@aiw/db`.
- **El flujo durable de la tarea y el bucle del agente**: rebanada «Prueba técnica del stack». Aquí solo se entrega la señal a un flujo que existe o no; si no existe, el intento anota `error`.
- **Motor de políticas y evaluación de niveles N0 a N3**: rebanada «Políticas y niveles». Aquí `nivel_exigido` se copia a la entrada de auditoría como `nivel_aplicado` y no se decide nada con él.
- **WhatsApp y el resto de canales**: rebanadas propias, con el mismo puerto.
- **Rutina que llama a `vencerAprobaciones`**, exportación programada a S3 o SFTP, informe PDF y paquete de evidencias del ADR-010: fase 2.
- **Deuda conocida 1 de «Modelo de datos v1»** (función `SECURITY DEFINER` que retire el `INSERT` directo a `aiw_app` sobre `entrada_auditoria`): la especificación de esa rebanada la apuntaba a esta. Se deja abierta a propósito: exige una migración nueva y cambiar `libro.ts`, que es el fichero donde trabaja en paralelo la rebanada «Contador de tareas v0». Hacerlo aquí garantizaba un conflicto en la zona más crítica del repositorio. Se paga en una rebanada propia, después de fusionar las dos.

## Presupuesto de tokens

Presupuesto propuesto: 45 €, y así se fija en «Presupuesto tokens (€)» del tablero, que estaba vacía. Referencia: «Modelo de datos v1» trabajó con 60 € y tocaba tres paquetes, una migración de 37 tablas y un banco de carga; esta toca dos paquetes y una aplicación, sin migración. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

¿El enlace del correo tiene que permitir **editar** el borrador antes de aprobar? El enum `sentido_decision` tiene `editada`, `decision_aprobacion` guarda `edicion_previa` y el ADR-005 llama a la edición «la señal más valiosa», pero el ADR-001 dice que el borrador es una carga opaca que el plano de control no interpreta: una interfaz genérica no sabe qué campos ofrecer sin romper esa frontera. Esta rebanada entrega aprobar y rechazar, y deja `editada` para el panel. Si la respuesta es que el correo también edita, hace falta una decisión previa sobre quién describe la forma editable de cada clase de acción: el registro de herramientas es el candidato.

## Seguimiento 2-10 · El correo sale solo al crearse la aprobación

Hallazgo de la Parte B real de «Bitclick como primera organización» (1-10): `enviarSolicitud()` nunca se llama en producción. Hoy alguien tiene que invocarla a mano (`apps/channels/src/pruebas/demo.ts` es el único sitio que lo hace); el criterio de hecho 5 de esa rebanada solo se cumplió con un guion temporal fuera del repositorio. Esta sección fija la decisión antes del código, como pide el método.

1. **El punto de arranque es `solicitarAprobacion()`, no un sondeo del bucle del agente.** `apps/worker` no puede importar `apps/channels` (fronteras de arquitectura), así que el aviso tiene que salir de donde ya se escribe la aprobación: `packages/ledger/src/aprobacion.ts`, en la misma transacción que el `insert` y el `anotar()`. Si esa transacción se deshace, el aviso se deshace con ella.
2. **El mecanismo es la salida transaccional de eventos que ya existe, sin publicador todavía.** `evento_salida` (`packages/db/src/observacion.ts`) ya la usa `packages/ledger/src/contador.ts` para el panel («un proceso aparte lo publica»); hoy no hay ningún proceso que lea `evento_salida`, de ningún destino. `solicitarAprobacion()` añade una fila con `tipo: 'aprobacion.creada'`, `destino: 'correo'` y `carga: { version: 1, aprobacionId }`; es la primera vez que algo la consume de verdad. `packages/ledger/src/salida.ts` (nuevo) expone leer los pendientes de un destino y marcar cada uno publicado o fallido — funciones genéricas, no solo para aprobaciones, para que el primer consumidor de `evento_salida` fije el contrato que use también el panel el día que tenga el suyo.
3. **El consumidor vive en `apps/channels/src/main.ts`, el proceso que ya corre durante la demo.** Un temporizador, solo si `AIW_APROBACION_CORREO` está encendida (la misma bandera, el mismo bloque que ya arranca el servidor), sondea los eventos pendientes de los tenants que diga `AIW_APROBACION_TENANTS` (lista de UUID separados por comas, nueva variable) y llama a `servicio.enviarSolicitud(tenantId, aprobacionId)` por cada uno. Un fallo (SMTP caído, aprobación ya decidida) marca el evento `fallido` con el motivo; `enviarSolicitud()` ya agota sus propios reintentos antes de lanzar, así que no hay reintento doble.
4. **Por tenant, no cualquier tenant.** Leer `evento_salida` de un tenant va por `conTenant`, igual que todo lo demás: ninguna fila de RLS se salta. Barrer **todos** los tenants a la vez pide un rol con privilegio que hoy no existe (`aiw_app` es el único rol de aplicación); crearlo es una decisión de zona crítica propia, no de esta rebanada urgente antes de la demo del viernes. `AIW_APROBACION_TENANTS` es la lista explícita de qué tenants vigila este proceso; para Bitclick, el único real hoy, es el `tenantId` que imprime `bitclick:sembrar`. Añadir un tenant es añadir un UUID a la lista, no un cambio de código.
5. **Sin variable, nada cambia.** `AIW_APROBACION_TENANTS` vacía o ausente es el valor por defecto: el temporizador no arranca, ningún evento se consume, y el comportamiento es exactamente el de antes de este seguimiento. Bandera de funcionalidad sobre bandera de funcionalidad: hace falta encender `AIW_APROBACION_CORREO` y además listar al menos un tenant.

### Criterio de hecho añadido

11. Al crearse una aprobación, `evento_salida` recibe una fila `tipo: 'aprobacion.creada'`, `destino: 'correo'` en la misma transacción (si la inserción de la aprobación falla, no hay evento). Con `AIW_APROBACION_CORREO=1` y el tenant en `AIW_APROBACION_TENANTS`, el proceso de `apps/channels` la consume sin intervención manual y manda el correo; sin esa variable, no consume nada y no hay regresión sobre el comportamiento anterior. Una prueba de integración cubre el camino completo: solicitar la aprobación, comprobar la fila pendiente, dejar que el consumidor la procese, y comprobar que queda `publicado` y que `enviarSolicitud` se llamó.
