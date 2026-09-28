VIGENTE

# Runbook · Ejecutores auto-hospedados de GitHub Actions

Cómo montar, actualizar, vigilar y retirar los ejecutores auto-hospedados que sustituyen a `ubuntu-24.04` en la CI, para dejar de pagar minutos de GitHub Actions ([especificación](../specs/ejecutores-auto-hospedados.md), decisión de Jesús del 28-9-2026: GitHub Actions ya había costado 36 € en este repositorio privado). Jesús ejecuta todos los comandos de este runbook en sus máquinas; el Operador nunca tiene acceso a ellas ni ve el token de registro.

## Los dos ejecutores

| Ejecutor | Máquina | Disponibilidad | Etiquetas | Usuario |
| --- | --- | --- | --- | --- |
| `vps-aiw` | VPS Ubuntu 24.04.2 de Bitclick (8 vCPU, 16 GiB RAM, 480 GB NVMe) | Permanente, como servicio | `self-hosted, linux, x64, aiw` | `aiw-runner`, sin privilegios |
| `wsl-aiw` | WSL2 (Ubuntu) en el portátil Windows 11 de Jesús | Opcional, mientras el portátil esté encendido y él lo arranque a mano | `self-hosted, linux, x64, aiw` | usuario de WSL de Jesús |

Los dos llevan las mismas cuatro etiquetas: GitHub reparte los jobs entre el que esté libre. Cuando el portátil está apagado, todo cae en `vps-aiw`; nunca hace falta tocar los workflows para eso.

**Por qué las dos son Linux y no un ejecutor nativo de Windows**: los jobs `base-de-datos`, `flujos-durables` y `base-de-datos-carga` usan `services:` (contenedor de PostgreSQL), y GitHub solo soporta contenedores de servicio en ejecutores Linux. Un ejecutor nativo de Windows no podría correr esos jobs ni los que llaman a `docker` directamente (`secretos`, `compose`, `imagenes`). Por eso el ejecutor del portátil vive dentro de WSL2, no en Windows directamente.

## Ámbito y alcance

Ejecutor a nivel de **repositorio** (`bitclick-solution/AI-Workforce`), no de organización — decisión de Jesús, más simple de aislar. El VPS aloja además servicios de producción con tráfico real (Odoo, `bitclick-web`, `bitclick-panel`, `panelig-*`, `nginx-proxy-manager` con los puertos 80/443, la pila de Langfuse y los contenedores del prototipo IAGENT-COMPANY): el ejecutor no debe competir por su memoria ni tener forma de tocarlos.

## Aislamiento

1. **Usuario dedicado sin privilegios** (`aiw-runner` en el VPS): sin `sudo`, shell `/usr/sbin/nologin` (bloquea el login interactivo por SSH/`su -`; no afecta a que el servicio del ejecutor ejecute procesos como este usuario).
2. **Docker rootless** (decisión de Jesús, dado que el VPS aloja contenedores de producción de clientes reales): el ejecutor nunca entra en el grupo `docker` del sistema, que equivale a `root` del host. Con Docker rootless, su demonio corre como proceso del propio usuario `aiw-runner`, sin socket compartido con el Docker del sistema ni con los contenedores de producción — un job de CI comprometido no puede alcanzarlos por ahí.
3. **Límites de recursos por `systemd`**: `MemoryMax=8G`, `MemoryHigh=7G`, `CPUQuota=400%` sobre el ejecutor del VPS (la mitad de sus 16 GiB / 8 vCPU), para que ningún job pueda dejar sin memoria a los servicios de producción del mismo host.
4. **Limpieza del espacio de trabajo entre jobs**: `actions/checkout` ya hace `git clean -ffdx` en cada job (opción por defecto). Además, una tarea programada (`cron` del usuario `aiw-runner`) purga imágenes, contenedores y volúmenes de Docker sin usar cada noche, para que un job no herede capas ni volúmenes del anterior.
5. **Riesgo aceptado y explícito**: el ejecutor corre código de las ramas `rebanada/*` que abre el propio equipo (agentes y Jesús), en un repositorio privado de un solo colaborador humano. No hay pull requests externos. El riesgo real es un paquete de npm o una acción de terceros comprometida dentro de esa cadena de confianza, no un atacante externo abriendo PRs — de ahí que rootless sea suficiente y no haga falta además una VM o namespace de red aparte.

## VPS Ubuntu — instalación

Todo esto lo ejecuta Jesús por SSH en el VPS.

### 1. Repositorio de Docker, paquetes y usuario dedicado

Ubuntu no trae `docker-ce-cli` en sus repositorios propios: hace falta añadir el repositorio oficial de Docker primero ([guía oficial](https://docs.docker.com/engine/install/ubuntu/)).

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
```

No instales `docker-ce` (el demonio del sistema): con rootless no hace falta y así el `docker` del host sigue siendo solo el de los contenedores de producción existentes, sin tocar.

```bash
sudo apt-get install -y uidmap dbus-user-session docker-ce-cli docker-ce-rootless-extras

sudo useradd --create-home --shell /usr/sbin/nologin aiw-runner
sudo loginctl enable-linger aiw-runner   # deja correr sus servicios de usuario sin sesión abierta, tras reinicio incluido
id -u aiw-runner                         # anota este número (UID): hace falta en el paso 3
```

### 2. Docker rootless para `aiw-runner`

```bash
sudo machinectl shell aiw-runner@ /bin/bash -c '
  export XDG_RUNTIME_DIR=/run/user/$(id -u)
  dockerd-rootless-setuptool.sh install
'
```

Si `machinectl` no está disponible, usa en su lugar:

```bash
sudo systemctl start "user@$(id -u aiw-runner).service"
sudo -u aiw-runner XDG_RUNTIME_DIR=/run/user/$(id -u aiw-runner) dockerd-rootless-setuptool.sh install
```

Al terminar, comprueba (sustituye `<UID>` por el número del paso 1):

```bash
sudo -u aiw-runner env DOCKER_HOST=unix:///run/user/<UID>/docker.sock docker info
```

Debe responder sin error y sin pedir `sudo`.

### 3. Registrar el ejecutor

En GitHub: **Settings → Actions → Runners → New self-hosted runner**, repositorio `bitclick-solution/AI-Workforce`, Linux x64. Copia de esa página los comandos de descarga (la versión del paquete cambia; usa siempre los que te da esa pantalla, no los de este runbook) y ejecútalos como `aiw-runner`:

```bash
sudo -u aiw-runner bash -c '
  mkdir -p ~/actions-runner && cd ~/actions-runner
  # Pega aquí las dos líneas curl+tar que te dio la página de GitHub
'
```

Configura con las etiquetas propias — **pega el token tú mismo en esta línea, en tu terminal; no lo pegues en el chat ni lo escribas en ningún archivo del repositorio**:

```bash
sudo -u aiw-runner bash -c '
  cd ~/actions-runner
  ./config.sh --url https://github.com/bitclick-solution/AI-Workforce \
    --token <TU_TOKEN_AQUI> \
    --name vps-aiw \
    --labels self-hosted,linux,x64,aiw \
    --work _work \
    --unattended
'
```

### 4. Instalar como servicio con límites de recursos

```bash
cd /home/aiw-runner/actions-runner
sudo ./svc.sh install aiw-runner
sudo ./svc.sh start
sudo ./svc.sh status   # anota el nombre exacto del servicio, algo como
                       # actions.runner.bitclick-solution-AI-Workforce.vps-aiw.service
```

Edita el servicio (sustituye `<UID>` por el del paso 1 y `<SERVICIO>` por el nombre exacto):

```bash
sudo systemctl edit <SERVICIO>
```

Pega entre los comentarios:

```ini
[Service]
Environment=DOCKER_HOST=unix:///run/user/<UID>/docker.sock
Environment=PATH=/home/aiw-runner/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MemoryMax=8G
MemoryHigh=7G
CPUQuota=400%
Nice=5
```

```bash
sudo systemctl daemon-reload
sudo systemctl restart <SERVICIO>
sudo systemctl status <SERVICIO>
```

### 5. Purga nocturna de Docker

```bash
( sudo -u aiw-runner crontab -l 2>/dev/null
  echo "0 4 * * * DOCKER_HOST=unix:///run/user/<UID>/docker.sock docker system prune -af --filter until=48h" \
) | sudo -u aiw-runner crontab -
```

### 6. Activar el ejecutor en los workflows

En GitHub: **Settings → Secrets and variables → Actions → Variables**, crea `AIW_RUNS_ON` con el valor exacto:

```json
["self-hosted","linux","x64","aiw"]
```

Desde ese momento, `ci.yml`, `revisor.yml` y `rutinas-nocturnas.yml` mandan los jobs a `vps-aiw` (y a `wsl-aiw` cuando exista y esté encendido).

## Portátil de Jesús (Windows 11) — ejecutor opcional en WSL2

Solo si Jesús decide sumarlo. No hace falta para desbloquear la CI: el VPS ya es un ejecutor completo por sí solo.

### 1. WSL2 con Ubuntu

Si no lo tienes ya, en PowerShell como administrador:

```powershell
wsl --install -d Ubuntu
```

Reinicia si lo pide y crea el usuario de la distro cuando lo abra.

### 2. Dentro de la distro Ubuntu de WSL2

Los mismos pasos 1 y 2 del VPS (paquetes, `uidmap`, `dbus-user-session`, `docker-ce-cli`, `docker-ce-rootless-extras`), pero **sin usuario dedicado aparte**: usa tu propio usuario de la distro, ya que aquí no hay servicios de producción que aislar de otro usuario, solo del resto de tu portátil (para eso ya está WSL2 como frontera). Salta el `useradd`; el resto es igual:

```bash
sudo apt-get update
sudo apt-get install -y uidmap dbus-user-session docker-ce-cli docker-ce-rootless-extras curl
dockerd-rootless-setuptool.sh install
```

### 3. Registrar y arrancar el ejecutor a mano

Igual que el paso 3 del VPS (nueva página **New self-hosted runner** desde la misma pantalla de GitHub, o reutiliza un token nuevo), pero con nombre distinto y **sin instalarlo como servicio**: como es un ejecutor opcional que solo cuenta mientras el portátil está encendido y tú quieres prestarlo, lo arrancas y paras a mano.

```bash
mkdir -p ~/actions-runner && cd ~/actions-runner
# pega aquí las líneas curl+tar de la página de GitHub
./config.sh --url https://github.com/bitclick-solution/AI-Workforce \
  --token <TU_TOKEN_AQUI> \
  --name wsl-aiw \
  --labels self-hosted,linux,x64,aiw \
  --work _work \
  --unattended
```

Para prestar capacidad cuando te convenga:

```bash
DOCKER_HOST=unix:///run/user/$(id -u)/docker.sock ./run.sh
```

`Ctrl+C` lo para; GitHub deja de mandarle jobs en cuanto se desconecta, sin que haya que tocar nada en el repositorio.

### 4. Memoria

Tu portátil tiene 32 GiB pero ahora mismo solo 1,74 GiB libres: antes de arrancar `run.sh` para un job pesado (Compose, imágenes), cierra lo que puedas o comprueba con `free -h` dentro de la distro. Si el job falla por falta de memoria, GitHub lo reintenta en `vps-aiw` en cuanto ese ejecutor quede libre — no bloquea nada, solo tarda un poco más.

## Vuelta a los ejecutores de GitHub

Si cualquiera de los dos ejecutores falla o hay que investigar algo con calma: en **Settings → Secrets and variables → Actions → Variables**, borra `AIW_RUNS_ON` (o pon su valor a `["ubuntu-24.04"]`). El siguiente PR ya corre en los ejecutores de GitHub, sin tocar ningún workflow. Ese es precisamente el mecanismo, no una excepción.

## Vigilancia de disco y actualización

- Disco: `df -h /` en el VPS de vez en cuando; el NVMe tiene 480 GB, pero las imágenes construidas por el job `imagenes` y la caché de `pnpm` se acumulan. La purga nocturna del paso 5 cubre Docker; si `~/actions-runner/_work` crece mucho, `sudo -u aiw-runner rm -rf ~/actions-runner/_work/*` con el servicio parado.
- Actualización del propio ejecutor: GitHub avisa en la pestaña **Actions → Runners** cuando hay una versión nueva; normalmente se actualiza solo en segundo plano. Si no, para el servicio, repite la descarga del paso 3 sobre el mismo directorio y vuelve a arrancarlo.

## Retirada

1. En GitHub, **Settings → Actions → Runners**, elimina el ejecutor (o `./config.sh remove --token <token de eliminación de esa misma pantalla>` desde su directorio).
2. En el VPS: `sudo ./svc.sh uninstall`, luego `sudo userdel -r aiw-runner`.
3. Pon `AIW_RUNS_ON` a `["ubuntu-24.04"]` (o bórrala) antes de retirar el último ejecutor, para no dejar la CI sin ningún sitio donde correr.

## Federación OIDC con AWS (Bedrock)

El job **Bedrock UE · integración** asume el rol `aiw-ci-bedrock` por OIDC ([runbook](bedrock-iam-oidc.md)). La relación de confianza de ese rol está limitada al `sub` `repo:bitclick-solution@301227888/AI-Workforce@1377453835:ref:refs/heads/main`, no al tipo de ejecutor: GitHub emite el mismo token de identidad OIDC para un job en un ejecutor auto-hospedado que en uno de GitHub, así que sigue funcionando sin cambios siempre que el job corra sobre `main` (cron semanal o `workflow_dispatch` manual). Solo hace falta que el ejecutor tenga salida a `token.actions.githubusercontent.com` y a `sts.amazonaws.com`.
