REGISTRO HISTÓRICO

Copia cosechada del prototipo `bitclick-solution/iagent-platform` (commit `fbb3f37`, archivo `contracts/EVENTS.md`) el 2026-09-20 por la rebanada «Cosecha del prototipo IAGENT-COMPANY». Solo se normaliza el formato con Prettier; el contenido no se edita. El diseño vigente para AI Workforce está en `docs/adr/` y en `docs/investigacion/cosecha-prototipo.md`.

---

# Bus de eventos — contrato v1

El bus (Redis Streams) es el sistema nervioso del OS: los workers dejan de
hablarse a través del humano-cartero y publican hechos que cualquiera puede
consumir. El contrato ejecutable es
[`events.schema.json`](./events.schema.json); esta página lo explica.

## Convención de nombres

`dominio.acción_en_pasado`, todo en minúsculas con `_` dentro de cada
segmento: `lead.qualified`, `post.published`, `worker.status_changed`.

- **Pasado, siempre.** Un evento narra algo que ya ocurrió y es inmutable. Si
  el nombre está en imperativo o en futuro, no es un evento: es una orden, y
  las órdenes van por el prefijo `request.`.
- **El dominio es el sustantivo del negocio**, no el worker ni el sistema que
  lo emitió: `lead.qualified`, no `rouben.lead_ok`. Quién lo publicó ya viaja
  en la envolvente (`worker`, `department`).
- **Un tipo por hecho.** Nada de `lead.updated` con un campo `action` dentro.

## Envolvente común

| Campo             | Obligatorio         | Qué es                                                                                                                             |
| ----------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `event_id`        | sí                  | UUID. Clave de idempotencia.                                                                                                       |
| `worker`          | sí                  | Key del worker emisor en `mc_worker`.                                                                                              |
| `tenant`          | sí                  | Cliente al que pertenece el hecho. Todo consumo filtra por aquí.                                                                   |
| `department`      | sí                  | Departamento del emisor.                                                                                                           |
| `kind`            | sí                  | Tipo del evento (tabla de abajo).                                                                                                  |
| `ts`              | sí                  | Instante del hecho, RFC3339 con zona horaria.                                                                                      |
| `severity`        | sí                  | `info` \| `warn` \| `error`.                                                                                                       |
| `summary`         | sí                  | Frase legible para el feed de Mission Control, en idioma de negocio ("Roubén ha cualificado un lead HOT"), no `ejecución 4812 OK`. |
| `payload`         | sí                  | Cuerpo tipado según `kind`.                                                                                                        |
| `ttl_seconds`     | solo en `request.*` | Cuánto tiempo tiene sentido la petición.                                                                                           |
| `fallback_policy` | solo en `request.*` | `continue_without` \| `park` \| `escalate_human`.                                                                                  |

`ttl_seconds` y `fallback_policy` son **obligatorios en las peticiones
agente→agente y deben estar ausentes en los eventos de dominio**: un hecho
consumado no caduca ni tiene plan B. El schema lo fuerza en ambas
direcciones.

## Tipos v1

| `kind`                   | Publica                                                                                                                                | Consume                                                                                                                    | Payload                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `worker.status_changed`  | Control API (toggle de pausa, supervisor, kill switch)                                                                                 | Mission Control (feed y presencia), supervisor del departamento, workers que esperan a ese compañero                       | `worker_ref`, `status`, `previous`, `by`, `reason?`                               |
| `lead.qualified`         | Worker de cualificación (Roubén)                                                                                                       | Worker de seguimiento (Vector), Mission Control, deriva de KPI                                                             | `lead_id`, `score` (0-100), `band` (`HOT`\|`COLD`), `source`                      |
| `post.published`         | Workers de contenido: Biónica (`channel: instagram`) y Romón (`channel: linkedin`) — es el kind que emiten sus gates desde la rodaja 6 | Mission Control, QA muestral, deriva de KPI                                                                                | `channel`, `post_ref`, `permalink?`                                               |
| `task.completed`         | Ailicia (back office)                                                                                                                  | Nadie hoy: no hay suscripción en `mc_subscription`. El feed de Mission Control y el digest del gabinete lo leen del stream | `task_kind`, `outcome` (`done`\|`skipped`\|`needs_human`), `ref?`                 |
| `meeting.booked`         | Worker que agenda (Vector)                                                                                                             | Mission Control, deriva de KPI, panel del cliente                                                                          | `lead_id`, `when`                                                                 |
| `worker.error`           | Cualquier worker; handler de errores de n8n                                                                                            | Vigilante de latido, supervisor del departamento, Mission Control                                                          | `execution_ref`, `message`                                                        |
| `worker.stalled`         | El motor de latido del plano de control (§5 nivel Latido, §12), como `mission_control`                                                 | Nadie hoy: no hay suscripción en `mc_subscription`. El feed de Mission Control y el digest del gabinete lo leen del stream | `worker_ref`, `expected_max_silence_minutes`, `overdue_minutes`, `last_event_ts?` |
| `tool.broken`            | Supervisor del departamento (al detectar fallo repetido de una herramienta)                                                            | La Forja (abre ticket), Mission Control                                                                                    | `tool`, `api`, `error`                                                            |
| `tool.missing`           | Supervisor o worker bloqueado por capacidad ausente                                                                                    | La Forja (abre ticket), Mission Control                                                                                    | `capability`, `requested_by`                                                      |
| `gdpr.erasure_requested` | Control API (solicitud del interesado)                                                                                                 | **Todos los departamentos, sin excepción**, más el índice de KB                                                            | `subject_ref`, `scope` (`tenant`\|`department`\|`worker`)                         |
| `report.published`       | El jefe de gabinete (§12) al componer su informe diario                                                                                | Mission Control (feed), panel del cliente, histórico de informes                                                           | `report` (`daily_digest`), `period_start`, `period_end`, `channel`, `delivered`   |

### Cambios del contrato

**`worker.status_changed` gana `worker_ref` (obligatorio) — Rodaja 4.** El
evento lo emite `mission_control`, un actor de plataforma que rellena la
envolvente con SU propia identidad (`worker: mission_control`). Sin este campo
no había forma de saber de qué worker habla el evento: el feed y los vigilantes
recibían «alguien cambió de estado». `worker_ref` es la referencia cualificada
del worker AFECTADO (`bitclick/bionica`), porque las claves de worker solo son
únicas por tenant (regla 6 de abajo, y `mc_worker`).

Por la regla 7, añadir un campo **obligatorio** a un payload existente es un
cambio que rompe y exigiría versión nueva del tipo. Se hace igualmente y sin
versión nueva por una razón concreta y comprobable: el único publicador de este
kind hoy es el Control API, y no hay consumidores en producción esperando el
payload anterior. Esta nota queda como el rastro de esa excepción — si mañana
hubiera un segundo publicador, la respuesta correcta sería `worker.status_changed`
v2, no otra excepción.

**Entra `task.completed` — Rodaja 6.** Ailicia no tenía con qué aparecer en el
feed: sin `kind` propio, sus hechos no pasaban la puerta del gateway. Es un
`kind` nuevo, no un cambio de los existentes, así que por la regla 7 el añadido
es menor y ningún consumidor se entera.

`task.completed` narra una tarea de back office cerrada. `outcome` separa los
tres finales que un gerente distingue: se hizo (`done`), se decidió no hacerla
(`skipped`) o está parada esperando a una persona (`needs_human`).
`needs_human` es un hecho consumado, no una petición: quien quiera pedir algo a
alguien usa `request.*` con su TTL.

**Biónica y Romón no estrenan kind: publican `post.published`**, que ya existía
y cuyos publicadores declarados eran exactamente ellos. Biónica emite con
`channel: instagram` y Romón con `channel: linkedin`. En v1 `channel` es
**string libre**, no un enum: endurecerlo sería estrechar el tipo, y estrechar
exige versión nueva y ADR (regla 7). Se decidirá si aparece un tercer canal
—TikTok, blog— y no antes.

**Por qué el payload de `task.completed` no lleva datos de persona.** El bus es
replicable y observable: lo que entra se propaga a todos los consumidores, al
feed, al digest y a cualquier réplica. Por eso `ref` es una referencia
**interna** —el id de la fila, del documento o de la ejecución en nuestro
sistema— y nunca el cuerpo del mensaje, el nombre del cliente ni el contacto.
`task_kind` es una clave estable (`^[a-z0-9_.]{2,64}$`), no prosa: un campo de
texto libre en un evento de back office es exactamente por donde se cuela un
dato personal, y la casilla GDPR del contrato del blueprint lo prohíbe (B19). El
único texto libre sigue siendo el `summary` de la envolvente, que se escribe
para el feed y está sujeto a la regla 4 como todo lo demás.

**Entra `worker.stalled` — Rodaja 9.** El nivel Latido de §5 era lo único de los
tres vigilantes que no tenía con qué hablar: el bus sabía decir "algo falló"
(`worker.error`) pero no "nadie ha dicho nada". Un worker que ha dejado de
ejecutar **no puede avisar de su propio silencio**, así que el emisor es el motor
de latido del plano de control (`worker: mission_control`), con el mismo camino
que `worker.status_changed`. Es un `kind` nuevo, no un cambio de los existentes:
por la regla 7 el añadido es menor y ningún consumidor se entera.

- **Publica** el motor; **consume nadie hoy**: no hay fila en `mc_subscription`
  para este kind. El feed de Mission Control y el digest del gabinete lo leen
  del stream, como ya hacen con `task.completed`. El supervisor de departamento
  es su consumidor natural cuando exista, y entrará sin tocar el tipo.
- **`worker_ref` es obligatorio**, y por la misma razón que en
  `worker.status_changed`: el emisor es un actor de plataforma que rellena la
  envolvente con su propia identidad. Aquí no hay excepción que justificar —
  el tipo nace con el campo, que es lo que la nota de la Rodaja 4 pedía para
  cualquier kind nuevo emitido por `mission_control`.
- **`severity: warn` fijo.** Un latido perdido es una anomalía, no un fallo
  observado: nadie ha visto romperse nada. Lo que se rompe, cuando se rompe,
  viaja en `worker.error` con su `error`.
- **El payload no lleva datos personales por construcción**: tres números y una
  referencia de worker. No hay ni un campo de texto libre donde pudiera colarse
  un dato del interesado (regla 4, B19); el único texto sigue siendo el
  `summary` de la envolvente, escrito para el feed.
- **La política es local, el motor global** (§12): el umbral es
  `mc_worker.heartbeat_minutes`, declarado por worker en el registro, y viaja en
  el evento (`expected_max_silence_minutes`) para que quien lo lea no tenga que
  consultar `mc_worker`. `heartbeat_minutes` nulo = sin vigilancia de latido, que
  es lo correcto para un worker reactivo: su silencio no es una anomalía.
- **`overdue_minutes` es una cota inferior.** El motor mira una ventana acotada
  del stream; si no encuentra nada suyo dentro, cuenta el silencio desde donde
  llegó a mirar en vez de inventar un instante. Por eso `last_event_ts` es
  opcional: no haber visto un evento no es haber probado que no existe.

`request.*` queda reservado para peticiones agente→agente. En v1 no hay
ninguna tipada: la envolvente ya impone TTL y política de respaldo, y el
primer caso real definirá su payload.

## Reglas

1. **Idempotencia por `event_id`.** El bus garantiza entrega _al menos una
   vez_; un mismo evento puede llegar dos veces. Todo consumidor guarda los
   `event_id` procesados y descarta repetidos. Sin esto, un reinicio duplica
   follow-ups a leads reales.
2. **El bus nunca borra por pausa.** Pausar un worker es dejar de consumir,
   jamás vaciar su cola. Los mensajes dirigidos a un worker `paused` se
   quedan en su consumer group con su offset y se procesan en orden al
   reanudar. Quien no quiera esperar declara `ttl_seconds` y
   `fallback_policy` en su petición — nadie se bloquea esperando a un
   compañero pausado.
3. **Un evento = un hecho de negocio, no telemetría.** Al bus va lo que un
   gerente entendería leído en voz alta. Latencias, tokens, costes y trazas
   de LLM van a Langfuse; logs a stdout. Si el hecho no le importa a nadie
   más que al propio worker, no es un evento.
4. **Nada personal en claro.** `subject_ref`, `lead_id` y demás son
   referencias opacas; los mensajes de error viajan sin secretos ni datos
   personales. El bus es replicable y observable: lo que entra, se propaga.
5. **El `summary` es contrato de producto.** Se escribe para el feed del
   cliente, no para el desarrollador. Es lo que el panel muestra sin
   traducción.
6. **Actores de plataforma y `department`.** Un emisor sin departamento de
   negocio (`mission_control`, la Forja) rellena `department` con el del
   worker AFECTADO por el evento; si tampoco existe, con la clave literal
   `plataforma`. El campo sigue siendo obligatorio: el feed y los vigilantes
   agrupan por él.
7. **Compatibilidad hacia adelante.** Añadir un `kind` o un campo opcional al
   payload es cambio menor; quitar un campo, renombrar un `kind` o estrechar
   un enum exige versión nueva del tipo y ADR. Los consumidores ignoran los
   `kind` que no conocen; no fallan.
