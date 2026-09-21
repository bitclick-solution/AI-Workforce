REGISTRO HISTÓRICO

Copia cosechada del prototipo `bitclick-solution/iagent-platform` (commit `fbb3f37`, archivo `adr/ADR-017.md`) el 2026-09-20 por la rebanada «Cosecha del prototipo IAGENT-COMPANY». Solo se normaliza el formato con Prettier; el contenido no se edita. El diseño vigente para AI Workforce está en `docs/adr/` y en `docs/investigacion/cosecha-prototipo.md`.

---

# ADR-017 — La cascada de identidad se centraliza: brand/ en la raíz

Fecha: 2026-09-19 · Estado: aceptada · Rodaja: 12

## Contexto

ADR-014 §5 y ADR-009 fijaron que los packs de contexto vivían "en el
blueprint". Con tres workers code-first, eso produjo TRES copias de
`org-voice.md` que ya habían derivado en dos voces distintas — hasta el
punto de que la copia del gabinete violaba una eval de privacidad viva de
la recepcionista. La deriva que §16 prohíbe no era un riesgo: era un hecho
medible en diff.

## Decisión

1. **El árbol canónico vive en `brand/` en la raíz del repo**: `org/`
   (voice.md + visual.yaml con la allowlist `overridable` por nivel),
   `departments/<key>/`, `channels/<key>`. Los `worker-rules.md` SIGUEN en
   cada blueprint: son del puesto, no de la marca.
2. **Un solo compilador**: `libs/iagent_packs` resuelve
   org→department→worker (→channel), concatena la voz, mergea los tokens
   por clave y calcula la huella sha256 del resultado. Los blueprints lo
   consumen como librería (instalada por ruta en la imagen).
3. **La regla de sutileza (§16) es un ERROR de compilación**: un nivel solo
   escribe claves que la allowlist del padre le permite — repetir el mismo
   valor o inventar claves nuevas también revienta. Sin allowlist, nada es
   sobreescribible (fail-closed). `overridable` entra en la huella: cambiar
   quién puede tocar qué es auditable.
4. **Los build contexts de los workers code-first pasan a la raíz** para
   COPY de `brand/` y `libs/`; la paridad se prueba comparando la huella
   dentro de la imagen con la del repo (verificado en la rodaja 12:
   idénticas para los tres).

## Consecuencias negativas asumidas

- Cambiar la voz de la organización reconstruye TRES imágenes (paths del
  workflow incluyen `brand/**`): es el precio de que la voz sea una.
- El nivel `channel` existe en el compilador pero NO en el enum
  `mc_context_scope` del contrato: el documento C8 se niega a publicarlo
  hasta que un ADR decida (canal como scope propio o plegado en worker) —
  bloquea al primer worker de canal (B43), a propósito.
- La firma D11 sobre `brand/org/**` es hoy prosa ("cambiar esto es un PR"):
  el flujo real empuja a main directo. El candado de verdad llega con B4
  (edición en panel → propuesta → PR).

## Sustituye parcialmente a

ADR-009 y ADR-014 §5 en lo relativo a DÓNDE viven los packs de marca. Todo
lo demás de ambos sigue vigente.
