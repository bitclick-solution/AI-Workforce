VIGENTE

# Runbook · Bitclick como primera organización: Cobros sobre su Odoo real

Pasos exactos, en orden, para llevar el puesto de Cobros de Bitclick del Odoo
real de pruebas hasta el informe semanal (ADR-024,
[especificación](../specs/bitclick-cobros-odoo-pruebas.md)). Comandos para
PowerShell; en bash cambia la forma de exportar variables, no los mandatos.

El Constructor construye y prueba con las grabaciones de `connectors/odoo` y
con dobles: lo que prueba la integración continua es el código, nunca el Odoo
real. Los pasos 2 a 9 de este runbook los ejecuta el Probador (o Jesús) en su
propia máquina, después de fusionar, con sus propias credenciales.

## Aviso: el modelo de esta tarea no es todavía Bedrock real

La plantilla certificada `finanzas.reclamacion-de-cobros`
(`@aiw/platform-agents`) fija su propio `enrutadoModelo`
(`{ proveedor: 'prueba', modelo: 'deterministico' }`), y esta rebanada no la
toca. El bucle del agente (`apps/worker`) resuelve ese enrutado con
`@aiw/models/enrutado.ts`, que hoy solo tiene registrado el proveedor de
prueba: el puente que instalaría ahí un proveedor real de Bedrock o Vertex
(`crearAdaptadorAnthropic` de la ruta «Modelos v1», ya construida para los
casos dorados y los evals, pero nunca conectada al enrutador del bucle) no
existe todavía en el repositorio. Es un hueco de arquitectura previo a esta
rebanada, no algo que se decidiera aquí.

Consecuencia práctica: lanzar la tarea con este runbook **no gasta en
Bedrock**, aunque tengas `AWS_ACCESS_KEY_ID` en tu `.env` — esas credenciales
las usan los casos dorados de Cobros (`pnpm --filter @aiw/evals evals:smoke`,
job **Bedrock UE · integración** de la CI) y no el lanzamiento de esta
organización. El conector de Odoo sí es el real de punta a punta: los
criterios de hecho 1, 3, 4, 5 y 6 se verifican contra Odoo de verdad, y eso es
lo que este runbook comprueba. Propón en Notion, como rebanada aparte, cablear
el proveedor real de Bedrock o Vertex en el enrutador del bucle si quieres que
la decisión de Cobros la tome un modelo de verdad.

## 1. Requisitos previos

Variables que hacen falta en tu `.env` local, con sus nombres y sin valores.

### Odoo (ya lo tienes)

`ODOO_URL`, `ODOO_BASE`, `ODOO_USUARIO`, `ODOO_CLAVE_API`. Opcional,
`ODOO_MCP_URL` (por defecto `http://odoo-mcp:8000/mcp`).

### SMTP real, para que el correo llegue a tu bandeja

El código ya admite SMTP con `nodemailer`
(`apps/channels/src/correo/smtp.ts`): cualquier proveedor que hable SMTP vale
—Gmail con una contraseña de aplicación, un proveedor transaccional (Postmark,
SES, Brevo…) o el que ya use Bitclick—, el código no distingue entre ellos.

| Variable                     | Qué es                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AIW_APROBACION_CORREO`      | `1` para encenderla.                                                                                                                                   |
| `AIW_APROBACION_CLAVE_FIRMA` | Clave de firma del enlace de aprobación. Genérala tú, no la reutilices de otro entorno.                                                                |
| `AIW_CORREO_PROVEEDOR`       | `smtp` (no `memoria`, que es el de las pruebas).                                                                                                       |
| `AIW_CORREO_REMITENTE`       | El remitente que verá Jesús, p. ej. `agentes@<tu-dominio>`.                                                                                            |
| `BITCLICK_CORREO_JESUS`      | Opcional. El correo real de Jesús, destino de los recordatorios. Sin ella, la siembra del paso 5 usa un valor de repuesto que no llega a ningún buzón. |
| `AIW_CORREO_SMTP_HOST`       | El host de tu proveedor SMTP.                                                                                                                          |
| `AIW_CORREO_SMTP_PUERTO`     | Su puerto (587 con STARTTLS es lo habitual).                                                                                                           |
| `AIW_CORREO_SMTP_TLS`        | `1` si tu proveedor exige TLS desde el primer byte; con STARTTLS en 587, déjala en `0`.                                                                |
| `AIW_CORREO_SMTP_USUARIO`    | Usuario SMTP.                                                                                                                                          |
| `AIW_CORREO_SMTP_CONTRASENA` | Contraseña o token SMTP.                                                                                                                               |
| `AIW_SENAL_PROVEEDOR`        | `temporal` (no `memoria`): sin esto, la decisión no llega al flujo real.                                                                               |

### Bedrock, para el modelo (de los casos dorados y los evals; ver el aviso de arriba)

Las credenciales del usuario IAM local `aiw-dev`, o lo que diga
[`docs/runbooks/modelos-funciones-ausentes.md`](modelos-funciones-ausentes.md)
si ya cambiaron. Ninguna de estas variables hace que la tarea de Cobros gaste:
ver el aviso de arriba.

| Variable                | Qué es                                     |
| ----------------------- | ------------------------------------------ |
| `AIW_BEDROCK_REGION_UE` | Región de Bedrock UE, hoy `eu-north-1`.    |
| `AWS_ACCESS_KEY_ID`     | Clave de acceso del usuario IAM `aiw-dev`. |
| `AWS_SECRET_ACCESS_KEY` | Clave secreta del mismo usuario.           |

### El resto del entorno local

`DATABASE_URL`, `AIW_TEMPORAL_DIRECCION` y `AIW_TEMPORAL_ESPACIO` no viven en
`.env`: los compone `pnpm local:arrancar` al lanzar sus propios procesos. Para
ejecutar los guiones de este runbook a mano, en la misma terminal:

```powershell
Get-Content .env | Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=' } | ForEach-Object {
  $nombre, $valor = $_ -split '=', 2
  [Environment]::SetEnvironmentVariable($nombre, $valor.TrimEnd("`r"), 'Process')
}
$env:DATABASE_URL = "postgresql://$($env:POSTGRES_USER):$($env:POSTGRES_PASSWORD)@127.0.0.1:$($env:POSTGRES_PORT)/aiworkforce"
```

Repite esto en cada terminal nueva que uses para los pasos siguientes.
Necesitas `pnpm local:arrancar` ya ejecutado al menos una vez (PostgreSQL
migrado, Temporal escuchando): [`entorno-local.md`](entorno-local.md).

## 2. Comprobación de registros compartidos (solo lectura, criterio de hecho 1)

Antes de encender el conector, comprueba qué contactos y qué productos sin
empresa asignada ve el usuario mínimo del MCP. No escribe nada en Odoo.

```powershell
pnpm --filter @aiw/connector-odoo comprobar:registros-compartidos
```

Guarda la salida de esta orden (una captura o el texto) como la constancia que
pide el criterio de hecho 1.

## 3. Qué haces en Odoo si aparece un registro compartido que no debe verse

Para cada contacto o producto que la orden anterior liste y que no deba verse
desde la empresa de pruebas: ábrelo en Odoo, pestaña **Empresa** (`Company`),
y asígnale la empresa real de Bitclick en vez de dejarlo sin empresa. Repite
el paso 2 después de asignarlas todas, hasta que la lista quede vacía o solo
con registros que sí pueden verse desde cualquier empresa (por ejemplo, un
producto genérico sin datos de cliente).

## 4. Enciende el conector de Odoo

En tu `.env`:

```
AIW_CONECTOR_ODOO=1
```

Vuelve a cargar el `.env` en la terminal (repite el bloque de PowerShell del
paso 1) antes de seguir.

## 5. Siembra la organización persistente de Bitclick (criterio de hecho 2)

```powershell
pnpm --filter @aiw/worker bitclick:sembrar
```

Crea el departamento Finanzas y el puesto Cobros desde la plantilla
certificada `finanzas.reclamacion-de-cobros`, en periodo de prueba y con
`crear_nota_seguimiento` en N1. Guarda el identificador del tenant en
`.aiw-local/bitclick.json` (fuera del repositorio: no se sube). Es seguro de
repetir: si ya existe, lo dice y no crea nada nuevo. Sobrevive a `pnpm
local:parar` y a `pnpm local:arrancar`; solo `pnpm local:a-cero` la borra
(vuelve a sembrar después con este mismo comando).

## 6. Lanza una tarea de Cobros (criterios de hecho 3, 4 y 6)

```powershell
pnpm --filter @aiw/worker bitclick:cobros
```

Arranca un trabajador de Temporal con el conector real de Odoo (el proceso
hijo que lanza este guion habla con la empresa de pruebas, nunca con otra) y
lanza una tarea nueva sobre el puesto ya sembrado. Es repetible: cada
ejecución crea una tarea raíz nueva. **Lánzala a mano, y como mucho una vez al
día si decides programarla — nunca en bucle.** El coste queda en el contador
del tenant (paso 8).

Deja la terminal abierta: el trabajador corre en ese proceso hasta que la
tarea termina.

## 7. Aprueba o rechaza desde el correo (criterio de hecho 5)

En otra terminal, con las mismas variables del paso 1 cargadas y las de SMTP
del paso 1:

```powershell
pnpm --filter @aiw/channels dev
```

Si el agente propone un recordatorio, te llega un correo real con un enlace de
aprobación firmado. Aprobarlo ejecuta `crear_nota_seguimiento` en Odoo;
rechazarlo no escribe nada. El enlace vale por el tiempo de
`AIW_APROBACION_VALIDEZ_HORAS` (72 horas por defecto) o por lo que fije
`BITCLICK_VALIDEZ_APROBACION_SEGUNDOS` al lanzar la tarea del paso 6.

## 8. Comprueba la nota en Odoo, el libro y el contador

- En Odoo: abre la factura y comprueba la nota de seguimiento (o la actividad
  con fecha límite) que se ha creado.
- Libro y contador, con el tenant que imprimió el paso 6:

  ```powershell
  pnpm --filter @aiw/worker bitclick:informe
  ```

  (el mismo guion del paso 9 ya muestra la cadena verificada y el coste; para
  solo la cadena, `verificarCadenaEnBase` se imprime también al terminar la
  tarea del paso 6).

## 9. Genera el informe semanal (criterio de hecho 7)

Tras al menos una semana de uso (varias ejecuciones del paso 6):

```powershell
pnpm --filter @aiw/worker bitclick:informe
```

Muestra el número de tareas del periodo, cuántas se aprobaron sin cambios y el
coste total, a partir de las consultas de lectura del contador ya construidas
(`tareasDelPeriodo`, `costePorPuesto`): sin tabla nueva. Es la primera
evidencia real con la que Jesús decide cuándo migrar los agentes actuales de
Bitclick a la plataforma — decisión fuera de esta rebanada.
