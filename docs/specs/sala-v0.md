VIGENTE

# Especificación · Sala v0: sala general con moderador y contratación desde una frase

- Rebanada: [Notion](https://app.notion.com/p/3e05306618988173beb1e47e16a9bb8b) · Ciclo 0 · Tipo Producto · Paquetes `rooms`, `platform-agents`, `web` (más `operaciones`, `worker`, `api` y `models`, ver decisión 1) · P0
- Rama: `rebanada/sala-v0`
- Plan de referencia: _Departamentos y sala común_ y _Ciclo de vida sin código_ del [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn); [ADR-003](../adr/ADR-003.md), [ADR-004](../adr/ADR-004.md), [ADR-006](../adr/ADR-006.md), [ADR-014](../adr/ADR-014.md) y [ADR-019](../adr/ADR-019.md) (en Propuesto). Producto: [diez minutos](../producto/experiencia-de-diez-minutos.md) (pasos 5 y «un puesto más»), [finanzas](../producto/finanzas.md) y [Director de IA](../producto/director-de-ia.md).
- Zona crítica: sí. La ejecución de «contratar» concede la lista blanca de herramientas al puesto nuevo (identidad y permisos) y anota en el libro con `anotar`. No toca prompts de sistema de plataforma: el moderador y el Director v0 no tienen prompt (decisión 2). Sin migración. «Revisión humana obligatoria» marcada.

## Objetivo

Una persona escribe en la sala general. El moderador clasifica el mensaje con la ficha de cada puesto y da la palabra a un agente (una intervención, dos como máximo) o pasa la petición al Director de IA. La pregunta «¿cómo vamos de cobros este mes?» produce una intervención de Cobros con datos agregados del ERP; la frase «contrata un agente de conciliación en Finanzas» produce una propuesta de operación del ADR-006 con ficha, herramientas, guardrails, nivel inicial y coste, que se confirma con un clic y deja el puesto en prueba presentándose en la sala. Todo es dato: ningún paso necesita código nuevo por organización ni por puesto.

## Paquetes tocados

- `packages/rooms`: moderador puro (clasificación por temas de la ficha, menciones, detección de operación de organización, límite de intervenciones), vocabulario de adjuntos de la sala y nombres de flujos y señales.
- `packages/operaciones` (nuevo): Director de IA v0 puro, catálogo de plantillas de Finanzas como dato versionado (`src/catalogo/plantillas.json`) y política de operaciones evaluada con `decidirPaso` de `@aiw/domain`. `apps/platform-agents` solo declara que depende de él.
- `apps/worker`: flujos `mensajeDeSala` y `propuestaDeOperacion`, sus actividades y la demostración `demo:sala`. `tareaAgente` gana `soloLectura` para las intervenciones.
- `apps/api` y `apps/web`: rutas de la sala detrás de bandera y token, y la página `/panel/sala`.
- `packages/models`: el guion de Cobros responde con datos agregados cuando no se le ofrece la herramienta de escritura. El puerto no cambia.
- `packages/evals`: casos dorados del moderador y del Director.

## Endpoints, flujos y datos

- `GET /sala/mensajes`, `POST /sala/mensajes` y `POST /sala/propuestas/:id/decision` en `apps/api`, detrás de `AIW_SALA_V0=1` y `AIW_SALA_TOKEN`, con cabeceras `x-aiw-tenant` y `x-aiw-persona` hasta que exista identidad. El `POST` solo arranca o señala flujos; toda escritura la hace una actividad.
- `mensajeDeSala` (id `sala-mensaje-<mensajeId>`): publica el mensaje, modera, abre cada intervención como tarea raíz de origen `sala` y la ejecuta como flujo hijo `tareaAgente` en solo lectura, o crea la propuesta con el Director y arranca `propuestaDeOperacion` (id `propuesta-<id>`), que sobrevive al padre.
- `propuestaDeOperacion`: espera la señal `decisionDePropuesta` con caducidad de siete días y política de respaldo «rechazar y avisar en la sala» (ADR-014); al aprobarse ejecuta la contratación de forma idempotente.
- Tablas existentes, sin migración: `sala`, `sala_participante`, `mensaje`, `intervencion`, `tarea`, `propuesta_operacion`, `puesto` (ficha con temas y plantilla de origen), `version_puesto`, `autorizacion_herramientas`, `entrada_auditoria`.

## Criterios de hecho

1. «¿cómo vamos de cobros este mes?» en la sala general produce una fila `intervencion` de Cobros con el motivo del moderador y un mensaje de Cobros con el número, el importe total y la antigüedad máxima de las facturas vencidas, sin detalle por cliente.
2. El moderador nunca da la palabra a más de dos agentes por mensaje, obedece a las menciones y calla cuando ningún puesto tiene el tema.
3. «contrata un agente de conciliación en Finanzas» crea una `propuesta_operacion` de tipo `contratar`, estado `pendiente` y nivel `n1`, con ficha, herramientas (disponibles y por conectar), guardrails por clase de riesgo, niveles iniciales, coste estimado y forma de reversión, y un mensaje del Director con la tarjeta.
4. Confirmarla con un clic deja el puesto «Conciliación bancaria» en `en_prueba` con versión, lista blanca limitada a las herramientas del conector activo, participación en la sala y un mensaje de presentación. Repetir la confirmación no crea nada más.
5. Cada acción anota en el libro: `sala.mensaje_publicado`, `sala.moderacion_decidida`, `sala.intervencion_abierta`, `tarea.contada` de la intervención, `propuesta.creada`, `propuesta.aprobada` o `propuesta.rechazada` o `propuesta.caducada`, y `puesto.contratado`. El contador suma una tarea por intervención; moderar y contratar no consumen.
6. `pnpm --filter @aiw/worker demo:sala --auto` recorre los dos casos de punta a punta con el Compose de desarrollo y termina con la cadena de auditoría verificada.

## Casos de prueba y de eval

- Unitario: moderador (tema, mención, límite, silencio, operación, puestos pausados fuera), Director (frase con y sin departamento, plantilla desconocida, puesto ya existente, herramientas que faltan), rutas de la API (bandera, token, validación) y guion de Cobros en solo lectura.
- Integración con PostgreSQL: las actividades de la sala de punta a punta, idempotencia de cada una y de la contratación, y caducidad.
- Temporal: los dos flujos con el servidor de pruebas; se saltan con motivo si no se puede descargar, como las demás.
- Eval: `sala-moderador-001` y `director-contratar-001` en los evals de humo.
- Auditoría y contador: las pruebas cuentan las acciones del criterio 5 y verifican la cadena.
- Secretos: la prueba rastrea el secreto del conector por mensajes, propuestas y libro.

## Decisiones que el plan no fija

1. **Flujos en el trabajador y agentes puros en paquetes.** El moderador puro vive en `@aiw/rooms` y el Director puro en `@aiw/operaciones`, un paquete nuevo, para que ninguna aplicación importe otra. El trabajador los ejecuta como actividades: así corren en el job de flujos durables de la CI, con PostgreSQL y Temporal, sin tocar `.github/`. El proceso propio de `apps/platform-agents` con su cola llega cuando moderador y Director tengan paso de modelo.
2. **Moderador y Director sin modelo en v0.** Deciden con reglas sobre datos (temas de la ficha, menciones, verbos de operación, catálogo de plantillas). Coste cero, sin prompt de sistema y reproducibles. Los agentes de puesto sí usan el puerto de `@aiw/models` tal como está.
3. **La intervención es de solo lectura.** Responde con datos agregados; convertirla en trabajo con aprobaciones es «De conversación a trabajo», otra rebanada.
4. **Temas y plantilla de origen en `puesto.ficha`.** Sin migración; la columna de origen del ADR-019 llega con su rebanada.
5. **Coste de la propuesta:** `coste_estimado_euros` guarda el precio mensual de referencia para el cliente; `efectos_previstos.coste` añade tareas al mes y coste de modelos.
6. **El tope de dos vale también con menciones y con «@todos».** El plan admite más «si la persona lo pide»; en v0 el tope es fijo y el motivo del moderador nombra a los que se quedan fuera. Pedir más llega con los hilos.
7. **Caducidad:** siete días; al vencer, la propuesta pasa a `rechazada` con motivo «caducada» y se anota `propuesta.caducada`.

## Fuera de alcance

Simulación en sombra y ficha para el comité (_Director de IA_), sala por departamento e hilos (_Sala v1_), acuerdos y «enséñale», WhatsApp, página del agente (ADR-019), aprobaciones desde la intervención (_De conversación a trabajo_), identidad real (_Identidad y organizaciones_) y fan-out por Centrifugo: la página consulta cada dos segundos.

## Presupuesto de tokens

Presupuesto: 40 €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Demo

1. `pnpm dev:up` y `pnpm --filter @aiw/db db:migrar`.
2. `AIW_PRUEBA_STACK=1 pnpm --filter @aiw/worker demo:sala --auto`: pregunta, intervención de Cobros, propuesta del Director, clic, puesto en prueba, cadena verificada y recuento del libro.

En el navegador: `AIW_PRUEBA_STACK=1 pnpm --filter @aiw/worker demo:sala --servir` siembra, deja el trabajador escuchando e imprime el tenant y la persona. Arranca `apps/api` con `AIW_SALA_V0=1`, `AIW_SALA_TOKEN` y `DATABASE_URL`, y `apps/web` con `AIW_SALA_V0=1`, `AIW_API_URL`, `AIW_SALA_TOKEN`, `AIW_SALA_TENANT` y `AIW_SALA_PERSONA`; abre `/panel/sala`. Capturas del recorrido: [propuesta](../producto/capturas/sala-v0-propuesta.png) y [contratado](../producto/capturas/sala-v0-contratado.png).

## Pregunta abierta

¿El moderador v1 pasa por el puerto de modelos con su prompt de sistema (zona crítica, revisión tuya en cada cambio) o se queda con las reglas sobre la ficha y usa el modelo solo cuando ningún tema encaja?
