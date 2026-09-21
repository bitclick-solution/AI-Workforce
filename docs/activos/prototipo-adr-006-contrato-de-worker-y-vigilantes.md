REGISTRO HISTÓRICO

Copia cosechada del prototipo `bitclick-solution/iagent-platform` (commit `fbb3f37`, archivo `adr/ADR-006.md`) el 2026-09-20 por la rebanada «Cosecha del prototipo IAGENT-COMPANY». Solo se normaliza el formato con Prettier; el contenido no se edita. El diseño vigente para AI Workforce está en `docs/adr/` y en `docs/investigacion/cosecha-prototipo.md`.

---

# ADR-006: Estandarizar lo existente por contrato de worker (8 casillas), no por reescritura; y construir los vigilantes como motores globales con política por departamento

- Fecha: 2026-09-15
- Estado: accepted

## Contexto

Cada familia de workers se construyó por su cuenta y con sus convenciones:
Biónica tiene su Crítico, LA-RAG su Evaluator, cada una su tabla de
configuración. Meterlas todas en un patrón maestro exigiría reescribirlas, y
están en producción y funcionan. A la vez, si cada departamento sigue
inventando su propio evaluador y su propia vigilancia, no hay QA transversal
ni producto: hay cinco proyectos con el mismo logotipo.

## Decisión

### Estandarización por los bordes

No se reescribe ninguna familia. Se estandariza el **contrato de worker v1**:
lo que cada worker expone al OS, sin tocar sus entrañas. Ocho casillas:

1. Fila en `mc_worker` (identidad, departamento, workflows, tabla de config).
2. Claves canónicas en su configuración: `enabled`, `autonomy_level`.
3. Vista SQL de proyección a `mc_event`.
4. Publicar sus 2-3 eventos de dominio en el bus.
5. Enviar trazas LLM a Langfuse.
6. Respetar el ciclo `draining` (ver ADR-008).
7. Consumir `gdpr.erasure_requested` y confirmar el borrado (ver ADR-010).
8. Declarar su nivel en la cascada de identidad y consumir su context pack
   compilado (ver ADR-009).

Para una familia existente eso es un INSERT, una vista, un nodo al final de dos
o tres workflows y configuración: horas, no semanas. Un worker code-first nace
cumpliéndolo. La suite `conformance/` es la especificación de verdad: responde
"¿cumple el contrato?" ejecutándose contra cualquier worker.

Patrón estrangulador: si algún día se reescribe una familia, será por una razón
de negocio, y el contrato garantiza que el OS ni se entera.

### Vigilantes: motor global, política local

Ni un vigilante global monolítico ni uno por departamento. Cada **motor** se
construye una vez y cada departamento aporta su **política**:

| Vigilante     | Motor (global, uno)                                | Política (por departamento)      |
| ------------- | -------------------------------------------------- | -------------------------------- |
| Latido        | Heartbeat sobre ejecuciones n8n + bus              | Cadencia esperada de cada worker |
| QA muestral   | Un evaluador LLM-as-judge sobre trazas de Langfuse | Rúbrica del departamento         |
| Deriva de KPI | Un job de bandas históricas                        | Qué KPIs y qué umbrales          |

Encima, dos figuras y solo dos: el **supervisor de departamento**, que consume
los tres vigilantes de su ámbito y actúa dentro de él (reintenta, degrada
autonomía, escala); y **un generalista** transversal que mira el gasto LLM
agregado, las anomalías cruzadas y a los propios vigilantes —empieza siendo un
informe diario a Telegram, no un agente.

Regla heredada (D11) que se mantiene: **un vigilante propone, nunca aplica**.
Toda corrección entra como propuesta `pending` y la firma un humano.

## Consecuencias

### Positivas

- Cero riesgo de regresión sobre workers en producción: se les añaden bordes,
  no se les abren las entrañas.
- El coste de incorporar una familia existente al OS se mide en horas, lo que
  hace la adopción políticamente viable dentro del equipo.
- Un solo evaluador, un solo heartbeat y un solo job de deriva que mantener, en
  vez de uno por familia.
- La suite de conformance convierte "cumple el patrón" en algo que responde CI,
  no una opinión en una revisión.
- El contrato es la razón por la que ADR-004 y ADR-007 pueden permitirse ser
  agnósticos de tecnología.

### Negativas

- Ocho casillas ya no es un contrato pequeño, y ha crecido tres veces en el
  mismo documento que lo definió. Cada casilla nueva es trabajo retroactivo en
  todos los workers existentes: el contrato necesita su propio versionado y una
  política de qué pasa con quien cumple v1 cuando salga v2.
- Por dentro sigue habiendo cinco maneras de hacer las cosas. El contrato
  estandariza lo observable, no la mantenibilidad: arreglar un bug en Biónica
  sigue sin parecerse a arreglarlo en LA-RAG.
- Rúbricas por departamento significa que las puntuaciones de QA no son
  comparables entre departamentos, aunque el motor sea el mismo. Un "7" de
  marketing y un "7" de operaciones no miden lo mismo.
- El motor único de QA es un punto único de fallo y un coste LLM recurrente que
  crece con el número de workers muestreados.
- "Propone, nunca aplica" implica que el sistema no se autorrepara: si nadie
  revisa la bandeja, las propuestas se apilan y el problema sigue vivo.

## Alternativas descartadas

- **Reescribir las familias existentes bajo un patrón maestro.** Coherencia
  total a cambio de riesgo total sobre sistemas que facturan. Sobreingeniería.
- **Dejar que cada familia siga con su propio evaluador y su propia
  vigilancia.** Es el estado actual: cero coste de migración, cero QA
  transversal, imposible de vender como producto.
- **Un vigilante único global con reglas únicas.** Simple de construir e
  inservible: la rúbrica de un post de Instagram y la de un asiento contable no
  se parecen en nada.
- **Un vigilante completo por departamento.** Máxima adecuación al dominio y
  N implementaciones que mantener; es multiplicar el motor por departamento sin
  necesidad.
- **Vigilantes que apliquen correcciones automáticamente.** Más rápido y menos
  vendible: un producto que se auto-modifica sin firma no pasa una auditoría.
