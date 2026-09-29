VIGENTE

# Especificación · Sala v1: salas por equipo y presencia en vivo por Centrifugo

- Rebanada: [Notion](https://app.notion.com/p/3e6530661898810da80dcd4e69b7dea2) · Ciclo 2 (adelantada) · Tipo Plataforma · Paquetes `rooms`, `db`, `api`, `worker`, `web` · P0
- Rama: `rebanada/sala-v1-presencia`
- Plan de referencia: [ADR-022](../adr/ADR-022.md) (salas estilo Discord con estados de presencia). Punto de partida: [Sala v0](sala-v0.md), `packages/rooms`, `packages/db/src/salas.ts` (`sala`, `sala_participante`), Centrifugo v6 en `deploy/compose`.
- Zona crítica: sí. Toca una migración de `packages/db`, los tokens de conexión y de canal de Centrifugo, y añade entradas nuevas al libro de auditoría (`sala.miembro_anadido`, `sala.miembro_quitado`). «Revisión humana obligatoria» marcada en la rebanada.

## Objetivo

La sala general y, por primera vez, una sala por departamento («equipo»), con quién está en cada una, en qué estado y quién escribe, en vivo y sin la consulta cada dos segundos de la v0. Centrifugo reparte mensajes, presencia y «escribiendo»; PostgreSQL sigue siendo la única verdad de lo que se dice y de quién es miembro. La interfaz la construye en paralelo el Diseñador (Sala v1 · interfaz estilo Discord) sobre el contrato de `apps/web/lib/sala-contrato.ts`.

## Paquetes tocados

- `packages/rooms`: función pura de presencia (`presencia.ts`, ADR-022), vocabulario del canal y del flujo de sincronización de equipo (`sala.ts`), y el cliente de Centrifugo —tokens y API HTTP— en `centrifugo.ts`, expuesto como `@aiw/rooms/centrifugo` y no desde el índice del paquete (ver decisión 1).
- `packages/db`: columna `sala_participante.ultima_lectura_en` (migración `0005_sala_v1_ultima_lectura`).
- `apps/worker`: actividad `asegurarSalaDeEquipo` (crea la sala del departamento y sincroniza sus participantes) y el flujo `sincronizarSalaDeEquipo`; aviso a Centrifugo (`avisarSala`, best-effort) cada vez que se inserta un mensaje.
- `apps/api`: rutas nuevas bajo `/sala` (salas de la persona, miembros, token, leído, escribiendo) y `salaId` opcional en las de la v0.
- `apps/web`: `apps/web/lib/sala-contrato.ts` (copia literal), `crearFuenteDeSala()` y el cliente mínimo de Centrifugo en `apps/web/lib`, y los manejadores de ruta de Next bajo `apps/web/app/api/sala/**`. No toca `apps/web/app/panel/sala/**` ni `packages/ui` (son del Diseñador).

## Endpoints, flujos y datos

- `GET /sala/salas`, `GET /sala/:salaId/miembros`, `POST /sala/:salaId/token`, `POST /sala/:salaId/leido`, `POST /sala/:salaId/escribiendo` en `apps/api`, detrás de `AIW_SALA_V1=1` además de `AIW_SALA_V0=1` y `AIW_SALA_TOKEN` (mismo token, misma comprobación). `GET /sala` acepta `?salaId=` y `POST /sala/mensajes` acepta `salaId` en el cuerpo; sin él, la sala general, igual que en v0.
- Canal de Centrifugo: `sala:<tenantId>:<salaId>`, privado (necesita token de suscripción). Token de conexión y de canal firmados con `CENTRIFUGO_TOKEN_HMAC_SECRET_KEY`, de cinco minutos, minteados en `apps/api` y nunca en el navegador. El navegador recibe la URL pública del WebSocket (`AIW_CENTRIFUGO_WS_URL`) desde el manejador de ruta de Next, no del entorno del navegador.
- Flujo `sincronizarSalaDeEquipo` (Temporal, id `sala-equipo-<departamentoId>`): llama a la actividad `asegurarSalaDeEquipo`, que crea la sala del departamento si falta (`ambito = 'departamento'`, nombre `Sala de <departamento>`) y sincroniza `sala_participante` con los puestos `activo`/`en_prueba` del departamento y con quien lo supervisa.
- Migración `packages/db/drizzle/0005_sala_v1_ultima_lectura.sql`: añade `sala_participante.ultima_lectura_en` (nulo = nunca ha leído). Ninguna tabla nueva: la presencia de las personas no se guarda (ver criterios de hecho).

## Criterios de hecho

1. La sala general y una sala por equipo (una por departamento), creada por `sincronizarSalaDeEquipo`, con sus participantes —personas y puestos— en `sala_participante`.
2. Añadir y quitar un participante de la sala de un equipo deja su propia entrada en el libro (`sala.miembro_anadido`, `sala.miembro_quitado`).
3. `GET /sala/salas` da las salas de la persona con `sinLeer` y `menciones`; `GET /sala/:salaId/miembros` da los miembros de esa sala con su estado, y solo a quien es miembro (403 al resto).
4. Centrifugo reparte mensajes (aviso `{ tipo: 'mensaje' }` en cada `insertarMensaje` nuevo), presencia (`presence`/`join`/`leave` nativos del canal) y «escribiendo» (publicación efímera con caducidad); `crearFuenteDeSala().suscribir` deja de sondear cada dos segundos mientras Centrifugo responde.
5. Los tokens de conexión y de canal son por persona, con su organización y su sala ya fijadas en el propio token: uno de una sala no sirve para otra ni para otra organización (`packages/rooms/src/centrifugo.test.ts`).
6. Estados de las personas: en la sala (conectada, activa hace menos de diez minutos), inactiva (conectada, diez minutos o más sin actividad) y añadida (sin conexión); «escribiendo» es una publicación efímera de unos segundos. Los agentes derivan su estado de lo que ya existe: `puesto.estado = 'pausado'` → en pausa; una aprobación pendiente de una persona para una tarea del puesto → te necesita; una tarea `en_curso` del puesto → trabajando; `propuesto` → añadido; `degradado` → inactivo; el resto → en la sala. «Escribiendo» gana a cualquier otro estado, para personas y para agentes.
7. La presencia de las personas se muestra en vivo y no se guarda: `EntradaPresenciaPersona.conectada` viene de la presencia de Centrifugo y `ultimaActividadMs` de un mapa en memoria del proceso de `apps/api` (nunca de PostgreSQL ni del libro); cada persona puede aparecer como desconectada.
8. `calcularEstadoDePresencia` (`packages/rooms/src/presencia.ts`) es una función pura, con una prueba por cada uno de los siete estados de la hoja del lienzo del ADR-022.
9. Aislamiento entre organizaciones probado en `apps/api/src/pruebas/sala-puerto.test.ts`; caída de Centrifugo probada ahí mismo y en `apps/web/lib/sala.test.ts`: la sala sigue funcionando con consulta periódica.

## Casos de prueba y de eval

- Unitario: `packages/rooms/src/presencia.test.ts` (los siete estados y «escribiendo» ganando a cada uno), `packages/rooms/src/centrifugo.test.ts` (tokens, publicar, presencia), `apps/api/src/rutas/sala.test.ts` (rutas nuevas y `salaId` opcional en las de v0, con puerto falso), `apps/web/lib/centrifugo-cliente.test.ts` y `apps/web/lib/sala.test.ts` (fuente real: HTTP, WebSocket falso, presencia por `join`/`leave`, caída y consulta periódica).
- Integración con PostgreSQL: `apps/api/src/pruebas/sala-puerto.test.ts` (miembros, sin leer y menciones, token, aislamiento) y `apps/worker/src/pruebas/sala-equipo.test.ts` (alta y baja de participantes con su entrada en el libro, y el aviso a Centrifugo al publicar un mensaje). Todas se saltan con motivo sin `DATABASE_URL`, como el resto del monorepo.
- Eval: ninguno nuevo. Esta rebanada no añade comportamiento de agente —el estado del agente es una proyección de datos que ya existían—, así que no hay caso dorado que sumar ni certificación que bajar.
- Auditoría y contador: `sala.miembro_anadido` y `sala.miembro_quitado` se comprueban en `apps/worker/src/pruebas/sala-equipo.test.ts` contando en el libro. Ninguna acción de esta rebanada suma al contador de tareas: sincronizar una sala de equipo no es una tarea de agente.
- Secretos: `packages/rooms/src/secretos.test.ts` (nuevo, misma regla que `@aiw/db`) cubre el módulo de Centrifugo; `apps/api/src/secretos.test.ts` y los de `@aiw/worker` no cambian de alcance. El HMAC y la clave de la API de Centrifugo solo llegan del entorno; el navegador solo recibe el JWT ya firmado y la URL pública del WebSocket.

## Fuera de alcance

- Hilos, mensajes fijados, reacciones y mensajes directos (fuera de alcance de la propia rebanada en Notion).
- Historial de la presencia de las personas: no hay tabla, no hay migración para ella y no entra en el libro.
- La interfaz (Sala v1 · interfaz estilo Discord, Diseñador) y quién ve cada sala por rol o departamento («Personas, roles y permisos por equipo», «Ámbitos de datos por rol en la sala y en el panel»).
- La operación «crear departamento» todavía no tiene actividad propia en este código: `asegurarSalaDeEquipo` queda lista para que esa rebanada la llame; hasta entonces, esta rebanada la invoca explícitamente en sus pruebas y quedaría pendiente de enganchar a un paso real de alta de departamento.

## Decisiones que el plan no fija

1. **Solo son miembros de la sala de un equipo sus puestos y quien lo supervisa, por ahora.** La persona no tiene departamento propio en el modelo de datos todavía (lo fija «Personas, roles y permisos por equipo», fuera de alcance aquí), así que `sala_participante` de una sala de equipo la componen únicamente los puestos de ese departamento y quien lo supervisa; ninguna otra persona ve sus mensajes, sus miembros ni su presencia (`esMiembro` lo exige en toda ruta que pide una sala por id, incluidas `GET /sala` y `POST /sala/mensajes`). La limitación conocida es la contraria: quien debería poder unirse a un equipo según los roles del negocio pero no tiene un puesto ni la supervisión de ese departamento se queda fuera hasta que exista un modelo de departamento por persona.
2. **La privacidad de la presencia se aplica en la consulta, no con RLS por persona.** Las políticas de RLS de este modelo son por `tenant_id`, no por persona (no existe ese concepto de fila); «solo los miembros ven la presencia de su sala» lo aplica `atenderSala` comprobando `esMiembro` antes de responder. Encaja con la decisión de la sesión de dirección del 30 de septiembre: por defecto, cerrado a quien no es miembro.
3. **La actividad de una persona («última actividad») se mide por su tráfico con la API de la sala**, no por un latido dedicado: el contrato de `FuenteDeSala` no tiene un método de latido, y añadir tráfico solo para eso habría sido inventar una llamada que el contrato no pide. Cada `POST` (token, leído, escribiendo) y cada lectura de salas cuenta como actividad; queda en memoria del proceso de `apps/api` y se pierde al reiniciar, que es justo lo que toca para algo que no se guarda.
4. **`@aiw/rooms/centrifugo` es una exportación aparte del índice del paquete.** Usa `node:crypto`, y el índice lo importa `apps/worker/src/flujos`, que Temporal empaqueta para un entorno sin módulos nativos de Node. Se descubrió porque `pnpm --filter @aiw/worker test` falla de verdad si el paquete de flujos arrastra algo que el entorno aislado no permite (prueba `paquete-de-flujos.test.ts`); sin esa prueba, el error solo habría aparecido en producción.
5. **`deploy/compose/centrifugo/config.json`** se escribió con el esquema de configuración de Centrifugo v6 tal como lo documenta el propio proyecto, pero no se pudo arrancar el contenedor en esta sesión (sin Docker disponible) para comprobarlo contra el Compose real. Pide verificación explícita antes de la demostración: que el canal `sala:` exige token de suscripción y que `presence`/`join_leave` quedan activos.

## Presupuesto de tokens

Presupuesto: 45 €. Consumo real: alrededor de 30-35 € en tokens de Claude (Sonnet 5) por la exploración extensa del monorepo antes de escribir código —necesaria porque la rebanada toca cinco paquetes y una app en paralelo con el Diseñador— más la implementación, las pruebas y las correcciones (el empaquetado de Temporal detectó y corrigió una violación real de la frontera del entorno aislado). Es una estimación de esta sesión, no una factura: regístrese el coste exacto en la rebanada al abrir el PR si el tablero de facturación lo da con más precisión.

## Pregunta abierta

¿El umbral de diez minutos de inactividad y que una persona pueda «aparecer como desconectada» desde el primer día se confirman tal como los propone esta especificación (y la propia rebanada en Notion), o Jesús quiere otro valor antes de la demostración?
