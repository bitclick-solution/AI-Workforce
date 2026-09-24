VIGENTE

# Runbook · Prueba técnica del stack

Cómo ejecutar, demostrar y diagnosticar la rebanada «Prueba técnica del stack: Temporal, bucle del agente sobre AI SDK y gateway MCP».

- Especificación: `docs/specs/prueba-tecnica-del-stack.md`
- Bandera: `AIW_PRUEBA_STACK`. Apagada, el proceso del trabajador imprime qué le falta y termina con código cero.
- Zona crítica: `packages/mcp-gateway`, `packages/domain` (políticas), `packages/ledger` (a través de `anotar`) y `.github/workflows/ci.yml`.

## Levantar el entorno

`pnpm dev:up` levanta PostgreSQL, Temporal, Langfuse, Centrifugo, Silo y Mailpit. La primera vez copia `.env.example` a `.env` y sustituye cada `GENERAR` por un valor aleatorio local, incluidos `POSTGRES_PASSWORD` y `DEMO_CONECTOR_SECRETO`. Si `.env` ya existía de una rebanada anterior, le añade las variables nuevas de `.env.example` sin tocar las que ya tiene; `pnpm dev:up --solo-env` hace solo eso, sin arrancar contenedores. No hay ninguna credencial versionada.

Los mandatos de esta rebanada leen su configuración del entorno de la terminal y **no** leen `.env`. Antes de migrar o de lanzar la demostración, carga `.env` en la terminal, compón `DATABASE_URL` con los valores de PostgreSQL y enciende la bandera. El orden importa: `.env` trae `AIW_PRUEBA_STACK=0`, así que la bandera va después.

En bash o zsh:

```bash
pnpm dev:up
set -a; . ./.env; set +a
export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/aiworkforce"
export AIW_PRUEBA_STACK=1
pnpm --filter @aiw/db db:migrar
```

En PowerShell, desde la raíz del repositorio:

```powershell
pnpm dev:up
Get-Content .env | Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=' } | ForEach-Object {
  $nombre, $valor = $_ -split '=', 2
  [Environment]::SetEnvironmentVariable($nombre, $valor, 'Process')
}
$env:DATABASE_URL = "postgresql://$($env:POSTGRES_USER):$($env:POSTGRES_PASSWORD)@localhost:$($env:POSTGRES_PORT)/aiworkforce"
$env:AIW_PRUEBA_STACK = '1'
pnpm --filter @aiw/db db:migrar
```

La forma `AIW_PRUEBA_STACK=1 pnpm …` delante del mandato solo funciona en bash. En PowerShell la variable se pone antes, en su propia línea, y dura lo que dure la terminal.

## La demostración

En la misma terminal en la que cargaste el entorno:

```bash
pnpm --filter @aiw/worker demo:cobros          # espera a que decidas tú
pnpm --filter @aiw/worker demo:cobros --auto   # se aprueba sola, para grabarla
```

Qué hace, en orden:

1. Siembra una organización con el departamento de Finanzas y dos puestos: **Cobros** (activo, lectura N3, escritura N1) y **Conciliación** (en prueba). Imprime el tenant y la tarea.
2. Arranca un trabajador de Temporal en una cola propia y lanza el flujo `tareaAgente`.
3. El agente llama a `listar_facturas_vencidas` por el gateway. Salen tres facturas.
4. Por cada factura propone `crear_nota_seguimiento`, que es escritura N1: se crea una aprobación con borrador opaco y resumen legible, y el flujo espera. La demostración imprime el mandato exacto para decidir cada una.
5. Tras las notas, delega la conciliación de la primera factura al puesto **Conciliación** como flujo hijo con contrato. El hijo está en prueba, así que sus escrituras quedan simuladas.
6. Cierra la tarea e imprime pasos, aprobaciones, escrituras hechas, saltadas y simuladas, coste en euros, verificación de la cadena de auditoría y el contador.

Con `--auto` la demostración se aprueba a sí misma y no espera a nadie: es la forma de grabarla de un tirón.

## Decidir una aprobación

Decide desde una segunda terminal, con el entorno cargado igual que en la primera: sin `DATABASE_URL` el mandato no puede leer la aprobación. La bandera no hace falta para decidir.

```bash
pnpm --filter @aiw/worker decidir <aprobacionId> aprobada --tenant <tenantId>
pnpm --filter @aiw/worker decidir <aprobacionId> rechazada --tenant <tenantId> --motivo "Ya nos pagó ayer"
pnpm --filter @aiw/worker decidir <aprobacionId> editada --tenant <tenantId>
```

El mandato registra la decisión con las funciones de `@aiw/ledger` —la misma transacción escribe la decisión y su entrada en el libro— y entrega la señal `decisionDeAprobacion` al flujo de la tarea.

En producción esta señal la produce «Aprobación por correo v0»: la persona pulsa un enlace firmado de un solo uso y `apps/channels` hace lo mismo. El mandato existe para poder demostrar la espera y la reanudación sin depender de un servidor de correo.

El tenant hace falta y no se adivina: las políticas de RLS no dejan leer una aprobación sin saber de quién es. Sale de `--tenant` o de `AIW_TENANT`.

## Qué comprobar cuando algo va mal

| Síntoma                                     | Dónde mirar                                                                                                                                              |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El proceso arranca y termina sin hacer nada | Falta la bandera, `DATABASE_URL` o `DEMO_CONECTOR_SECRETO`. El propio proceso lo dice. Carga `.env` y enciende la bandera como en «Levantar el entorno». |
| `ConectorNoRegistrado`                      | El nombre de `conector.nombre` en la base no coincide con ninguna fábrica registrada en el proceso.                                                      |
| `ReferenciaDeSecretoNoResoluble`            | `conector.referencia_secreto` apunta a una variable que no está en el entorno del gateway.                                                               |
| `HerramientaNoAutorizada`                   | La herramienta no está en `autorizacion_herramientas.lista_blanca`, o la autorización tiene `revocada_en` puesta.                                        |
| `PasoNoPermitido` con decisión `simular`    | El puesto está `en_prueba`. Es lo correcto: en prueba no se escribe fuera.                                                                               |
| `PasoNoPermitido` con decisión `detener`    | La tarea agotó su presupuesto. Hay una aprobación de ampliación pendiente.                                                                               |
| La tarea queda en `esperando_aprobacion`    | O hay una aprobación sin decidir, o se detuvo por presupuesto. `tarea.resultado` lo dice.                                                                |
| La tarea pasa a `fallida`                   | El conector falló cuatro veces seguidas. El motivo está en `tarea.resultado` y los cuatro intentos en el libro.                                          |

## Reconstruir el estado de una tarea

`tarea.estado` es una proyección: la verdad es el historial de Temporal. Para reconstruirla, consulta el flujo:

```bash
temporal workflow query --workflow-id demo-cobros-<tareaId> --type estadoDeLaTarea
```

## Verificar el libro y el contador

La demostración lo imprime al terminar. A mano, con `verificarCadenaEnBase` de `@aiw/ledger` sobre el tenant: devuelve si la cadena es válida, cuántas entradas tiene y, si está rota, en qué número de orden.

El contador cuadra por construcción: `anotar` suma una acción por entrada en la misma transacción, así que `contador_consumo.acciones` es siempre el número de entradas del periodo, y `coste_euros` la suma de sus costes.

## Límites conocidos

- **El error estándar del conector no se filtra.** Un conector servido por entrada estándar hereda el `stderr` del trabajador, y el gateway no pasa ese flujo por ningún guardia. Un conector que volcara su entorno o su credencial en `stderr` los dejaría en claro en los registros del trabajador. Es responsabilidad del conector no hacerlo: el de demostración no escribe nada ahí, y la revisión de cualquier conector nuevo tiene que mirarlo.
- **Ventana de repetición de una herramienta.** Si el proceso muere entre la llamada al conector y la escritura de la fila del paso, un reintento vuelve a llamar. No se puede cerrar sin que el conector acepte claves de idempotencia. El identificador del paso va en la entrada de auditoría, así que una repetición se ve en el libro.
- **Profundidad de delegación uno.** Un flujo hijo no delega. El ADR-004 prevé profundidad configurable; esta rebanada no la implementa.
- **Un hijo no espera decisiones humanas.** Si la política del puesto destino exige aprobación, la petición queda registrada y se resuelve por vencimiento en vez de bloquear al padre más allá de su plazo.
- **El estado `pausando` del ADR-015 no existe todavía** en la enumeración de estados del puesto: añadirlo es una migración y va en su rebanada. Lo que sí funciona es que un puesto `pausado` no da ningún paso y que uno `en_prueba` no escribe fuera.
