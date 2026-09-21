REGISTRO HISTÓRICO

Copia cosechada del prototipo `bitclick-solution/iagent-platform` (commit `fbb3f37`, archivo `adr/ADR-008.md`) el 2026-09-20 por la rebanada «Cosecha del prototipo IAGENT-COMPANY». Solo se normaliza el formato con Prettier; el contenido no se edita. El diseño vigente para AI Workforce está en `docs/adr/` y en `docs/investigacion/cosecha-prototipo.md`.

---

# ADR-008: La pausa es una primitiva del OS —`active → draining → paused`— con colas conservadas, y toda petición entre agentes lleva TTL y política de respaldo

- Fecha: 2026-09-15
- Estado: accepted

## Contexto

Hoy existe un kill switch (`enabled=false`) que corta en seco: sirve para una
emergencia y para nada más. Pero el gesto que un gerente quiere hacer a diario
es otro —"para a Biónica hasta el lunes"— y hacerlo con el kill switch deja
ejecuciones a medias y trabajo perdido. Además, en cuanto los workers se hablan
por el bus, pausar a uno afecta a los demás: alguien puede quedarse esperando
una respuesta que no llegará.

## Decisión

Pausar es un **estado del registro**, no un apagado. Todo worker es pausable y
pausar **nunca rompe un camino**:

```
active ──pausa──► draining ──(termina lo en vuelo)──► paused ──reanudar──► active
active ──kill switch──► disabled   (emergencia: corta escrituras YA)
```

- **`paused` ≠ `disabled`.** El kill switch es emergencia. La pausa es
  operativa: primero `draining` (termina la ejecución en curso, no acepta
  nuevas), después `paused` (no consume). Nada a medias, nada perdido.
- **El trabajo se acumula, no se pierde.** Es la razón de haber elegido Redis
  Streams con consumer groups: los mensajes dirigidos a un worker pausado se
  quedan en su cola con su offset. Al reanudar procesa el atraso en orden.
  Pausar = dejar de consumir; jamás borrar.
- **Presencia visible.** El cambio de estado publica
  `worker.status_changed{worker, status, by, reason}` en el bus y queda en
  `mc_worker.status`. Los compañeros lo saben, siguen trabajando entre ellos, y
  lo que era para el pausado le espera en su cola.
- **Nadie espera para siempre.** Toda petición agente→agente lleva TTL y
  política de respaldo declarada por el emisor: `continuar_sin_él`, `aparcar` o
  `escalar_a_humano`. Un agente bloqueado esperando a un compañero pausado es
  un bug de diseño.
- **Auditoría.** Quién pausó, cuándo y por qué queda en el feed de Mission
  Control. Pausar es una acción de control como aprobar o denegar.

El contrato de worker gana su casilla correspondiente: **respetar el ciclo
`draining`** — al arrancar una ejecución, comprobar estado; en `draining`,
terminar la actual y no tomar más.

## Consecuencias

### Positivas

- El cliente tiene un botón que puede pulsar sin miedo: "su empresa, su botón"
  deja de ser marketing y es una garantía técnica.
- Se recupera de forma natural del mantenimiento, del incidente y del cambio de
  prompt: pausar, arreglar, reanudar, procesar el atraso.
- El TTL con política de respaldo convierte un fallo distribuido clásico
  (espera indefinida) en una decisión explícita del emisor.
- La auditoría de pausas es material directo para el argumento de gobierno.

### Negativas

- Cooperativo, no impuesto: `draining` depende de que cada worker consulte su
  estado. Un worker que no cumpla la casilla seguirá tomando trabajo y el
  sistema no podrá impedírselo. La garantía es contractual, no del runtime.
- Una pausa larga acumula atraso, y al reanudar llega una avalancha: ráfaga de
  coste LLM, rate limits de canal y, peor, mensajes obsoletos procesados como
  si fueran de hoy (responder el lunes a un lead del miércoles anterior).
- Colas retenidas indefinidamente son memoria en Redis que crece y datos
  personales conservados más de lo previsto: interactúa mal con retención y
  GDPR.
- `draining` puede no terminar nunca si la ejecución en curso se cuelga; hace
  falta un tiempo máximo y una salida forzada, que es exactamente lo que la
  pausa limpia quería evitar.
- Cuatro estados (`active`, `draining`, `paused`, `disabled`) más autonomía y
  presupuesto es un espacio de estados que multiplica los casos a testear y las
  confusiones de operador ("¿está parado o apagado?").
- El TTL y la política de respaldo son trabajo real en cada emisor y una fuente
  nueva de bugs sutiles: el hueco anotado por `continuar_sin_él` puede pasar
  desapercibido.

## Alternativas descartadas

- **Usar solo el kill switch.** Ya existe y cuesta cero. Pierde trabajo en
  vuelo, no conserva el pendiente y convierte una operación rutinaria en un
  incidente.
- **Pausar descartando los mensajes dirigidos al worker.** Evita el atraso y la
  avalancha, pero rompe el camino: el lead que escribió mientras el worker
  estaba pausado desaparece. Inaceptable para el caso de negocio.
- **Pausar sin `draining`, cortando la ejecución en curso.** Más simple y deja
  trabajo a medias: un post publicado sin imagen, una conversación cortada.
- **Bloquear al emisor hasta que el pausado vuelva** (sin TTL). Preserva la
  semántica de petición-respuesta y propaga la pausa de un worker a media
  organización.
- **Pausar a nivel de infraestructura** (parar el contenedor o desactivar el
  workflow en n8n). Invisible para el plano de control, sin auditoría, sin
  evento de presencia y sin garantía sobre lo que estaba en vuelo.
