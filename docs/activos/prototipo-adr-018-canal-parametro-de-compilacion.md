REGISTRO HISTÓRICO

Copia cosechada del prototipo `bitclick-solution/iagent-platform` (commit `fbb3f37`, archivo `adr/ADR-018.md`) el 2026-09-20 por la rebanada «Cosecha del prototipo IAGENT-COMPANY». Solo se normaliza el formato con Prettier; el contenido no se edita. El diseño vigente para AI Workforce está en `docs/adr/` y en `docs/investigacion/cosecha-prototipo.md`.

---

# ADR-018 — `channel` es parámetro de compilación, no un scope del registro

Fecha: 2026-09-19 · Estado: aceptada · Rodaja: 13 (B43)

## Contexto

El §16 dibuja el canal como nivel de la cascada y `libs/iagent_packs` lo
implementa (`resolver(..., canal='instagram')` funciona desde la rodaja 12).
Pero `mc_context_scope` tiene cuatro valores, `cascade_level` no admite un
tramo `/channel/` y el documento C8 se negaba a publicar el nivel hasta que
un ADR decidiera. La contradicción bloqueaba B43 a propósito (ADR-017).

## Decisión

1. **El canal NO entra en la ruta del registro.** `mc_context_scope` queda
   con sus cuatro valores y `mc_worker.cascade_level` no cambia. La ruta
   declara QUIÉN es el worker en la organización; el canal declara DÓNDE
   publica. Un worker podría publicar en dos canales sin cambiar de
   identidad: si el canal viviera en la ruta, eso serían dos workers.
2. **El canal se declara en `brand/consumers.yaml`**, manifest versionado
   en el árbol de marca: una entrada por worker consumidor con su
   `cascade_path` (copiada del registro, la conformance las cruza) y su
   `channel` (o ninguno). Cambiar el canal de un worker es un PR con diff,
   como todo lo demás del árbol.
3. **El compilador resuelve con el canal del manifest** y la huella
   resultante INCLUYE el nivel channel cuando se usó. La conformance C8
   compara esa huella —fila materializada contra compilar el repo con el
   mismo canal— y por fin puede auditar a los workers de n8n (B36).
4. **El contrato del Control API no gana `channel` en esta rodaja.** El
   enum `CascadeLevel` y `GET /v1/workers/{key}/context-pack` siguen
   sirviendo la parte de la casa sin canal. El contrato lo ganará cuando el
   API compile por canal (`?channel=`), junto con B44 — no antes de que
   alguien lo necesite mirar.

## Materialización para los n8n (el otro medio ADR)

Los workflows de n8n no pueden importar una librería Python ni llevar el
árbol dentro. El pack les llega **materializado en la familia**: un paso del
deploy compila cada entrada de `consumers.yaml` y UPSERTa
`brand_context_pack` (worker_key, channel, cascade_path, voice_md, visual
jsonb, fingerprint, source_commit, compiled_at) en la base de familia — el
mismo camino por el que ya leen su config canónica (`romon_config`). La
columna se llama `channel`, no `canal`: AGENTS.md §2, campos en inglés.

- **Sin fila, sin contenido**: el workflow trata la identidad como gate,
  igual que la pausa. Fail-closed para generar; un aviso, no un post con la
  voz vieja. La deriva que la rodaja 12 mató en los blueprints no puede
  volver a entrar por n8n.
- La fila es un ARTEFACTO derivado del árbol: nadie la edita a mano, el
  deploy la reescribe. Editar la voz sigue siendo un PR a `brand/`.

## Consecuencias

- Dos declaraciones del mismo worker (registro y manifest) pueden divergir:
  la conformance cruza `consumers.yaml` contra `mc_worker.cascade_level` y
  esa divergencia es un FAILED, no un warning.
- El nivel `cuenta/cliente` del §16 (workers multi-cuenta) queda fuera
  igual que estaba: llegará con la Plantilla IA multi-tenant, y por este
  mismo camino (parámetro, no ruta), salvo ADR que diga otra cosa.
