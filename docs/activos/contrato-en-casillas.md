REGISTRO HISTÓRICO

Copia cosechada del prototipo `bitclick-solution/iagent-platform` (commit `fbb3f37`, archivo `conformance/README.md`) el 2026-09-20 por la rebanada «Cosecha del prototipo IAGENT-COMPANY». Solo se normaliza el formato con Prettier; el contenido no se edita. El diseño vigente para AI Workforce está en `docs/adr/` y en `docs/investigacion/cosecha-prototipo.md`.

---

# Suite de conformance

Responde a una sola pregunta sobre un worker: **¿cumple el contrato de worker
v1?** Las ocho casillas del contrato (`docs/plataforma.md` §11, §14, §15.2,
§16) tienen aquí un fichero de tests cada una:

| Fichero                      | Casilla | Qué exige                                            |
| ---------------------------- | ------- | ---------------------------------------------------- |
| `test_c1_registry.py`        | 1       | Fila en `mc_worker` con identidad y estado           |
| `test_c2_config_keys.py`     | 2       | Claves canónicas `enabled` y `autonomy_level`        |
| `test_c3_event_view.py`      | 3       | Vista SQL de proyección a `mc_event`                 |
| `test_c4_bus_events.py`      | 4       | Eventos de dominio válidos en el bus, y publicables  |
| `test_c5_langfuse_traces.py` | 5       | Actividad LLM atribuible en Langfuse, con coste      |
| `test_c6_draining.py`        | 6       | Ciclo de pausa `active → draining → paused → active` |
| `test_c7_gdpr_erasure.py`    | 7       | Consume y confirma `gdpr.erasure_requested`          |
| `test_c8_context_pack.py`    | 8       | Ruta de cascada y huella del context pack compilado  |

Esta suite **es la especificación**; los documentos solo la explican. Un worker
que la pasa entera es un worker que el plano de control puede gobernar, sin
importar en qué esté hecho.

## El principio que decide qué entra aquí

> **La suite audita la MECÁNICA COMÚN; la conducta de negocio la auditan las
> evals del blueprint.**

Mecánica común es lo que el plano de control garantiza para todos por igual: que
la envolvente del bus valide, que `pause` responda 200 y el reconciliador llegue
a `paused`, que la acción quede en `mc_audit`, que exista huella del context
pack. Se puede comprobar sin saber nada de la familia.

Conducta de negocio es lo que hace ESTE worker: que Roubén aparque el lead en
`rouben_parked` en vez de perderlo cuando está pausado (ADR-013 §8), que el
digest de gabinete no se envíe en `shadow`, que el score de un lead HOT sea el
que debe ser. Depende de tablas, disparadores y golden sets propios: vive en
`blueprints/<familia>/evals/`, donde sí se puede inyectar un disparador de
prueba.

La frontera es el §11 ("por los bordes, no por las entrañas"). Si un test
necesita conocer el nombre de una tabla de la familia para funcionar, está en el
sitio equivocado. El caso de libro es la casilla 6: aquí se comprueba que la
pausa **se ejecuta y se propaga**; que el worker **no tome trabajo nuevo** lo
comprueban sus evals.

## Requisitos

Python 3.11 y las dependencias de `requirements.txt`:

```bash
python -m venv .venv
. .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r conformance/requirements.txt
```

## Ejecutar la suite — la vía dockerizada (B32)

En el servidor, la vía normal es la imagen `iagent-conformance`: un contenedor
desechable enchufado a `bitclick-network`, donde `mc-db`, `mc-bus`,
`iagent-control-api`, `bus-gateway`, `langfuse-web` y el propio worker resuelven
por nombre de servicio. Ni túneles, ni clonar el repo, ni un puerto publicado de
más (§15.1).

La imagen y los dos env-file los deja listos **cada despliegue**
(`deploy/deploy.sh` → `pull_conformance_image` + `render-conformance-env.sh`).
No se editan a mano: el siguiente despliegue los pisa.

```bash
# Pasada 1 — REGISTRO (mc-db): casillas 1, 4, 5, 6, 7, 8
docker run --rm --network bitclick-network \
  --env-file /opt/bitclick/iagent/conformance.registro.env iagent-conformance \
  --deselect conformance/test_c2_config_keys.py::test_la_tabla_de_config_existe \
  --deselect conformance/test_c3_event_view.py::test_la_vista_del_worker_existe

# Pasada 2 — FAMILIA: casillas 2 y 3
docker run --rm --network bitclick-network \
  --env-file /opt/bitclick/iagent/conformance.familia.env iagent-conformance \
  --deselect conformance/test_c1_registry.py \
  --deselect conformance/test_c4_bus_events.py \
  --deselect conformance/test_c5_langfuse_traces.py \
  --deselect conformance/test_c6_draining.py \
  --deselect conformance/test_c7_gdpr_erasure.py \
  --deselect conformance/test_c8_context_pack.py
```

### Por qué DOS pasadas, y por qué se deselecciona

`CONFORMANCE_PG_DSN` es uno solo, y las ocho casillas miran a dos bases
distintas: el registro (`mc_worker`, `mc_audit`) vive en **mc-db** y la config y
la vista de proyección viven en la base de la **familia**. Ninguna pasada puede
ver las dos.

En la pasada de registro, las **únicas** dos comprobaciones que resuelven un
nombre de tabla y no lo encuentran son `test_la_tabla_de_config_existe` (C2) y
`test_la_vista_del_worker_existe` (C3); el resto de C2/C3 salta solo. Ese fallo
es un artefacto del patrón, no un incumplimiento — y por eso se **deselecciona
por nombre**, no se tolera. Un `|| true` o un «fallos conocidos» se tragaría
también el día que C6 se rompa de verdad. Deseleccionar declara; tolerar tapa.

Construir la imagen en local (el contexto es **la raíz del repo**: la suite cita
`contracts/` por ruta y resuelve los `content_ref` de la casilla 8 contra
`blueprints/`):

```bash
docker build -f conformance/Dockerfile -t iagent-conformance .
```

Sin env-file, la imagen colecciona y lo salta todo: es la comprobación de que la
suite importa, la misma que hace la CI.

### Autoauditoría semanal

`.github/workflows/conformance-weekly.yml` ejecuta esas dos pasadas cada lunes a
las 06:00 UTC (y a demanda con `workflow_dispatch`), entrando por SSH con los
mismos secrets que el despliegue. Guarda la salida completa de ambas como
artifact y **falla si cualquiera de las dos devuelve algo distinto de 0**. La
salida es el certificado; la lista de skips de `-ra`, el mapa de lo que quedó
sin auditar.

## Ejecutar la suite a mano (alternativa)

La suite no levanta nada: audita un worker **ya desplegado**. Todo lo que
necesita saber llega por variables de entorno `CONFORMANCE_*`.

```bash
export CONFORMANCE_WORKER_KEY=gabinete
export CONFORMANCE_PG_DSN="postgresql://lector:***@localhost:5432/iagent"

pytest conformance/ -ra -v
```

Sin esas dos variables, **todos los tests se marcan `skip`** con el mensaje
`sin entorno de conformance: exporta CONFORMANCE_*`. Es el modo en que corre
en CI: comprueba que la suite importa y colecciona, no que haya un worker vivo.

Ejecutar una sola casilla:

```bash
pytest conformance/test_c6_draining.py -ra -v
```

La cabecera de `pytest` dice contra qué se está corriendo y con qué permisos
(`worker=… pg=sí bus=sí gateway=no … writes=no`): si una casilla salta, ahí está
media respuesta.

## Matriz: casilla × entorno × qué verifica

Columna «Escribe»: ✅ = necesita `CONFORMANCE_ALLOW_WRITES=1`; sin él ese test
salta y el resto de la casilla sigue auditándose en solo lectura.

| Casilla                | Necesita                                             | Escribe | Qué verifica exactamente                                                                                                                                                                                                                                                                                         |
| ---------------------- | ---------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** Registro         | `PG_DSN`                                             | —       | Fila en `mc_worker`, identidad, estado y departamento coherentes                                                                                                                                                                                                                                                 |
| **2** Config           | `PG_DSN` (+ `CONFIG_TABLE`)                          | —       | La tabla de familia expone `enabled` y `autonomy_level` con el vocabulario canónico                                                                                                                                                                                                                              |
| **3** Vista de eventos | `PG_DSN` (+ `EVENT_VIEW`)                            | —       | La vista existe, es consultable y proyecta los campos de la envolvente                                                                                                                                                                                                                                           |
| **4** Bus (lectura)    | `BUS_URL`                                            | —       | El stream existe; los eventos del worker validan contra `contracts/events.schema.json`; atribución completa (`worker`/`tenant`/`department`); regla TTL (`request.*` con TTL y `fallback_policy`, eventos de dominio sin ellos); AOF activo en el bus                                                            |
| **4** Bus (escritura)  | `BUS_URL` + `BUS_GATEWAY_URL` + `BUS_GATEWAY_TOKEN`  | ✅      | Publica un `request.conformance_probe` por `POST /v1/publish`, lo encuentra en `mc.events` con su envolvente intacta, y comprueba que la puerta devuelve **422** a un `request.*` sin TTL                                                                                                                        |
| **4** Persistencia     | lo anterior + `BUS_RESTART_OK=1` + `BUS_RESTART_CMD` | ✅✅    | **Reinicia el bus** y comprueba que el evento sigue ahí (B1). Ver el aviso de abajo                                                                                                                                                                                                                              |
| **5** Langfuse         | `LANGFUSE_URL` + `_PUBLIC_KEY` + `_SECRET_KEY`       | —       | Health; al menos una traza o generación atribuible al worker en 48 h; que traiga coste; que declare `sessionId`/tenant                                                                                                                                                                                           |
| **6** Pausa (lectura)  | `PG_DSN`, `BUS_URL`                                  | —       | El registro admite los tres estados; el worker no está atascado en `draining`; existe su consumer group                                                                                                                                                                                                          |
| **6** Pausa (ciclo)    | `CONTROL_API_URL` + `CONTROL_API_TOKEN`              | ✅      | `pause` → 200 con `WorkerStatusChange`; `status_changed_at` avanza; el reconciliador llega a `paused` dentro de `drain_timeout_seconds` + 30 s; el offset del consumer group no avanza durante la pausa; `resume` → `active`; apunte en `mc_audit` con el `audit_id` devuelto; `worker.status_changed` en el bus |
| **7** GDPR             | `ERASURE_WEBHOOK` (+ `ERASURE_SECRET`)               | ✅      | El contrato declara el evento; el worker declara la suscripción; tiene consumer group; y el webhook responde **2xx con confirmación** a un `gdpr.erasure_requested` con sujeto sintético                                                                                                                         |
| **8** Context pack     | `CONTEXT_PACK_URL` **o** `CONTEXT_PACK_TABLE`        | —       | Ruta de cascada en `mc_worker`; huella con `fingerprint` y `levels`; los packs citados existen; orden general → específico; la huella es determinista                                                                                                                                                            |

## Variables de entorno

| Variable                              | Casillas         | Para qué                                                                                                                                 |
| ------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `CONFORMANCE_WORKER_KEY`              | todas            | `mc_worker.key` del worker auditado                                                                                                      |
| `CONFORMANCE_PG_DSN`                  | 1, 2, 3, 6, 7, 8 | Postgres con el registro y las vistas                                                                                                    |
| `CONFORMANCE_WORKER_DEPARTMENT`       | 1, 4, 7          | Departamento esperado (opcional)                                                                                                         |
| `CONFORMANCE_TENANT`                  | 4, 5, 7, 8       | Tenant del worker; se comprueba en eventos, trazas y packs                                                                               |
| `CONFORMANCE_CONFIG_TABLE`            | 2                | Tabla de config; si falta, se lee de `mc_worker`                                                                                         |
| `CONFORMANCE_EVENT_VIEW`              | 3                | Vista de proyección; si falta, se lee de `mc_worker`                                                                                     |
| `CONFORMANCE_BUS_URL`                 | 4, 6, 7          | URL de Redis (bus de eventos)                                                                                                            |
| `CONFORMANCE_BUS_PASSWORD`            | 4, 6, 7          | Contraseña del bus, si no va dentro de la URL                                                                                            |
| `CONFORMANCE_BUS_STREAM`              | 4, 6, 7          | Stream a mirar. Por defecto `mc.events` (ADR-012 §2)                                                                                     |
| `CONFORMANCE_BUS_CONSUMER_GROUP`      | 6, 7             | Consumer group del worker. Por defecto `cg.<key>`                                                                                        |
| `CONFORMANCE_BUS_GATEWAY_URL`         | 4                | Base URL del `bus-gateway` (con o sin `/v1`)                                                                                             |
| `CONFORMANCE_BUS_GATEWAY_TOKEN`       | 4                | Bearer del publicador **de este worker**                                                                                                 |
| `CONFORMANCE_BUS_RESTART_OK`          | 4                | `1` autoriza a REINICIAR el bus (ver aviso)                                                                                              |
| `CONFORMANCE_BUS_RESTART_CMD`         | 4                | Orden exacta de reinicio, declarada por quien opera                                                                                      |
| `CONFORMANCE_CONTROL_API_URL`         | 6, 8             | Base URL del Control API (con o sin `/v1`)                                                                                               |
| `CONFORMANCE_CONTROL_API_TOKEN`       | 6, 8             | Bearer para el Control API                                                                                                               |
| `CONFORMANCE_DRAIN_MAX_WAIT_SECONDS`  | 6                | Tope de espera del drenaje. Por defecto 120                                                                                              |
| `CONFORMANCE_LANGFUSE_URL`            | 5                | Instancia de Langfuse                                                                                                                    |
| `CONFORMANCE_LANGFUSE_PUBLIC_KEY`     | 5                | Clave pública de Langfuse                                                                                                                |
| `CONFORMANCE_LANGFUSE_SECRET_KEY`     | 5                | Clave secreta de Langfuse                                                                                                                |
| `CONFORMANCE_LANGFUSE_LOOKBACK_HOURS` | 5                | Ventana de búsqueda. Por defecto 48                                                                                                      |
| `CONFORMANCE_ERASURE_WEBHOOK`         | 7                | Endpoint de borrado que declara el worker                                                                                                |
| `CONFORMANCE_ERASURE_SECRET`          | 7                | Secreto compartido de ese webhook                                                                                                        |
| `CONFORMANCE_OB_SUPPRESSION`          | 7                | `1` activa los tests de la lista de supresión GDPR (ADR-016): solo lectura sobre ob_suppression/ob_prospect/consent_ledger de la familia |
| `CONFORMANCE_ERASURE_SECRET_HEADER`   | 7                | Cabecera del secreto. Por defecto `X-Iagent-Secret`                                                                                      |
| `CONFORMANCE_CASCADE_LEVEL`           | 8                | Ruta de cascada esperada (opcional)                                                                                                      |
| `CONFORMANCE_CONTEXT_PACK_URL`        | 8                | Endpoint de la huella del pack (`/context`)                                                                                              |
| `CONFORMANCE_CONTEXT_PACK_TABLE`      | 8                | Alternativa SQL a lo anterior                                                                                                            |
| `CONFORMANCE_ALLOW_WRITES`            | 4, 6, 7          | `1` para autorizar publicar, pausar y llamar al webhook                                                                                  |

`deploy/render-conformance-env.sh` genera esta tabla **entera** salvo
`CONFORMANCE_CONTEXT_PACK_TABLE`, que es la alternativa SQL a
`CONFORMANCE_CONTEXT_PACK_URL` y sobra cuando el worker publica el endpoint
`/context`. Los valores salen del `.env` del despliegue y de los hosts internos
de `bitclick-network`; un renglón que quedaría vacío se avisa por stderr, porque
una variable vacía hace **saltar** su casilla y un skip se parece demasiado a un
verde.

### Aviso: `CONFORMANCE_BUS_RESTART_OK`

Esa variable autoriza a la suite a **reiniciar el contenedor del bus** con la
orden que tú declares en `CONFORMANCE_BUS_RESTART_CMD`, para comprobar que lo
publicado sobrevive (B1, ADR-012 §1). Durante el reinicio **nadie puede
publicar**: cualquier worker que lo intente recibirá un error.

- Jamás está activa por defecto, y exige además `CONFORMANCE_ALLOW_WRITES=1`.
- La orden la escribes tú: la suite no adivina qué contenedor reiniciar, porque
  adivinarlo es exactamente cómo se reinicia el Redis equivocado.
- Cuando está activa, la cabecera de `pytest` lo grita en la primera línea.
- En producción y en horario de trabajo, no. La comprobación no destructiva
  (AOF activo en `INFO persistence`) corre siempre y cubre el 90 % del riesgo.

## Casilla 8 — convención de la huella de context pack

Un pack compilado es un dato en memoria: no se puede auditar mirando el prompt.
Para que la casilla sea verificable desde fuera, **el worker publica la huella
de su última compilación**. Es la convención que estrena `gabinete` (ADR-014 §5)
y que los demás blueprints copian.

Dos formas equivalentes, a elección del blueprint:

- **Endpoint**: `GET <CONFORMANCE_CONTEXT_PACK_URL>`; por convención, `/context`
  del propio worker.
- **Tabla de la familia**: la que declare `CONFORMANCE_CONTEXT_PACK_TABLE`, con
  una fila por compilación y al menos `fingerprint` (text), `levels` (jsonb) y
  `compiled_at` (timestamptz). La suite lee la más reciente.

El documento es el mismo en los dos casos:

```json
{
  "worker": "gabinete",
  "tenant": "bitclick",
  "compiled_at": "2026-09-17T06:00:03Z",
  "fingerprint": "sha256:9f2c…",
  "levels": [
    {
      "scope": "org",
      "scope_ref": "bitclick",
      "kind": "voice",
      "content_ref": "blueprints/gabinete/brand/voice.md",
      "version": "v1"
    },
    {
      "scope": "worker",
      "scope_ref": "bitclick/gabinete",
      "kind": "visual",
      "content_ref": "blueprints/gabinete/brand/visual.yaml",
      "version": "v1"
    }
  ],
  "pack": { "…": "opcional: el pack resuelto, si el worker quiere exponerlo" }
}
```

Reglas, y el porqué de cada una:

1. **`fingerprint`** es el hash del pack compilado (`sha256:<hex>`, o el hex a
   secas). Es lo que permite decir "este worker cambió de identidad hoy" sin
   diffear prompts, y contra qué versión puntuó el QA muestral.
2. **`levels` va de lo general a lo específico**, un elemento por pack que entró
   en la resolución. Si un `kind` aparece dos veces, gana el último: la regla del
   CSS del §16, escrita.
3. **`scope`** usa el vocabulario de `contracts/registry.sql`
   (`org|department|worker|account`) y **`scope_ref` va cualificado con el
   tenant**, igual que `mc_context_pack.scope_ref` (`bitclick`,
   `bitclick/gabinete`). Sin cualificar, dos clientes con un departamento
   `marketing` compartirían identidad.
4. **`content_ref` es una ruta del repo o una URI, nunca el contenido**: el pack
   vive versionado en git; `mc_context_pack` es solo el índice.
5. **La huella es determinista**: dos lecturas seguidas sin despliegue por medio
   dan el mismo `fingerprint`. Si cambia sola, el pack se compila con entradas no
   fijadas (la hora, un dict recorrido al azar, una consulta sin `ORDER BY`) y la
   reproducibilidad del §16 es falsa.

La suite comprueba además que **lo citado existe**: cada `content_ref` tiene que
resolver a un fichero del repo o a una fila de `mc_context_pack`. Una huella que
apunta al vacío es peor que no publicarla, porque aparenta cumplimiento.

## Reglas de la suite

- **Solo lectura por defecto.** La conexión a Postgres se abre en `read_only` y
  nada se publica, se pausa ni se llama salvo que exportes
  `CONFORMANCE_ALLOW_WRITES=1`. Se puede correr contra producción sin miedo.
- **Lo que escribe, lo restaura.** El ciclo de pausa reanuda en un `finally`,
  pase lo que pase. El evento de prueba es un `request.conformance_probe` que
  nadie consume, caduca en 60 s y declara `continue_without`: auditar no puede
  costar un incidente. La suite **nunca** publica un `gdpr.erasure_requested` en
  el bus real — obligaría a todos los departamentos a barrer de verdad —; llama
  al webhook del worker auditado y a nadie más.
- **Skip con motivo, nunca fallo silencioso.** Si falta una pieza del entorno
  o una casilla depende de una rodaja futura, el test salta con un mensaje que
  dice qué falta. `pytest -ra` lista todos los skips: esa lista es el mapa de
  lo que aún no está cubierto.
- **Los TODO son deuda declarada.** Los `pytest.skip("TODO (rodaja N): ...")`
  marcan tests ya diseñados que esperan a una pieza futura. No se borran: se
  convierten en test real cuando la pieza existe.
- **La suite no asume el DDL.** Las columnas se comprueban contra
  `information_schema` antes de usarlas. Cuando el DDL esté cerrado, esos `skip`
  defensivos se convierten en asserts duros.

## Correr la suite contra un worker nuevo

1. Da de alta el worker en `mc_worker` (casilla 1).
2. Exporta como mínimo `CONFORMANCE_WORKER_KEY` y `CONFORMANCE_PG_DSN`.
3. `pytest conformance/ -ra` y lee los skips: son las casillas pendientes.
4. Añade entorno (bus, gateway, Langfuse, Control API, pack) casilla a casilla
   hasta que no queden skips que dependan del entorno.
5. Para el paso final, exporta `CONFORMANCE_ALLOW_WRITES=1` en un entorno donde
   pausar y publicar no moleste a nadie.

Cuando la suite pasa entera contra un worker que no existía hace un mes, el OS
queda demostrado (criterio de la rodaja 4 del roadmap).
