VIGENTE

# Runbook · Ejecutores auto-hospedados de GitHub Actions

Cómo montar, vigilar, actualizar y retirar los ejecutores auto-hospedados que sustituyen a `ubuntu-24.04` en la CI ([especificación](../specs/ejecutores-auto-hospedados.md); decisión de Jesús del 28-9-2026: GitHub Actions ya había costado 36 € en este repositorio privado). Jesús ejecuta todos los comandos en sus máquinas; el Operador no tiene acceso a ellas y nunca ve el token de registro.

## Reglas de este host

El VPS aloja producción con tráfico real: Nginx Proxy Manager (`bitclick-proxy`, puertos 80/81/443), Odoo, `bitclick-web`, `bitclick-panel`, `panelig-*`, n8n, la pila de Langfuse y los contenedores del prototipo IAGENT-COMPANY. Todos corren sobre el Docker del sistema (`docker.io` 29.1.3 de Ubuntu). El incidente del 28-9-2026 (sección final) sale de saltarse la primera regla.

1. **No instales ni quites paquetes de Docker en el sistema, ni añadas el repositorio APT de Docker.** `docker-ce-cli` choca con `docker.io` y apt desinstala el demonio de producción para resolverlo. El Docker del ejecutor vive entero en `/home/aiw-runner`.
2. **Simula cualquier `apt-get install` con `-s` antes de ejecutarlo.** Solo se ejecuta de verdad si la simulación no tiene ninguna línea `Remv` y no actualiza (`Inst paquete [versión anterior] ...`) `docker.io`, `containerd`, `runc`, `libc6`, `systemd` ni `libssl3`. Si aparece alguna, para y revísalo.
3. **Ejecuta apt con `NEEDRESTART_SUSPEND=1`** para que `needrestart` no reinicie servicios del host (containerd, Docker) por su cuenta.
4. **`aiw-runner` no entra nunca en el grupo `docker`.** Así no puede hablar con el demonio de producción ni por error: si su `DOCKER_HOST` apuntara mal, obtendría `permission denied` en `/var/run/docker.sock`.
5. **Un paso cada vez, con comprobación.** Cada paso termina con una comprobación de solo lectura. Si no sale lo esperado, para.

## Los dos ejecutores

| Ejecutor  | Máquina                                                    | Disponibilidad                                                     | Etiquetas                      |
| --------- | ---------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------ |
| `vps-aiw` | VPS Ubuntu 24.04 de Bitclick (8 vCPU, 16 GiB, 480 GB NVMe) | Permanente, como servicio de `systemd` con el usuario `aiw-runner` | `self-hosted, linux, x64, aiw` |
| `wsl-aiw` | WSL2 en el portátil Windows 11 de Jesús                    | Opcional: solo cuando él lo arranca a mano                         | `self-hosted, linux, x64, aiw` |

GitHub reparte los jobs entre los ejecutores libres con esas etiquetas. Con el portátil apagado, todo va a `vps-aiw`. Los dos son Linux porque los jobs con `services:` (PostgreSQL de `base-de-datos`, `flujos-durables` y `base-de-datos-carga`) solo funcionan en ejecutores Linux, y `secretos`, `compose` e `imagenes` llaman a `docker` directamente.

El ejecutor es de repositorio (`bitclick-solution/AI-Workforce`), no de organización.

## Aislamiento y recursos

- **Usuario `aiw-runner`**: sin `sudo`, sin grupo `docker` y con shell `/usr/sbin/nologin`, que impide el login interactivo pero no que el servicio ejecute procesos con este usuario.
- **Docker rootless con binarios estáticos en `~/bin`**: un demonio propio del usuario, con su socket (`/run/user/<UID>/docker.sock`), sus datos (`~/.local/share/docker`) y su red. No toca las reglas `iptables` del host ni el Docker de producción. Sus puertos publicados son procesos normales del host, así que `ufw` los filtra: el PostgreSQL de la CI (`5432`, sin contraseña) queda cerrado al exterior.
- **Límites de `systemd` en dos sitios**, porque los contenedores del Docker rootless no cuelgan del servicio del ejecutor sino de la _slice_ del usuario:
  - Servicio del ejecutor (Node, pnpm, compilación, Chromium): `MemoryMax=4G`, `CPUQuota=300%`.
  - `user-<UID>.slice` (Docker rootless y sus contenedores): `MemoryMax=6G`, `CPUQuota=400%`.
  - En los dos: `MemorySwapMax=0`, `CPUWeight=20` e `IOWeight=20`. Con carga, producción tiene prioridad, y la CI nunca pasa de 10 GiB entre las dos partes.
- **Un solo ejecutor en el VPS**: los jobs corren de uno en uno. La CI completa tarda más, pero nunca compite consigo misma.
- **Puertos que usa la CI en el host**: 5432 (PostgreSQL de servicio y del Compose), 7233, 8080, 8000, 9000, 9001, 1025, 8025 y 13001 (Compose de desarrollo, en `127.0.0.1`) y 3100 (Playwright). Ningún servicio de producción debe usar esos puertos: si alguno se reiniciara mientras la CI ocupa su puerto, no podría arrancar. Langfuse va en 13001 y no en su 3001 por defecto porque en el VPS el 3001 lo ocupa un `next-server` del host (`LANGFUSE_PORT` en el job `compose` de `ci.yml`).
- **Limpieza**: `actions/checkout` limpia el repositorio en cada job, y una tarea `cron` de `aiw-runner` purga cada noche las imágenes, contenedores y volúmenes del Docker rootless (nunca del de producción: regla 4).
- **Riesgo aceptado**: el ejecutor corre código de las ramas del propio equipo (agentes y Jesús) en un repositorio privado sin PR externos. El riesgo real es una dependencia de npm o una acción de terceros comprometida. Contra eso protegen el usuario sin privilegios, el Docker rootless y los límites. No hace falta una máquina virtual aparte.

## VPS · instalación

### Paso 0 · Comprobaciones previas (solo lectura)

```bash
id aiw-runner; groups aiw-runner
grep aiw-runner /etc/subuid /etc/subgid
loginctl show-user aiw-runner -p Linger
sysctl kernel.apparmor_restrict_unprivileged_userns
sudo ufw status verbose | head -4
sudo ss -tlnp | grep -E ':(5432|7233|8080|8000|9000|9001|1025|8025|13001|3100)\b' || echo "puertos de la CI libres"
command -v jq gh git curl tar || true
dpkg -l | grep -E '^ii\s+(uidmap|dbus-user-session|slirp4netns|libicu[0-9]+)\s' | awk '{print $2, $3}'
docker --version; systemctl is-enabled docker containerd apache2
```

Resultado esperado:

- `aiw-runner` existe, no está en `docker` y tiene rangos en `/etc/subuid` y `/etc/subgid`.
- `Linger=yes`.
- `ufw` activo con `Default: deny (incoming)`.
- Los puertos de la CI están libres.
- `docker.io` sigue en 29.1.3 y `apache2` está `disabled`.

Si `aiw-runner` no existe, créalo (no toca paquetes):

```bash
sudo useradd --create-home --shell /usr/sbin/nologin aiw-runner
sudo loginctl enable-linger aiw-runner
```

Anota `id -u aiw-runner`: es el `<UID>` de todo lo que sigue.

### Paso 1 · Paquetes del sistema, simulados primero

Un solo lote: `jq` y `gh` (los usa el Revisor), `slirp4netns` (la red del Docker rootless), `libicu74` (la necesita el propio ejecutor, que está hecho en .NET) y las librerías y fuentes de Chromium para Playwright 1.63 en Ubuntu 24.04. Todos salen de los repositorios de Ubuntu; ninguno es de Docker.

```bash
PAQUETES="jq gh slirp4netns libicu74 \
  libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 libcairo2 libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
  xvfb fonts-noto-color-emoji fonts-unifont libfontconfig1 libfreetype6 xfonts-cyrillic xfonts-scalable fonts-liberation fonts-ipafont-gothic fonts-wqy-zenhei fonts-tlwg-loma-otf fonts-freefont-ttf"

sudo apt-get update
sudo apt-get install -s --no-install-recommends $PAQUETES | grep -E '^(Inst|Remv)' > /tmp/aiw-apt-simulacion.txt
grep -c '^Remv' /tmp/aiw-apt-simulacion.txt
grep -E '^Inst (docker|containerd|runc|libc6|systemd|libssl3)[ :]' /tmp/aiw-apt-simulacion.txt || echo "nada crítico"
grep -E '^Inst \S+ \[' /tmp/aiw-apt-simulacion.txt || echo "sin actualizaciones de paquetes existentes"
```

Solo si el recuento de `Remv` es `0` y las dos últimas órdenes dicen "nada crítico" y "sin actualizaciones de paquetes existentes", instala de verdad:

```bash
sudo NEEDRESTART_SUSPEND=1 DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $PAQUETES
sudo docker ps --format '{{.Names}} {{.Status}}' | grep -vc ' Up ' || true
```

La última orden cuenta los contenedores de producción que no están `Up`: debe dar `0`.

### Paso 2 · Docker rootless en `/home/aiw-runner`

**2.1.** Perfil de AppArmor para `rootlesskit`. Ubuntu 24.04 restringe los espacios de nombres de usuario sin privilegios, y este perfil solo afecta a ese binario de esa ruta. Se carga él solo con `apparmor_parser -r`, sin reiniciar el servicio `apparmor`:

```bash
sudo tee /etc/apparmor.d/home.aiw-runner.bin.rootlesskit > /dev/null <<'EOF'
abi <abi/4.0>,
include <tunables/global>

"/home/aiw-runner/bin/rootlesskit" flags=(unconfined) {
  userns,
  include if exists <local/home.aiw-runner.bin.rootlesskit>
}
EOF
sudo apparmor_parser -r /etc/apparmor.d/home.aiw-runner.bin.rootlesskit
```

**2.2.** Binarios estáticos de Docker 29.1.3 (la misma versión que el `docker.io` del host) en `~/bin` de `aiw-runner`. No toca ningún paquete del sistema:

```bash
sudo -u aiw-runner bash -c '
  set -e
  mkdir -p ~/bin && cd /tmp
  curl -fsSLO https://download.docker.com/linux/static/stable/x86_64/docker-29.1.3.tgz
  curl -fsSLO https://download.docker.com/linux/static/stable/x86_64/docker-rootless-extras-29.1.3.tgz
  tar xzf docker-29.1.3.tgz --strip-components=1 -C ~/bin
  tar xzf docker-rootless-extras-29.1.3.tgz --strip-components=1 -C ~/bin
  rm docker-29.1.3.tgz docker-rootless-extras-29.1.3.tgz
  ls ~/bin
'
```

Si alguna descarga da 404, para: se elige otra versión mirando `https://download.docker.com/linux/static/stable/x86_64/`.

**2.3.** Instala el demonio rootless como servicio de usuario (sustituye `<UID>`):

```bash
sudo -u aiw-runner env XDG_RUNTIME_DIR=/run/user/<UID> \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/<UID>/bus \
  PATH=/home/aiw-runner/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  /home/aiw-runner/bin/dockerd-rootless-setuptool.sh install
```

Si aborta diciendo que Docker con root está activo, para y pega el mensaje. No uses `--force` sin revisarlo.

**2.4.** Comprueba los dos Docker por separado:

```bash
sudo -u aiw-runner env DOCKER_HOST=unix:///run/user/<UID>/docker.sock /home/aiw-runner/bin/docker info --format 'rootless: {{.SecurityOptions}}'
sudo -u aiw-runner docker ps 2>&1 | head -1
sudo docker ps --format '{{.Names}} {{.Status}}' | grep -vc ' Up ' || true
```

Resultado esperado:

- La primera orden muestra `name=rootless`.
- La segunda da `permission denied` (regla 4: `aiw-runner` no llega al Docker de producción).
- La tercera da `0`.

### Paso 3 · Registrar el ejecutor

En GitHub: **Settings → Actions → Runners → New self-hosted runner**, Linux, x64. De esa página copia solo las líneas `curl` y `tar` de descarga y ejecútalas como `aiw-runner`:

```bash
sudo -u aiw-runner bash -c '
  mkdir -p ~/actions-runner && cd ~/actions-runner
  # las dos líneas curl y tar de la página de GitHub
'
```

Configura con las etiquetas propias. **Escribe el token solo en tu terminal: nunca en el chat ni en un archivo del repositorio.**

```bash
sudo -u aiw-runner bash -c '
  cd ~/actions-runner
  ./config.sh --url https://github.com/bitclick-solution/AI-Workforce \
    --token <TOKEN> --name vps-aiw --labels self-hosted,linux,x64,aiw \
    --work _work --unattended
'
```

Si `config.sh` pide ejecutar `installdependencies.sh`, **no lo ejecutes**: ese script llama a apt sin simular. Para y pega el mensaje.

Entorno de los jobs: `.env` y `.path` son los archivos que el ejecutor lee al arrancar.

```bash
sudo -u aiw-runner bash -c '
  cd ~/actions-runner
  echo "DOCKER_HOST=unix:///run/user/<UID>/docker.sock" >> .env
  echo "/home/aiw-runner/bin:$(cat .path)" > .path
  cat .env .path
'
```

### Paso 4 · Servicio y límites

```bash
cd /home/aiw-runner/actions-runner
sudo ./svc.sh install aiw-runner
SERVICIO=actions.runner.bitclick-solution-AI-Workforce.vps-aiw.service
sudo mkdir -p /etc/systemd/system/$SERVICIO.d
sudo tee /etc/systemd/system/$SERVICIO.d/limites.conf > /dev/null <<'EOF'
[Service]
MemoryMax=4G
MemorySwapMax=0
CPUQuota=300%
CPUWeight=20
IOWeight=20
EOF
sudo systemctl set-property user-<UID>.slice MemoryMax=6G MemorySwapMax=0 CPUQuota=400% CPUWeight=20 IOWeight=20
sudo systemctl daemon-reload
sudo ./svc.sh start
systemctl show $SERVICIO -p MemoryMax -p CPUQuotaPerSecUSec -p ActiveState
systemctl show user-<UID>.slice -p MemoryMax -p CPUQuotaPerSecUSec
```

Resultado esperado: el servicio aparece `active`, y en **Settings → Actions → Runners** el ejecutor `vps-aiw` sale como `Idle`.

### Paso 5 · Purga nocturna del Docker rootless

```bash
echo '17 4 * * * DOCKER_HOST=unix:///run/user/<UID>/docker.sock /home/aiw-runner/bin/docker system prune -af --filter until=48h >/dev/null 2>&1' | sudo -u aiw-runner crontab -
sudo -u aiw-runner crontab -l
```

Sin `--volumes`, porque Docker no admite combinarlo con el filtro `until`. Los contenedores de servicio de la CI se eliminan con sus volúmenes al terminar cada job.

### Paso 6 · Activar

En **Settings → Secrets and variables → Actions → Variables**, crea `AIW_RUNS_ON` con este valor:

```json
["self-hosted", "linux", "x64", "aiw"]
```

Solo lo leen los workflows que ya incluyen el cambio de esta rebanada: primero el PR de la rebanada y, cuando se fusione, `main` y todo PR nuevo.

## Portátil de Jesús · ejecutor opcional en WSL2

No lo montes hasta que `vps-aiw` haya pasado la CI completa en verde. Tampoco hace falta para desbloquear nada.

- Usa una distro de WSL2 aparte solo para la CI (Ubuntu 24.04) y **desactiva para ella la integración WSL de Docker Desktop** (Docker Desktop → Settings → Resources → WSL integration). Si no, Docker Desktop mete su propio `docker` en la distro y se repite el conflicto de la regla 1.
- Dentro de la distro, sigue los pasos 1 a 3 del VPS con tu usuario de la distro en lugar de `aiw-runner`, cambiando las rutas `/home/aiw-runner` por tu `$HOME`. El nombre del ejecutor es `wsl-aiw`. No hace falta `svc.sh`.
- Arráncalo solo cuando quieras prestar el portátil: `cd ~/actions-runner && ./run.sh`. Con `Ctrl+C` se para, y GitHub deja de mandarle jobs.
- Antes de arrancarlo, mira la memoria libre. Si un job se queda sin memoria, GitHub lo repite en `vps-aiw`.

## Vuelta a los ejecutores de GitHub

Borra la variable `AIW_RUNS_ON` o ponle el valor `["ubuntu-24.04"]`. La siguiente ejecución vuelve a los ejecutores de GitHub sin tocar ningún workflow. Hazlo antes de investigar cualquier fallo raro del ejecutor.

## Vigilancia y actualización

- Disco: revisa `df -h /home` cada semana. Si `~aiw-runner/actions-runner/_work` crece mucho, para el servicio y vacía `_work/*`.
- Memoria: `systemctl status user-<UID>.slice` y el servicio del ejecutor muestran el consumo contra su límite. Un job que muere por OOM dentro de su límite no afecta a producción.
- El ejecutor se actualiza solo. El Docker rootless, a mano: repite el paso 2.2 con la versión nueva y ejecuta `systemctl --user restart docker` como `aiw-runner`, con el servicio del ejecutor parado.

## Retirada

1. Pon `AIW_RUNS_ON` a `["ubuntu-24.04"]` antes de retirar el último ejecutor.
2. `sudo ./svc.sh stop && sudo ./svc.sh uninstall` desde `/home/aiw-runner/actions-runner`, y elimina el ejecutor en **Settings → Actions → Runners**.
3. Como `aiw-runner`, ejecuta `dockerd-rootless-setuptool.sh uninstall`. Después, `sudo loginctl disable-linger aiw-runner`, `sudo userdel -r aiw-runner` y `sudo rm /etc/apparmor.d/home.aiw-runner.bin.rootlesskit`.

## Federación OIDC con AWS

El job **Bedrock UE · integración** asume `aiw-ci-bedrock` por OIDC ([runbook](bedrock-iam-oidc.md)). La confianza del rol depende del `sub` del repositorio y de `refs/heads/main`, no del tipo de ejecutor: GitHub emite el mismo token para un ejecutor propio, así que funciona sin cambios. El VPS solo necesita salida a `token.actions.githubusercontent.com` y a `sts.amazonaws.com`.

## Incidente del 28-9-2026 · producción caída unos 15 minutos

- **Causa**: la primera versión de este runbook mandaba añadir el repositorio APT de Docker e instalar `docker-ce-cli` y `docker-ce-rootless-extras`. Para resolver el conflicto, apt desinstaló `docker.io` (el demonio de producción) a las 15:16 UTC y todos los contenedores se pararon. Además, `docker-compose-plugin` no llegó a instalarse porque chocaba con el `docker-compose-v2` de Ubuntu.
- **Efecto**: se cayeron todas las webs, el ERP y NPM. Al volver `dockerd`, aparecieron dos fallos más:
  - `apache2`, habilitado en el host, se quedó con el puerto 80.
  - `bitclick-proxy` se restauró sin red (`Networks={}`) y no resolvía `npm-db` ni `odoo-web`.
- **Acción**:
  1. Se quitó el repositorio de Docker y sus paquetes, y se reinstaló `docker.io=29.1.3-0ubuntu3~24.04.2`.
  2. `daemon-reload` y `reset-failed` de `docker.socket`.
  3. Se paró y deshabilitó `apache2`.
  4. `docker compose up -d --force-recreate` en `/opt/bitclick/proxy`, con los datos en montajes `bind` intactos.

  Todo respondía de nuevo a las 15:31 UTC.

- **Prevención**: las cinco reglas del principio de este runbook y el paso 0 de comprobaciones.
