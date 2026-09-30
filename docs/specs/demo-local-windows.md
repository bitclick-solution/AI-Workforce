VIGENTE

# Especificación · Demo local de punta a punta en Windows: arranque, Sala v1 con presencia real y parada

- Rebanada: [Notion](https://app.notion.com/p/3eb5306618988171b6efeb3975ccc034) · Ciclo 1 · Tipo Plataforma · Paquetes `deploy`, `rooms`, `api`, `web`, `docs` (más `scripts/`, `.github/workflows/ci.yml`) · P0
- Rama: `rebanada/demo-local-windows` (PR #50, fusionado) y su seguimiento `rebanada/demo-local-windows-seguimiento` (este PR, tras la verificación del Probador).
- Plan de referencia: [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn); especificaciones hermanas [`entorno-local.md`](entorno-local.md) (arranque de un solo comando) y [`sala-v1-presencia.md`](sala-v1-presencia.md) (Centrifugo, presencia); [ADR-026](../adr/ADR-026.md) (privacidad de la presencia).
- Zona crítica: el PR #50 sí (tocaba `invitarPropietario` y `.github/workflows/ci.yml`; ya fusionado). Este PR de seguimiento no: solo toca `scripts/` y documentación, nada de `.github/workflows` ni de `CODEOWNERS`.

## Objetivo

Desde un clon limpio de `main` en la máquina Windows de Jesús, `pnpm local:arrancar` deja el entorno arriba con Node y pnpm ya resueltos aunque pnpm solo exista como lanzador de Corepack; `pnpm local:parar` para de verdad `api`, `web` y el worker aunque Windows no tenga grupos de procesos; repetir `pnpm local:arrancar` con su propio Compose ya levantado no aborta por un falso conflicto de puertos; la persona propietaria que invita la demo ve la Sala v1 real con presencia en vivo en vez de «Todavía no hay salas»; y Centrifugo v6 acepta de verdad el canal `sala:…` en vez de rechazarlo en silencio. Nace de los seis fallos que encontró el Probador el 30-9 en esa misma máquina, con archivo y línea, recogidos en la rebanada de Notion.

## Paquetes tocados

- `scripts/`: `local-comun.mjs` (resolución de pnpm en Windows, parada del árbol de procesos, prioridad de entorno), `local-requisitos.mjs` (versión de pnpm), `local-arrancar.mjs` (idempotencia del Compose, entorno de los procesos lanzados, `AIW_SALA_V1`).
- `deploy/compose/centrifugo/config.json`: espacio de nombres `sala` (Centrifugo v6).
- `packages/rooms`: `centrifugo.ts` propaga el error de Centrifugo en vez de devolverlo envuelto sin más.
- `apps/api`: `identidad/invitar.ts` (participante de la sala general, zona crítica) y `rutas/sala.ts` (registra en vez de degradar en silencio).
- `apps/worker`: `comprobar-centrifugo.ts` (comprobación de la CI, criterio 6).
- `.github/workflows/ci.yml`: un paso más en «Entorno local arranca desde cero».
- `docs/runbooks/entorno-local.md`: sección de Windows.

## Endpoints, flujos y datos

Ninguno nuevo. Sin migración. `invitarPropietario` gana una escritura más (`sala_participante`) dentro de la misma transacción que ya tenía, con el rol `aiw_app` que ya usa para escribir en tablas de negocio.

## Criterios de hecho

Los nueve de la rebanada en Notion:

1. En Windows, los scripts de local lanzan un pnpm 10 o superior, también cuando pnpm solo existe como lanzador `.cmd` o `.ps1`. La comprobación de requisitos exige pnpm 10 o superior con la misma resolución que usan los scripts, y avisa si la versión difiere del `packageManager`.
2. `pnpm local:parar` para de verdad `api`, `web` y el worker, en Windows y en Linux o macOS. Si no puede parar alguno, lo dice y no borra `procesos.json`.
3. `pnpm local:arrancar` es idempotente: con su propio Compose levantado, reconoce sus contenedores y sigue. Solo aborta por puertos ocupados por otros programas.
4. La persona propietaria invitada es participante de la sala general y, con la Sala v1, ve la sala real.
5. Centrifugo declara el espacio de nombres `sala`, con presencia y entradas y salidas, y no usa opciones que la v6 no tiene. Suscribirse a `sala:…` funciona y la presencia muestra a quien está en la sala. Si Centrifugo rechaza un canal, la API lo registra como error en vez de degradar en silencio.
6. La CI se suscribe a un canal `sala:` real contra el Centrifugo del Compose y comprueba la presencia.
7. La Sala v1 viene encendida por defecto en local. Una variable exportada en la terminal manda sobre el `.env`.
8. `docs/runbooks/entorno-local.md` tiene una sección de Windows. La CI está en verde.
9. Tras fusionar, el Probador lo verifica en la máquina de Jesús: arrancar, iniciar sesión, Sala v1 con presencia real en dos ventanas y parar (fuera del alcance de esta sesión: no hay Windows ni Docker aquí).

## Decisiones que el plan no fija

1. **`invitarPropietario` añade el participante, no el guion de la demo.** El fallo 4 aparece en el guion de `local-arrancar.mjs`, pero la causa es que `invitarPropietario` —la única puerta de alta, la use quien la use— nunca escribe en `sala_participante`. Arreglarlo en el guion de la demo habría dejado el mismo agujero para cualquier invitación real de Bitclick. El alta ocurre dentro de la misma transacción, con el rol `aiw_app` (antes de cambiar a `aiw_identidad`), buscando la sala por `nombre = NOMBRE_SALA_GENERAL` como ya hace `apps/api/src/rutas/sala.ts`; si esa organización todavía no tiene sala general (una organización nueva sin sembrar), no se crea aquí — crear la sala general de una organización nueva es una decisión de alta de organización que no pide esta rebanada, y no hay ningún criterio de hecho que la exija. El alta es idempotente (`on conflict (tenant_id, sala_id, persona_id) do nothing`, el mismo índice único que ya usa `asegurarSalaDeEquipo`) y anota `sala.miembro_anadido` con el mismo nombre de acción que usa esa actividad, solo si de verdad insertó una fila nueva.
2. **`sala.miembro_anadido` se declara localmente en `apps/api`, no se importa de `apps/worker`.** Las fronteras de `CLAUDE.md` prohíben que una app importe de otra; `apps/worker/src/actividades/sala.ts` ya declara ese mismo nombre de acción para su propio uso. Se repite el literal (`'sala.miembro_anadido'`) en `apps/api/src/identidad/auditoria.ts` con un comentario que señala el original: dos módulos que no se ven escriben la misma cadena a propósito, y una consulta de auditoría que filtre por `accion` los ve igual sin que ninguno importe al otro.
3. **La resolución de pnpm en Windows vive una vez en `local-comun.mjs` y la usan por igual `lanzarProceso`, `local-arrancar.mjs` y `local-requisitos.mjs`.** El fallo 2 es en el fondo un problema de tener dos caminos (lanzar de verdad, comprobar que se puede lanzar) que podían resolver pnpm de dos formas distintas y no estar de acuerdo. Con Node ya sin poder lanzar un `.cmd`/`.ps1` sin `shell: true` (arreglo de seguridad de abril de 2024, CVE-2024-27980), y sin que `npm_execpath` sirva en la máquina de Jesús (sale vacío bajo `pnpm exec`), la única resolución fiable es: mismo mandato (`pnpm`), `shell: true` solo en `win32`, argumentos citados a mano porque Node no cita nada por su cuenta cuando el propio proceso pide el intérprete de comandos. Los argumentos son siempre fijos (nunca los escribe quien invoca el comando), pero se citan igual: es el precio pequeño de una resolución que no dependa de adivinar si esta vez pnpm es un `.exe` nativo o un lanzador.
4. **La comprobación de versión de pnpm avisa, no aborta, si difiere del `packageManager`.** `packageManager` en `package.json` (`pnpm@10.33.0`) es lo que fija Corepack; un pnpm 10.x más nuevo en el PATH del sistema (no gestionado por Corepack) sigue sirviendo para todo lo que hace `local:arrancar`, así que un aviso basta — abortar ahí habría bloqueado a cualquiera con un pnpm 10 más reciente sin ninguna razón real.
5. **La idempotencia del Compose se limita a los puertos que publica el propio `docker-compose.dev.yml`, mirando `docker compose ps` del propio proyecto (`aiw-dev`).** `docker compose ps` sin más argumentos que los de `composeArgs` (que ya fija `-f` a ese fichero) solo puede listar contenedores de este proyecto — Docker los distingue por la etiqueta de proyecto, nunca por el puerto — así que cualquier contenedor que aparezca ahí es, por construcción, «nuestro». Si su publicador (`Publishers`, o `Ports` como resguardo en Compose más viejo) incluye el puerto que se iba a dar por ocupado, no es un conflicto: es este mismo Compose, parado a medias o ya arriba de una ejecución anterior. Los puertos de `api` y `web` (3000, `AIW_API_PUERTO`) quedan fuera de este cambio: no los levanta Compose, así que `docker compose ps` nunca los explica, y el criterio de hecho solo habla del Compose («con su propio Compose levantado»). Si `local:arrancar` se ejecuta dos veces sin parar `api`/`web` primero, seguirá abortando por esos dos puertos — es el comportamiento ya documentado, y `pnpm local:parar` sigue siendo el camino para repetir un arranque completo.
6. **`llamarApi` (Centrifugo) lanza `ErrorCentrifugo` cuando la respuesta trae `error`, en vez de devolver el cuerpo tal cual.** Antes, un canal rechazado (v.g. 102 «unknown channel») no lanzaba nada: `presenciaDeSala` leía `respuesta.result?.presence`, no encontraba nada y devolvía una lista vacía, indistinguible de «nadie conectado». Quien llama (`apps/api/src/rutas/sala.ts`) ya tenía un `catch` pensado para cuando Centrifugo está caído (la sala sigue funcionando con consulta periódica, a propósito); ese `catch` se queda, pero ahora, si el error es un `ErrorCentrifugo` (Centrifugo respondió, y respondió que no), se registra con `console.error` antes de degradar — nunca en silencio. `publicarEnSala` en el trabajador (`avisarSala`, `apps/worker/src/actividades/contexto.ts`) ya envolvía la llamada en `try`/`catch`, así que sigue siendo de mejor esfuerzo sin tocarlo. `avisarEscribiendo` en `apps/api/src/rutas/sala.ts` no lo envolvía (no hacía falta: antes `publicarEnSala` nunca lanzaba) y con `ErrorCentrifugo` sí podía propagar una excepción no capturada hasta la ruta HTTP — lo señaló el Revisor en la primera vuelta de este PR. Se corrige con el mismo patrón que ya usa el trabajador: `try`/`catch` con `console.error`, nunca en silencio y nunca rompiendo el aviso de que se escribe.
7. **La comprobación de la CI (criterio 6) vive en `apps/worker` como `comprobar-centrifugo.ts`, ejecutada con `tsx` como el resto de guiones de demostración de ese paquete.** Es el único paquete de aplicación que ya depende de `@aiw/rooms` y tiene `tsx` a mano sin añadir nada nuevo; firma sus propios tokens con las mismas funciones que usa la API de verdad (`tokenDeConexion`, `tokenDeCanal`), abre dos WebSocket de Node contra el Centrifugo del Compose (una conexión visible y una con el `override` de presencia oculta del PR #49) suscritas al mismo canal `sala:<tenant-aleatorio>:<sala-aleatoria>`, y comprueba con la API HTTP que la presencia trae a la visible y no a la oculta. Es una prueba de humo (falla también si Centrifugo tarda más de 10 s), no un caso de prueba unitario: lo unitario (tokens, publicar, presencia) ya lo cubre `packages/rooms/src/centrifugo.test.ts` con un `buscar` simulado, y lo que faltaba —que la CI no lo vería, per la propia rebanada— es la resolución de canal y del `override` de presencia oculta contra la configuración real de Centrifugo (el propio #49 solo lo probó con Centrifugo simulado; pedido de la sesión de dirección tras el cambio de orden de fusión con este PR, barato de añadir porque reutiliza toda la infraestructura de la conexión visible).
8. **`entornoDeProceso` en `local-comun.mjs` centraliza «`.env` < entorno del proceso < lo que este comando calcula» y sustituye el orden de mezcla suelto que tenía cada llamada a `lanzarProceso` o `spawnSync` con `env`.** El fallo 6 es el mismo error repetido en varios sitios (`{ ...process.env, ...env }`, con `env` — el `.env` ya leído — ganando siempre): una sola función que exprese la prioridad correcta una vez es menos riesgo que corregir cada mezcla a mano y confiar en que ninguna futura la repita. `AIW_SALA_V0` y `AIW_SALA_V1` pasan a resolverse con `valorEntorno({}, nombre, '1')` (por defecto encendidas, pero una exportación real en la terminal las apaga) en vez de un `'1'` fijo que no dejaba apagarlas ni a propósito.

## Casos de prueba y de eval

- Unitario: `scripts/local-comun.test.mjs` (nuevo): `pararArbolDeProcesos` en los dos sentidos (`plataforma: 'win32'` con `taskkill` simulado que falla y que acierta; `plataforma: 'linux'`/`'darwin'` con `process.kill` simulado); `resolucionDePnpm`/`comandoPnpm` en los dos sentidos (con y sin `shell`, argumentos citados si tienen espacios); `entornoDeProceso` (prioridad `.env` < proceso < calculado). `scripts/local-requisitos.test.mjs` (nuevo): pnpm por debajo de 10 es error, por encima con aviso si difiere de `packageManager`, puerto del propio Compose no es error. `apps/api/src/pruebas/invitar.test.ts` (ampliado, necesita `DATABASE_URL`): `invitarPropietario` añade a la sala general si existe (con y sin ella ya de miembro, para probar el `on conflict`), no falla si no hay sala general, y anota `sala.miembro_anadido` solo cuando de verdad insertó. `packages/rooms/src/centrifugo.test.ts` (ampliado): `llamarApi` lanza `ErrorCentrifugo` con el código y el mensaje de Centrifugo cuando la respuesta trae `error`. `apps/api/src/pruebas/sala-puerto.test.ts` (ampliado, necesita `DATABASE_URL`): un `ErrorCentrifugo` en `presenciaDeSala` se registra (se espía `console.error`) y aun así responde con todos como «añadidos», sin romper la ruta; y `avisarEscribiendo` no propaga un `ErrorCentrifugo` (mejor esfuerzo, decisión 6), solo lo registra.
- Integración: sin `DATABASE_URL` no hay prueba de integración nueva en esta sesión (igual que el resto del monorepo, sin demonio de Docker aquí); las de `invitarPropietario` con base real ya existían y se amplían con el mismo patrón, se saltan con motivo sin `DATABASE_URL`. La comprobación de verdad contra Centrifugo (criterio 6) es la propia CI: no hay Docker en este sandbox para ejecutarla aquí.
- Eval: no aplica. Esta rebanada no añade comportamiento de agente.
- Auditoría y contador: `sala.miembro_anadido` desde `invitarPropietario` se comprueba en `apps/api/src/pruebas/invitar.test.ts` contando filas de `entrada_auditoria` filtradas por `accion`, igual que ya hace `apps/worker/src/pruebas/sala-equipo.test.ts` para el mismo nombre de acción desde el trabajador (ninguno de los dos usa `verificarCadenaEnBase` para esta acción en concreto; ese helper lo usan otras pruebas de `apps/worker/src/pruebas/sala.test.ts` para acciones distintas).
- Secretos: sin cambios de alcance. Ningún fichero nuevo lleva secretos; `comprobar-centrifugo.ts` lee `CENTRIFUGO_TOKEN_HMAC_SECRET_KEY` y `CENTRIFUGO_API_KEY` del entorno del paso de la CI (`.env` generado por `local:arrancar`, nunca del repositorio) y no los imprime.

## Seguimiento tras el #50 (30-9)

El Probador verificó el criterio 9 en la máquina de Jesús sobre `main` en
`43753a4` (el #50 ya fusionado, después del #49): sesión, sala, presencia
real y presencia oculta (#49) quedan bien — cinco de los seis fallos
originales, confirmados de punta a punta. `pnpm local:arrancar` vuelve a
fallar por un fallo nuevo que introdujo el propio #50, y aparecieron dos más
al probar el resto del ciclo (`local:parar` → `local:actualizar` →
`local:arrancar`). El detalle completo está en la rebanada de Notion,
sección «Verificación tras #50»; aquí solo las decisiones de esta rama:

1. **`lanzarProceso` no separa del todo al hijo (`detached`) cuando ya lo
   lanza con `shell: true` en Windows.** Es el propio arreglo del fallo 2 del
   #50 (`shell: true` para poder lanzar pnpm ahí) el que descubre esta
   combinación: Windows pierde la salida del proceso hijo cuando se pide a la
   vez `detached: true` y `shell: true` — el fichero de registro queda a 0
   bytes aunque el proceso siembre la demo bien por debajo (reproducido en
   aislado por el Probador). `unref()` ya basta para que `local-arrancar.mjs`
   no se quede esperando al hijo (la razón original de `detached`, ver la
   nota de `lanzarProceso`); separarlo también del padre solo hacía falta
   fuera de este caso concreto. `separarDelPadre(plataforma, opciones)` aísla
   esa decisión y se prueba en los dos sentidos sin necesitar Windows.
2. **Cada proceso se registra en `procesos.json` en cuanto se lanza, no
   cuando termina de arrancar.** Antes, un arranque que fallara mientras
   `local-arrancar.mjs` esperaba su salida (el caso de arriba, o cualquier
   plazo agotado) dejaba el proceso sin registrar: `pnpm local:parar` no
   podía encontrarlo ni pararlo, y quedaba huérfano. Solo hacía falta mover
   el `registrarProceso` del worker de la demo antes de la espera; `api` y
   `web` ya lo hacían bien.
3. **`local:actualizar` no dependía de una consola interactiva a propósito,
   pero `pnpm install` sí la pedía.** Sin TTY, `pnpm install` pregunta si
   puede purgar `node_modules` y, sin poder preguntar, aborta con
   `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` (pasaba con `CI=true`, que ya
   es como pnpm sabe que no debe preguntar). Se fija esa variable para esa
   llamada, sin tocar el resto del entorno.
4. **`local:actualizar` no comprobaba que el Compose estuviera arriba antes
   de migrar.** El ciclo real del Probador es `local:parar` (que también baja
   el Compose) → `local:actualizar` → `local:arrancar`; migrar contra un
   Postgres parado daba un `ECONNREFUSED` críptico. Se añade la misma
   comprobación de puerto que ya usa `comprobarRequisitos`
   (`puertoOcupado`/`valorEntorno` de `local-comun.mjs`) antes de migrar, con
   un mensaje que dice qué ejecutar. No se hace que `local:actualizar` levante
   el Compose por su cuenta: no es su responsabilidad (la tiene
   `local:arrancar`), y hacerlo aquí también habría exigido reinstalar toda
   la comprobación de requisitos que ya hace ese otro comando.
5. **Menor: en éxito, la comprobación de requisitos no decía qué pnpm había
   resuelto.** `comprobarRequisitos` devuelve ahora `pnpmInfo` (versión y
   ruta, esta última por `where`/`which`, informativa, nunca bloqueante) y
   `pnpm local:arrancar` la imprime junto a «requisitos en orden».

Sin Windows en esta sesión: los tres primeros puntos están reproducidos y
motivados por el propio informe del Probador (con el mensaje de error exacto
y la causa que él mismo aisló), no adivinados; se han probado en unitario en
los dos sentidos donde depende de la plataforma. La verificación de punta a
punta en Windows la vuelve a hacer el Probador tras fusionar este PR.

## Fuera de alcance

- Crear la sala general de una organización nueva sin sembrar: no lo pide ningún criterio de hecho de esta rebanada (decisión 1). Sería una rebanada de alta de organización.
- Cualquier cambio en la lógica de presencia configurable del perfil: es el PR #49 (`rebanada/presencia-configurable-perfil`), que se fusiona después de esta.
- Ejecutores auto-hospedados o cambios de infraestructura de la CI más allá del paso nuevo del job ya existente.
- Verificación real en la máquina Windows de Jesús (criterio 9): la hace el Probador tras fusionar. Esta sesión no tiene Windows ni Docker; ya se hizo una vuelta tras el #50 (ver «Seguimiento tras el #50» arriba) y falta repetirla tras este PR.

## Presupuesto de tokens

Presupuesto: 12 € para la rebanada entera. El PR #50 ya lo agotó (consumo real anotado en su momento, sin acceso a la facturación exacta, probablemente por encima); este seguimiento se acota a los tres puntos del informe del Probador para no sumar más de lo necesario. Consumo real total: se registra en la rebanada al abrir este PR.

## Pregunta abierta

Ninguna: el encargo de la sesión de dirección ya fija idempotencia del Compose, alcance de la sala general y orden de fusión frente al PR #49.
