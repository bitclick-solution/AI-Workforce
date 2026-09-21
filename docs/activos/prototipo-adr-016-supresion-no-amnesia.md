REGISTRO HISTÓRICO

Copia cosechada del prototipo `bitclick-solution/iagent-platform` (commit `fbb3f37`, archivo `adr/ADR-016.md`) el 2026-09-20 por la rebanada «Cosecha del prototipo IAGENT-COMPANY». Solo se normaliza el formato con Prettier; el contenido no se edita. El diseño vigente para AI Workforce está en `docs/adr/` y en `docs/investigacion/cosecha-prototipo.md`.

---

# ADR-016: Borrado GDPR: supresión, no amnesia

- Fecha: 2026-09-18
- Estado: accepted

## Contexto

El circuito de borrado vivo (`LA GDPR Erasure`, webhook `POST /la-gdpr-erasure`,
por `chat_id` y/o email) anonimiza el `crm.lead` y borra `la_interaction_log`,
`la_eval_results` y `la_kb_episodes` del interesado. Se escribió antes de que
existieran la cadencia outbound y su puerta de consentimiento, así que no
alcanza ni a `ob_prospect` —prospectos de listas CSV con nombre, empresa y
correo, **re-ingeridos a diario** por `OB Prospect Ingest` desde Drive— ni a
`consent_ledger`, el registro por canal donde un `optout` deja estado `revoked`
y que el Campaign Scheduler y el First-Touch consultan _fail-closed_ antes de
cada envío (B19).

La tentación es completar el circuito con dos `DELETE` más. No funciona, y falla
en la dirección peor: **borrar la fila resucita al interesado**. El CSV de la
mañana siguiente lo vuelve a insertar, y como su fila del ledger también se ha
ido, su consentimiento pasa de `revoked` a `none` — y `none`, en la cadencia de
correo por lista fría, **pasa** (la asimetría está documentada en
`blueprints/vector-rodaja2/DISCOVERY.md` §5: solo WhatsApp y Telegram exigen
`granted`). El borrado literal no incumple por descuido: reactiva exactamente el
envío que el interesado pidió detener.

Guardar la lista de supresión con el correo en claro tampoco vale: sería
conservar el dato personal de quien ha pedido que dejes de tratarlo, en el
fichero más sensible del sistema. Hace falta una forma de reconocer a alguien
sin poder reconstruir quién es.

Una nota de encaje con el contrato del bus: `gdpr.erasure_requested` viaja con
un `subject_ref` **opaco** y un `scope` (`contracts/EVENTS.md`, regla 4), y el
circuito vivo se invoca por webhook con el correo o el `chat_id` del interesado.
Este ADR **no toca el contrato de eventos** —ni añade kinds, ni cambia
payloads—: describe qué hace el consumidor cuando le llega la petición. Cómo
resuelve un consumidor un `subject_ref` opaco hasta el correo que necesita para
calcular el HMAC sigue sin estar definido en ninguna parte, y este ADR tampoco
lo define.

## Decisión

1. **La revocación no se borra: se anonimiza y se conserva como lista de
   supresión.** Un `gdpr.erasure_requested` elimina los datos personales del
   interesado de las tablas outbound y deja en su lugar una clave irreversible
   cuyo único uso permitido es descartarlo en la siguiente ingesta. Suprimir no
   es recordar: es la prueba de que se le ha olvidado y a la vez la garantía de
   que no se le vuelve a escribir.

2. **La clave es un HMAC-SHA256 del correo normalizado con un pepper del
   entorno.** Normalización: `lower(trim(email))`, sin más reescrituras.
   Algoritmo: `hex(hmac_sha256(key = OB_SUPPRESSION_PEPPER, msg = email_normalizado))`,
   64 caracteres hexadecimales en minúscula. `OB_SUPPRESSION_PEPPER` es un
   **secret de despliegue**: jamás en la base de datos, jamás en git, jamás en
   un payload de evento. Sin pepper, un hash de correo es reversible con un
   diccionario —el espacio de los correos es enumerable— y la lista de
   supresión se convertiría en una lista legible de quién ha ejercido su
   derecho, que es otro dato personal y de los delicados.

3. **El HMAC se calcula en el plano de ejecución, nunca en SQL.** Lo calcula el
   nodo de código del workflow (`crypto.createHmac('sha256', pepper)`), no
   Postgres. Dos razones y ninguna estética: `pgcrypto` exige extensión y
   superusuario, que AGENTS.md §4 prohíbe; y un pepper que viaja dentro del
   texto de una sentencia acaba en los logs de la base y en
   `pg_stat_statements`, que es justo donde no puede estar.

4. **La ingesta descarta antes de insertar, no después.** `OB Prospect Ingest`
   calcula el HMAC de cada fila del CSV y descarta las suprimidas **antes** del
   `INSERT`. Limpiar después dejaría una ventana —entre la inserción y la
   limpieza— en la que el Campaign Scheduler puede haber creado ya la campaña y
   el First-Touch haber enviado el correo. La comprobación es un anti-join
   contra `ob_suppression` en la misma sentencia que inserta.

5. **Qué queda en cada tabla.** En `ob_prospect`: las columnas de datos
   personales del interesado pasan a `NULL` o al literal `'[borrado]'`
   (`full_name`, `company`) y la fila conserva su `subject_hmac`; `email` es la
   excepción y lleva marcador propio (punto 11). En
   `consent_ledger`: se conservan canal, estado `revoked`, marca de tiempo y el
   `subject_hmac`; las columnas que puedan arrastrar datos personales —hoy
   `evidence_ref`, que guarda la prueba del opt-in— se anonimizan. El estado
   `revoked` es lo único que no se toca nunca: es la voluntad del interesado, y
   es lo que consultan las dos puertas de consentimiento.

6. **La marca de "suprimido" es la pertenencia a `ob_suppression`, no una
   columna nueva.** Una fila está suprimida si su `subject_hmac` está en la
   lista. `ob_suppression` guarda `subject_hmac` (clave primaria),
   `suppressed_at` y `source`, y **ninguna columna con datos en claro**: un
   CHECK de formato `^[0-9a-f]{64}$` impide físicamente que alguien meta ahí un
   correo por error o por prisa.

7. **Langfuse: hoy no hay nada que borrar, y eso se documenta en vez de
   suponerse.** El despliegue corre con `RECORD_INPUTS=false` y
   `RECORD_OUTPUTS=false`: las trazas llevan modelo, tokens, latencia y el
   nombre del span con el worker delante, y **no llevan sujeto**. Por eso el
   circuito de borrado no llama a Langfuse: llamarla sería teatro. El
   compromiso, que es la otra mitad de la decisión: **subir `RECORD_INPUTS`
   exige, en el mismo cambio**, (a) que la traza lleve la referencia del sujeto
   —`correlation_id`/`trace_id`, que ya es la misma clave—, (b) que
   `LA GDPR Erasure` llame a la API de borrado de Langfuse, y (c) una retención
   equivalente a la del log de interacción (30 días). Nota honesta y
   deliberada: **la ruta y el verbo exactos de esa API hay que sondearlos contra
   nuestra instancia v4** antes de escribir el nodo. La API pública de Langfuse
   está reducida y con partes deprecadas —el mapa que tenemos vive en
   `blueprints/gabinete/src/adapters/langfuse_costs.py`, donde el coste se lee
   por `GET /api/public/v2/metrics` porque los `/metrics` anteriores figuran
   como deprecados—, y para el borrado no hay endpoint verificado por nosotros.
   Escribir hoy ese nodo contra una API que no hemos probado sería código que
   parece cumplimiento y no lo es.

8. **Lo que se le dice al interesado cambia con esta decisión.** La respuesta al
   ejercicio del derecho no puede ser "sus datos han sido eliminados" a secas:
   es "sus datos personales han sido eliminados y conservamos una clave
   irreversible, sin su correo, con el único fin de no volver a contactarle".
   Esa frase entra en la respuesta al interesado y en el registro de
   actividades de tratamiento. La práctica correcta con la comunicación mal
   redactada sigue siendo un incumplimiento, solo que del artículo de
   transparencia.

9. **Un opt-in EXPLÍCITO posterior del propio interesado levanta su supresión.**
   Cuando llega un `optin` cuyo `method` empieza por `explicit`, el circuito de
   consentimiento borra ese `subject_hmac` de `ob_suppression`. El motivo es que
   la lista de supresión frena **las re-ingestas de CSV del dueño** —el
   tratamiento que el interesado pidió cesar—, y un consentimiento explícito
   nuevo **del propio sujeto** es base legal nueva. Bloquearle el regreso sería
   usar su borrado en su contra: quien se borró en enero y en junio rellena el
   formulario pidiendo que le llamen tiene derecho a que le llamen. La guarda
   que ya existe en el ledger es la otra mitad y no se toca: `Apply Optin`
   mantiene `revoked` salvo que `left(method, 8) = 'explicit'`. Misma condición,
   dos efectos coordinados —el ledger pasa a `granted` y la clave sale de la
   lista—, de modo que un opt-in importado, inferido o traído de una lista ni
   pisa la revocación ni des-suprime a nadie.

10. **La asimetría de fallo está decidida por circuito, no por comodidad.** Los
    tres consumidores del pepper fallan distinto a propósito:
    - **Ingesta de CSV: fail-closed.** Sin `OB_SUPPRESSION_PEPPER`,
      `OB Prospect Ingest` **no ingiere a nadie**. Una ingesta que no puede
      comprobar supresiones insertaría el lote entero, suprimidos incluidos: un
      CSV completo de gente a la que se prometió no volver a escribir. Perder la
      ingesta de un día se arregla mañana; escribir a un suprimido, no.
    - **Borrado: fail-closed.** Si hay correo del interesado pero no hay pepper,
      `LA GDPR Erasure` falla ruidosamente y **no responde `ok: true` a medias**.
      Confirmar un borrado que no se ha podido completar es peor que no
      borrarlo: cierra la reclamación y deja al interesado creyendo que el
      asunto está resuelto.
    - **Escritura de consentimiento: tolerante.** `OB Consent Ledger Writer`
      registra el `optin`/`optout` aunque no haya pepper: se pierde el sello
      (`subject_hmac`), no el consentimiento. Una revocación que se cae por
      fontanería es la peor de las tres, porque el interesado cree que se ha
      dado de baja y no lo está. El sello que falte se repesca después; la
      revocación perdida no se recupera nunca.

11. **En `ob_prospect`, el correo se sustituye por un marcador único, no por
    `NULL`.** El literal es `'suprimido+<id>@gdpr.invalid'`, con el `id` de la
    propia fila. Esa columna tiene índice único sobre `lower(email)` y es por
    donde entra el upsert de la ingesta: un marcador único por fila mantiene la
    unicidad utilizable y deja la fila reconocible de un vistazo. El dominio no
    es decorativo: `.invalid` es un TLD reservado (RFC 2606/6761), no existe, no
    se puede registrar y nada sale hacia él si algún día un envío se colara.
    **Y el aviso, que es la razón de que esto esté escrito en un ADR: esos
    marcadores no son basura y no se limpian.** Quien los borre o los vacíe
    creyéndolos residuo de una migración se lleva por delante la marca de que
    esa fila fue suprimida. Todo informe que cuente "prospectos con correo"
    tiene que excluir el dominio `gdpr.invalid`; la conformance ya lo hace.

## Consecuencias

### Positivas

- La re-ingesta diaria deja de resucitar al interesado, que es el fallo que hoy
  está vivo y que un borrado ingenuo habría empeorado.
- La lista de supresión no contiene datos personales legibles: un volcado de
  `ob_suppression` sin el pepper no identifica a nadie ni dice a quién se ha
  escrito nunca.
- El CHECK de formato convierte "no guardes correos aquí" de norma escrita en
  imposibilidad física.
- La comprobación de la ingesta es una sola sentencia: no hay ventana entre
  insertar y limpiar, y por tanto no hay carrera con el Scheduler.
- La conformance puede demostrarlo con datos, no con prosa: existe la lista, no
  hay correos en claro en las filas suprimidas y ninguna fila anonimizada se
  quedó sin su clave (`conformance/test_c7_gdpr_erasure.py`).
- Langfuse queda con una decisión escrita y una condición verificable, en vez de
  con un "habría que mirarlo" que nadie hereda.
- La supresión no es una condena perpetua: el interesado puede volver por su
  propio pie, y el mismo `left(method, 8) = 'explicit'` gobierna las dos mitades
  —ledger y lista—, así que no hay dos reglas que puedan divergir.
- Cada circuito falla en la dirección que menos daño hace, y cuál es esa
  dirección está escrito por circuito en vez de quedar a lo que interprete quien
  monte el nodo.

### Negativas

- **Un secreto nuevo de clase C (no rotar).** Rotar o perder
  `OB_SUPPRESSION_PEPPER` invalida la lista entera y **no se puede recomputar**:
  los correos originales ya no existen en ningún sitio. A partir de ese momento,
  el siguiente CSV resucita a todos los suprimidos. Es el punto único de fallo
  de este diseño y hay que custodiarlo como tal.
- **El HMAC es seudónimo, no anonimato.** Quien tenga el pepper y una lista de
  correos candidatos puede comprobar pertenencia. `ob_suppression` sigue siendo
  dato personal seudonimizado y hereda sus obligaciones: acceso restringido,
  retención y mención en el registro de actividades.
- **La normalización es mínima a propósito y por eso deja huecos.**
  `lower(trim())` no unifica alias (`nombre+lista@`, puntos en Gmail) ni dominios
  equivalentes: el mismo humano escrito de otra forma pasa la criba. Endurecer
  la normalización tendría el defecto simétrico —suprimir a quien no lo pidió—
  y no se hace sin pedirlo.
- **Solo cubre sujetos con correo.** Un interesado que solo existe por teléfono
  o por `chat_id` de Telegram no tiene clave en esta v1: su borrado llega a las
  tablas de conversación pero no puede suprimirlo en la cadencia outbound. Si la
  petición llega sin correo resoluble, el circuito debe decirlo en su respuesta,
  no confirmar un borrado que no ha podido completar.
- **El algoritmo vive en n8n, fuera del repo.** La conformance comprueba el
  efecto (no reaparece, no quedan correos en claro), no la fórmula: si alguien
  cambia la normalización en un nodo, el repo no se entera. Es el precio de que
  el circuito de borrado siga siendo del plano de ejecución.
- **Sigue habiendo una fila por interesado** en `ob_prospect`. Es defendible
  —está vaciada de datos personales y su función es no volver a escribirle—
  pero exige la frase del punto 8 y un DPO que la ratifique. Esta decisión es de
  ingeniería; la valoración jurídica no la firma este ADR.
- **La ingesta paga un HMAC por fila y un anti-join por lote.** Trivial con las
  listas de hoy, a vigilar si alguien sube un CSV de decenas de miles.
- **La lista deja de ser monótona.** Con el punto 9 existe un camino de vuelta
  y, por tanto, un camino de abuso: quien pueda llamar a `/ob-consent` con un
  `method` que empiece por `explicit` puede des-suprimir. Lo acotan la auth de
  cabecera del endpoint y la exigencia de `evidence_ref` en todo `optin` (D14),
  pero antes no podía nadie y ahora sí.
- **El que vuelve, vuelve con fila nueva.** Su fila anterior quedó anonimizada
  con su marcador único, así que en `ob_prospect` habrá dos filas —una vacía y
  una viva— y su historial previo no se recupera. Es lo correcto (ese historial
  se borró), pero conviene saberlo antes de abrir un ticket de duplicados.
- **La tolerancia del ledger produce filas sin sello.** Hasta que alguien
  repesque los `subject_hmac` que falten, esas revocaciones no están en la lista
  de supresión: la revocación está registrada y la protección contra la
  re-ingesta, no. El runbook de la rodaja trae la consulta para encontrarlas.
- **El marcador ocupa la columna `email`.** Cualquier consulta, informe o export
  que cuente correos y no excluya `gdpr.invalid` contará suprimidos como
  contactables. La conformance lo excluye; los informes que escriba alguien
  mañana, habrá que acordarse.
- **El compromiso de Langfuse es un cheque a cobrar.** Mientras
  `RECORD_INPUTS=false` no hay deuda, pero si alguien sube esa variable sin
  cablear el borrado, este ADR queda incumplido en silencio y sin que ningún
  test lo note.

## Alternativas descartadas

- **Borrar la fila entera (el borrado ingenuo).** Es lo que parece correcto y es
  lo que reactiva el envío: el CSV del día siguiente reinserta al interesado y
  el ledger vacío devuelve su consentimiento a `none`, que en correo pasa. No se
  descarta por elegancia, se descarta porque hace lo contrario de lo que pide
  quien ejerce el derecho.
- **Lista de supresión con el correo en claro.** Es lo que hace medio mercado y
  funciona técnicamente. Conserva indefinidamente el dato personal de quien pidió
  que dejaras de tratarlo y crea el fichero más apetecible del sistema. Si
  mañana hay que justificar un incidente, esa tabla es el titular.
- **SHA-256 sin pepper.** Reversible por diccionario en minutos: el conjunto de
  correos plausibles es enumerable y el hash no tiene coste de cómputo. Un hash
  sin sal ni pepper es ofuscación, no seudonimización.
- **Cifrado reversible del correo.** Permitiría recuperar el dato, que es justo
  lo que no se quiere: un borrado que se puede deshacer no es un borrado.
- **HMAC en la base con `pgcrypto`.** Exige extensión y superusuario (AGENTS.md
  §4) y mete el pepper en el texto de la sentencia, de donde salta a los logs y
  a `pg_stat_statements`.
- **Una columna booleana `suppressed` en `ob_prospect`, sin tabla nueva.** La
  marca desaparecería con la fila el día que una política de retención limpie
  prospectos antiguos, y no cubre al interesado que todavía no tiene fila. La
  lista tiene que sobrevivir de forma independiente al ciclo de vida del
  prospecto.
- **Descartar en la ingesta después de insertar.** Más fácil de escribir y deja
  una ventana real: entre el `INSERT` y la limpieza caben el Scheduler y un
  envío. Una carrera en un circuito de GDPR es un incidente con forma de
  detalle de implementación.
- **Supresión irrevocable ("una vez borrado, nunca más").** Más fácil de
  auditar y defendible en la primera lectura, pero convierte el ejercicio de un
  derecho en una lista negra perpetua: el interesado que meses después quiere
  volver no puede, y el final real de esa historia es él escribiendo un correo
  para que alguien lo arregle a mano en la base de datos. El derecho al olvido
  no incluye el derecho a no ser recordado cuando eres tú quien lo pide.
- **Un solo modo de fallo para los tres circuitos.** Todo fail-closed tumba
  revocaciones por una variable de entorno que falta; todo tolerante ingiere
  listas sin poder comprobar supresiones. Cada circuito tiene una dirección
  segura distinta y unificarla significa elegir la insegura en dos de los tres.
- **`NULL` en el correo del suprimido.** No distingue al suprimido del prospecto
  que nunca tuvo correo, deja al upsert de la ingesta sin nada con lo que casar
  esa fila y hace invisible la supresión a ojo. El marcador cuesta lo mismo y se
  lee.
- **No hacer nada todavía y esperar a tener Langfuse resuelta.** Deja vivo el
  fallo de la re-ingesta y bloquea `RECORD_INPUTS=true` indefinidamente (B19).
  Las dos mitades del problema no dependen una de otra: la de las tablas se
  cierra hoy, la de las trazas queda decidida y condicionada.
