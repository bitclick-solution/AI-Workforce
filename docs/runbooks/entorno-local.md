VIGENTE

# Runbook · Entorno local completo

Cómo arrancar, parar, actualizar y resetear la plataforma completa en tu propia
máquina, sin servidor. Rebanada: [entorno local](../specs/entorno-local.md).

## Requisitos de la máquina

- **Docker** con Compose v2 (`docker compose version`), demonio arrancado.
  - macOS: Docker Desktop. Dale al menos 6 GB de RAM en **Settings › Resources**.
  - Linux: el paquete `docker` con el servicio `docker` activo (`systemctl status docker`); tu usuario en el grupo `docker` para no necesitar `sudo`.
  - Windows: no está soportado directamente. Usa **WSL2** con una distribución Linux (Ubuntu recomendado), Docker Desktop con la integración de WSL2 activada, y ejecuta todo lo de este runbook dentro de esa distribución (`wsl` desde una terminal), nunca desde PowerShell.
- **Node 22** (`.node-version`) y **pnpm 10**. Con Corepack: `corepack enable`.
- Memoria: al menos 4 GB libres, 8 GB recomendados (PostgreSQL, Temporal, Centrifugo, Langfuse con ClickHouse y Redis, Silo, Mailpit, más `api`, `worker` y `web`).
- Disco: al menos 3 GB libres, 10 GB recomendados. Los volúmenes de PostgreSQL y de ClickHouse son los que más crecen.
- `pnpm local:arrancar` comprueba todo esto solo y para con un mensaje si algo falta; no hace falta comprobarlo a mano.

## Arrancar desde cero

```bash
git clone <url-del-repositorio> aiw && cd aiw   # o `git pull` si ya lo tenías
pnpm install
pnpm local:arrancar
```

Un solo comando: comprueba requisitos, genera `.env` con secretos aleatorios
locales (nunca en el repositorio), levanta PostgreSQL, Temporal, Centrifugo,
Langfuse, Silo y Mailpit, aplica las migraciones, siembra una organización de
demostración (Finanzas con Cobros activo y la sala general — la misma semilla
de «Sala v0») y arranca `api` y `web`. Termina imprimiendo:

```
Panel de muestras   http://localhost:3000/panel/muestras
Sala                http://localhost:3000/panel/sala
Contador de tareas  http://localhost:3000/panel/contador
Prototipo           http://localhost:3000/prototipo
Temporal UI         http://localhost:8080
Langfuse            http://localhost:3001
Mailpit             http://localhost:8025
```

La primera vez tarda varios minutos (Docker descarga las imágenes). Las
siguientes, con las imágenes ya en caché, unos treinta segundos a un minuto.

## Otros comandos

| Comando                           | Qué hace                                                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm local:parar`                | Para `api`, `web`, el worker de la demo y el Compose. Conserva los datos.                                                                                                        |
| `pnpm local:parar -- --volumenes` | Igual, y además borra los volúmenes (PostgreSQL, Silo, Redis, ClickHouse).                                                                                                       |
| `pnpm local:actualizar`           | Trae `main`, reinstala dependencias y migra. Se niega si no estás en `main` o si tienes cambios sin confirmar. No reinicia los procesos: hazlo con `parar` y `arrancar` después. |
| `pnpm local:a-cero`               | Pide confirmación, para todo y borra volúmenes y el estado de `.aiw-local/`. `.env` se conserva.                                                                                 |
| `pnpm local:a-cero -- --si`       | Igual, sin preguntar (para scripts).                                                                                                                                             |
| `pnpm local:copia`                | Vuelca PostgreSQL a `.aiw-local/copias/<fecha>.dump`.                                                                                                                            |
| `pnpm local:copia -- mi-copia`    | Igual, con el nombre que le des.                                                                                                                                                 |
| `pnpm local:restaurar`            | Restaura la copia más reciente de `.aiw-local/copias/` (pide confirmación).                                                                                                      |
| `pnpm local:restaurar -- <ruta>`  | Restaura esa copia concreta.                                                                                                                                                     |

## Puertos que ocupa

| Puerto    | Servicio                 |
| --------- | ------------------------ |
| 3000      | `web` (`AIW_WEB_PUERTO`) |
| 3002      | `api` (`AIW_API_PUERTO`) |
| 5432      | PostgreSQL               |
| 7233      | Temporal                 |
| 8080      | Temporal UI              |
| 8000      | Centrifugo               |
| 9000/9001 | Silo (API/consola S3)    |
| 1025/8025 | Mailpit (SMTP/interfaz)  |
| 3001      | Langfuse                 |

Si alguno está ocupado por otra cosa en tu máquina, cambia la variable
correspondiente en `.env` (por ejemplo `POSTGRES_PORT=5433`) antes de volver a
arrancar; `pnpm local:arrancar` la respeta. Para `web` y `api` también puedes
fijar la variable como una del entorno del propio proceso (no solo en `.env`):
así arranca el job de la CI en el ejecutor autoalojado compartido, donde el
3000 y el 3001 ya los ocupan servicios de producción del mismo VPS.

## Registros

`.aiw-local/registros/{api,web,worker-sala}.log`. Con todo arrancado y algo
que no responde, mira ahí primero; para lo que pasa dentro del Compose,
`docker compose --env-file .env -f deploy/compose/docker-compose.dev.yml logs <servicio>`.

## Proveedor de modelos

Por defecto, sin ninguna clave en `.env`, todo corre con el proveedor de
prueba determinista (`packages/models/src/proveedor-prueba.ts`): el mismo
que usa la CI, sin coste y sin red. Es la razón de que `pnpm local:arrancar`
no pida ninguna credencial.

Para probar contra Bedrock UE con las credenciales de `aiw-dev` (solo tuyas,
nunca las compartas ni las subas a ningún sitio): añade a tu `.env`

```
AIW_BEDROCK_REGION_UE=eu-north-1
AWS_ACCESS_KEY_ID=<la tuya>
AWS_SECRET_ACCESS_KEY=<la tuya>
```

y repite `pnpm local:arrancar` (o solo reinicia `api`/`worker` si ya estaban
arriba). Detalle completo, incluida la matriz de modelos provisional mientras
AWS no conceda acceso a Sonnet 5 y Opus 5:
[`modelos-funciones-ausentes.md`](modelos-funciones-ausentes.md).

## Problemas comunes

- **«El demonio de Docker no responde»**: arranca Docker Desktop (macOS) o
  `sudo systemctl start docker` (Linux) y repite.
- **«Puertos ocupados»**: `pnpm local:arrancar` los comprueba todos antes de
  tocar Docker y te dice exactamente cuáles y con qué variable de `.env`
  cambiarlos (por ejemplo `POSTGRES_PORT`), en vez del error crudo de Docker a
  medio arrancar. La causa más común no es un arranque anterior sin parar
  bien (`pnpm local:parar` lo resuelve) sino otro proyecto tuyo que ya usa ese
  puerto — otro Compose en 5432, un Java en 8080, un Node en 3001. Cambia la
  variable correspondiente en `.env` (ver «Puertos que ocupa» arriba) y
  repite; no hace falta parar el otro proyecto.
- **La demo de sala no arranca (se agota el plazo)**: mira
  `.aiw-local/registros/worker-sala.log`. La causa más común es que la
  migración no ha terminado o que `DEMO_CONECTOR_SECRETO` falta en `.env`
  (bórralo y deja que `pnpm local:arrancar` lo regenere).
- **`/panel/sala` o `/panel/contador` dan 404**: sus banderas
  (`AIW_SALA_V0`, `AIW_PANEL_CONTADOR`) solo están encendidas en los procesos
  que arranca `local:arrancar`, no en `.env`. Si arrancaste `api` o `web` a
  mano con `pnpm --filter @aiw/api dev`, no las tendrán; usa
  `pnpm local:arrancar`.
- **`git pull --ff-only` falla en `local:actualizar`**: tu `main` local ha
  divergido de `origin/main` (algún commit propio sin subir). Resuélvelo a
  mano: `git log origin/main..main` para ver qué tienes de más.
- **Falta memoria o el arranque va muy lento**: sube los recursos de Docker
  Desktop (macOS) o cierra otras aplicaciones; el aviso de `pnpm
local:arrancar` te dice cuánta memoria tienes libre. Si tu máquina ya corre
  otros proyectos en Docker, cada uno se queda con su parte: en una prueba
  real con 29,7 GB totales y otros tres proyectos arriba, este entorno dejó
  solo 2,7 GB libres (Langfuse con ClickHouse y Redis es lo que más pesa,
  ~2,4 GB). Para esos otros contenedores mientras trabajas aquí si vas justo
  (`docker ps` para verlos, `docker stop <contenedor>`); no hace falta
  borrarlos, solo pararlos.
- **`pnpm install` avisa de que ignora los scripts de compilación de
  `@swc/core` o `protobufjs`**: son dependencias transitivas y el arranque
  funciona igual sin ejecutar su `postinstall`. Si quieres que corran de
  verdad, decide tú con `pnpm approve-builds` — no lo automatices sin mirar
  qué hace cada script: son código de terceros que pnpm bloquea por
  seguridad, no una bandera de configuración de esta rebanada.

## Dejar la máquina como estaba

```bash
pnpm local:a-cero          # para todo, borra volúmenes y .aiw-local/
```

Esto no borra `node_modules/`, `.env` ni el propio repositorio. Para quitar
también `.env` (y que la próxima `pnpm local:arrancar` genere secretos
nuevos): `rm .env`. Para quitar el repositorio entero: bórralo como
cualquier carpeta, después de `pnpm local:a-cero`.
