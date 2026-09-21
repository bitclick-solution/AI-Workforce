REGISTRO HISTÓRICO

Copia cosechada del prototipo `bitclick-solution/iagent-platform` (commit `fbb3f37`, archivo `adr/ADR-009.md`) el 2026-09-20 por la rebanada «Cosecha del prototipo IAGENT-COMPANY». Solo se normaliza el formato con Prettier; el contenido no se edita. El diseño vigente para AI Workforce está en `docs/adr/` y en `docs/investigacion/cosecha-prototipo.md`.

---

# ADR-009: La identidad de marca se hereda en cascada organización → departamento → canal → cuenta, para voz y tokens visuales; el contexto efectivo se compila y el QA evalúa contra la cascada resuelta

- Fecha: 2026-09-15
- Estado: accepted

## Contexto

Hoy la voz de marca está copiada a mano en los prompts de cada familia, y ya se
nota la deriva entre ellas. A la vez, no se habla igual en LinkedIn que en
Instagram o TikTok, y los workers multi-cuenta deben hablar con la marca del
cliente, no con la de Bitclick. Biónica ya resuelve una versión embrionaria de
esto en producción (`ig_config` < `social_account` < `config` jsonb, y la
inyección de `website` en sus prompts), pero como mecanismo propio de una
familia, no del sistema.

## Decisión

La identidad de marca —voz **y** guía visual— se **hereda en cascada**, como el
CSS: herencia por defecto, override por excepción, gana el nivel más
específico.

```
Organización            brand voice + guía visual de Bitclick
  └── Departamento      hereda; ajusta si quiere
        └── Worker/canal reglas del canal (LinkedIn ≠ Instagram ≠ TikTok)
              └── Cuenta/cliente   (workers multi-cuenta: la marca del cliente)
```

- **El contexto efectivo se compila, no se improvisa.** En cada ejecución el
  worker recibe un _context pack_: el resultado de resolver la cascada para su
  nivel, inyectado en su prompt.
- **Los packs son ficheros versionados en el blueprint** (`brand/voice.md`,
  `brand/visual.yaml`, `channels/linkedin.md`…), no filas sueltas en una tabla.
  Cambiar la voz de marca es un PR: diff, review, historial. La organización
  edita la suya desde Mission Control; por debajo es el mismo mecanismo.
- **La guía visual viaja como tokens de diseño**, no como prosa: paleta con
  roles, tipografía, layouts y descriptores de estilo para generación de
  imagen. Se sobreescribe **por clave**: si Instagram cambia `accent`, hereda
  el resto.
- **Tres consumidores de los mismos tokens**, y por eso funcionan: los prompts
  de generación (los descriptores de estilo se construyen desde los tokens), la
  composición determinista (los colores de la plantilla se leen del pack) y el
  QA (la rúbrica "brand" del juez se genera de los MISMOS tokens: si en IG el
  accent es naranja, el juez exige naranja y penaliza el amarillo).
- **Un cambio arriba propaga hacia abajo — con firma.** Tocar la voz de la
  organización afecta a todos los departamentos: entra como propuesta (D11) y
  muestra a quién impacta antes de aprobarse.
- **La sutileza es gobernanza, no estética:** un override de canal solo puede
  tocar claves permitidas por el nivel superior (`accent` sí; `ground` y
  `primary` de la organización, no sin propuesta firmada). Así "sutilmente
  naranja en IG" no degenera en "otra marca en IG".
- **El QA muestral evalúa contra la cascada resuelta:** el juez no puntúa
  "¿suena a Bitclick?" en abstracto, sino contra el contexto efectivo de ESE
  canal. Aquí la cascada deja de ser organización y pasa a ser calidad medible.

Casilla del contrato: **todo worker declara su nivel en la cascada y consume su
context pack compilado.** Nada de copiar la voz de marca a mano en un prompt.

## Consecuencias

### Positivas

- La coherencia de marca deja de depender de la disciplina de quien edita
  prompts y pasa a ser una propiedad del sistema.
- Escalar un departamento es añadir un worker que hereda: el agente de TikTok
  nace con la voz de la organización y la de marketing puestas y solo escribe
  sus reglas de canal.
- Para el cliente de la Plantilla IA, el nivel cuenta/cliente **es** su
  onboarding de marca: da su voz una vez y todos sus workers la heredan.
- Que la rúbrica del juez se genere de los mismos tokens que usa la generación
  cierra el bucle: la coherencia se mide, no se confía.

### Negativas

- La compilación del contexto es una pieza de infraestructura nueva en el
  camino caliente de cada ejecución: si falla o se equivoca, todos los workers
  hablan mal a la vez. Punto único de fallo de reputación.
- Depurar "¿por qué este post salió amarillo?" obliga a rastrear cuatro niveles
  de herencia. Es el mismo dolor que la especificidad de CSS, aplicado a la
  marca.
- Voz en markdown y tokens en YAML, versionados en git, más la edición desde
  Mission Control: hay dos caminos de escritura para el mismo dato y habrá que
  reconciliarlos o uno de los dos mentirá.
- Las claves permitidas por nivel son una política de autorización a medida que
  hay que definir, mantener y justificar; demasiado estricta bloquea trabajo
  legítimo y demasiado laxa no protege nada.
- Un cambio en la voz de la organización invalida implícitamente las
  evaluaciones históricas de todos los departamentos: las series de QA se
  cortan y no son comparables antes y después.
- Los packs compilados inflan cada prompt: más tokens por ejecución, más coste
  y menos ventana para la tarea real.

## Alternativas descartadas

- **Seguir copiando la voz de marca en cada prompt.** Es el estado actual y la
  causa demostrada de la deriva entre familias.
- **Una única voz global sin niveles.** Simple y falso: LinkedIn e Instagram no
  admiten el mismo registro, y los workers multi-cuenta necesitan la marca del
  cliente.
- **Voz definida por worker, sin herencia.** Máxima libertad y máxima deriva;
  cambiar la voz corporativa obligaría a editar N prompts a mano.
- **Guardar los packs en tablas de configuración en lugar de en git.** Edición
  más cómoda desde la UI y sin diff, sin review, sin historial y sin poder
  desplegar la marca junto al blueprint.
- **Guía visual como prosa** ("usa colores oscuros con acentos verdes"). No es
  consumible por la composición determinista ni por la rúbrica del juez; los
  tokens sí.
- **Permitir cualquier override en cualquier nivel.** Flexible y conduce a
  marcas divergentes por canal, que es justo lo que la cascada evita.
