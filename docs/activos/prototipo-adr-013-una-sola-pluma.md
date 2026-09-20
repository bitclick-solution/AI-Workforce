REGISTRO HISTÓRICO

Copia cosechada del prototipo `bitclick-solution/iagent-platform` (commit `fbb3f37`, archivo `adr/ADR-013.md`) el 2026-09-20 por la rebanada «Cosecha del prototipo IAGENT-COMPANY». Solo se normaliza el formato con Prettier; el contenido no se edita. El diseño vigente para AI Workforce está en `docs/adr/` y en `docs/investigacion/cosecha-prototipo.md`.

---

# ADR-013: Control v1 — una sola pluma, pausa por temporizador, decisiones en la BD de la familia

- Fecha: 2026-09-16
- Estado: accepted

## Contexto

La rodaja 3 implementa el ciclo de pausa (ADR-008), el kill switch coherente
(B16) y la bandeja de aprobaciones. Sin decisiones comunes, cuatro entregas
paralelas producirían tres máquinas de estados distintas.

## Decisión

1. **El Control API es la ÚNICA pluma del estado de control.** Nadie más
   escribe `mc_worker.status`, `enabled` ni `autonomy_level` — ni seeds
   (ya respetado), ni workers, ni paneles de familia. Toda mutación deja su
   apunte en `mc_audit` ANTES de aplicarse.
2. **Transiciones válidas** (cualquier otra → 409):
   `active→draining` (pause) · `draining→paused` (solo el reconciliador) ·
   `paused→active` (resume) · `active|draining|paused→disabled` (kill switch) ·
   `disabled→active` (rearme explícito). `mc_worker` gana `status_changed_at`
   (B13) y `drain_timeout_seconds` (default 900).
3. **`draining→paused` lo ejecuta un reconciliador** dentro del control-api
   (loop ligero): en v1 no medimos in-flight de n8n — el paso a `paused` es
   por temporizador (`drain_timeout_seconds`, B2). Un worker webhook de
   ejecuciones de segundos drena de sobra en ese margen. Medir in-flight real
   entra más tarde sin tirar nada.
4. **B16 resuelto — doble escritura ordenada:** `PATCH /config/{worker}` y
   pause/resume escriben (a) `mc_audit`, (b) la tabla de config de la familia
   (`enabled`/`autonomy_level` — lo que el worker sondea en ejecución),
   (c) `mc_worker` (lo que el roster muestra). Si (b) falla, no se toca (c) y
   se responde 502 problem+json con el audit_id del intento. Sin 2PC: el
   orden hace que la divergencia posible sea siempre "la familia manda".
5. **Escritura en la BD de familia con rol propio `mc_writer`** (B21 parcial):
   GRANT UPDATE únicamente sobre las columnas/tablas de control declaradas
   (`rouben_config`, `ig_post.approval_decision`, …). El DSN
   `FAMILY_DB_WRITE_DSN` es distinto del de lectura. El dispatcher del bus, a
   su vez, pasa a un rol de solo lectura de mc-db (`mc_reader_control`, B21).
6. **`worker.status_changed` lo publica el actor de plataforma
   `mission-control`**: fila en `mc_worker` (tenant `bitclick`, sin
   departamento, kind `code`) y token `MC_BUS_TOKEN_MISSION_CONTROL` en el
   gateway. El panel y los vigilantes lo consumen del bus, no por polling.
7. **Aprobaciones v1 = el patrón de las vistas de eventos:** cada familia
   expone una vista `mc_approval_<familia>` en SU base (pendientes, con id,
   tipo, resumen, urls de preview); `GET /approvals` las agrega. La decisión
   se escribe donde la familia ya la sondea (`ig_post.approval_decision`,
   patrón del panel IG) vía `mc_writer` — regla MC de mission-control.md: la
   decisión se escribe en la BD de la familia, nunca en una copia.
8. **Pausa de un worker n8n reactivo (Roubén, casilla 6):** el workflow
   sondea su config al arrancar. Con `enabled=false`: el webhook SIEMPRE
   responde 202 y el lead crudo se aparca en `rouben_parked` (tabla de la
   familia) sin LLM, sin Odoo, sin bus. El reproceso tras resume es manual y
   documentado en v1 (B3 se resuelve entero en su día); el invariante
   irrenunciable es que el lead jamás se pierde.

## Consecuencias

- Positivas: una máquina de estados, un escritor, auditoría completa; la
  divergencia enabled/status muere; las aprobaciones reutilizan el panel IG
  existente sin migrar nada.
- Negativas: el paso a `paused` es optimista (temporizador, no medición);
  la doble escritura puede divergir un instante si (c) falla tras (b) — se
  acepta porque "la familia manda" y el roster se reconcilia; el reproceso
  de aparcados es manual en v1.

## Alternativas descartadas

- Estado solo en la familia o solo en el registro — reabre B16.
- Draining medido contra la API de ejecuciones de n8n — más superficie y
  acoplamiento por un margen que el temporizador ya da; puede entrar luego.
- Tabla central de aprobaciones en mc-db — copia el estado de la familia y
  el workflow que sondea la familia nunca la vería.
