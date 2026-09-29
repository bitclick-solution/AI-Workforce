REGISTRO HISTÓRICO

# Runbook · Ejecutores auto-hospedados de GitHub Actions (retirados)

Entre el 28 y el 29 de septiembre de 2026, la CI de este repositorio corrió en ejecutores propios en lugar de en los de GitHub, para dejar de pagar minutos de Actions. El 29-9-2026, Jesús decidió **retirarlos** porque eran lentos, consumían muchos recursos y le impedían trabajar. Desde entonces la CI vuelve a los ejecutores de GitHub (`ubuntu-24.04`). Este documento guarda qué se montó, por qué se retiró y qué se aprendió, por si alguna vez se vuelve a plantear.

Especificaciones: [ejecutores auto-hospedados](../specs/ejecutores-auto-hospedados.md) y [ejecutor dedicado al Revisor](../specs/ejecutor-revisor.md), ambas también como registro histórico.

## Qué se montó

| Ejecutor          | Dónde                                   | Para qué                                                              |
| ----------------- | --------------------------------------- | --------------------------------------------------------------------- |
| `vps-aiw`         | VPS de Bitclick, como servicio          | Todos los jobs de `ci.yml` (etiquetas `self-hosted, linux, x64, aiw`) |
| `vps-aiw-revisor` | El mismo VPS, como servicio, sin Docker | Solo `revisor.yml` (etiquetas `self-hosted, linux, x64, aiw-revisor`) |
| `wsl-aiw`         | WSL2 en el portátil de Jesús, a mano    | Capacidad extra para la CI cuando el portátil estaba encendido        |

Cada ejecutor corría con un usuario sin privilegios propio, Docker rootless con binarios estáticos en su directorio personal y límites de memoria y CPU de `systemd` para no competir con los servicios del host.

## Por qué se retiró

- **Lentitud.** Con un solo ejecutor de CI, los jobs corrían de uno en uno. Una CI completa tardaba unos 22 minutos, y con varios PR a la vez pasaba de una hora: GitHub reparte los jobs intercalando ejecuciones, así que todas avanzaban a trozos.
- **Consumo.** Las imágenes, el Compose de desarrollo y Playwright ocupaban CPU y memoria de máquinas que tienen otro trabajo. En el portátil, además, subir la caché de pnpm a GitHub podía tardar 18 minutos por job.
- **Mantenimiento.** Cada fallo del ejecutor (PATH, puertos, dependencias del sistema) bloqueaba PR que no tenían nada que ver.

## Estado tras la retirada

- Los tres ejecutores están eliminados en **Settings → Actions → Runners**, y en las máquinas no queda ningún servicio, usuario, Docker rootless, límite de `systemd` ni perfil de AppArmor suyo. Los paquetes del sistema que se instalaron (`jq`, `gh` y las librerías de Chromium, entre otros) se dejaron a propósito: no molestan, y desinstalar con apt en un host con producción es arriesgado.
- Las variables `AIW_RUNS_ON` y `AIW_RUNS_ON_REVISOR` están borradas. `ci.yml`, `revisor.yml` y `rutinas-nocturnas.yml` las siguen leyendo, pero sin ellas usan `ubuntu-24.04`, así que no hubo que tocar los workflows.
- Sin `AIW_RUNS_ON_REVISOR`, el Revisor no espera a la CI (el paso «Esperar a la CI de este commit» se salta). En los ejecutores de GitHub la CI corre en paralelo y suele terminar antes que el Revisor.
- Se quedan en `ci.yml` los cambios que también ahorran minutos en GitHub: Playwright e imágenes solo cuando el PR toca sus rutas, y las cinco `Imagen <app>` publicadas siempre para no bloquear la protección de `main`.

## Lecciones

1. **No instales paquetes de Docker de otro origen en un host con producción.** Añadir el repositorio APT de Docker e instalar `docker-ce-cli` hizo que apt desinstalara el `docker.io` en el que corría producción, y todo se cayó unos quince minutos (28-9-2026). Al restaurar aparecieron dos fallos más: un servidor web del host se quedó el puerto 80, y el proxy volvió sin red. La recuperación consistió en reinstalar la misma versión de `docker.io`, liberar el puerto y recrear el proxy desde su Compose, con los datos intactos en montajes `bind`.
2. **Simula siempre `apt-get install -s` y suspende `needrestart`** antes de instalar nada en un host compartido. Solo se instala si la simulación no tiene ninguna línea `Remv` ni actualiza paquetes del sistema críticos.
3. **Un usuario del ejecutor fuera del grupo `docker`** no puede tocar el Docker de producción ni por error. Compruébalo contra el socket del sistema, no con el contexto de la CLI por defecto: el instalador rootless cambia ese contexto y la prueba engaña.
4. **Los contenedores del Docker rootless no cuelgan del servicio del ejecutor**, sino de la _slice_ del usuario. Hay que limitar las dos.
5. **Un job de matriz saltado con `if` a nivel de job publica un solo check sin expandir.** Para que cuente como superado en la protección de rama, la condición va en los pasos.
6. **Con un solo ejecutor, el Revisor y la CI compiten.** El Revisor revisaba con la CI a medias. Se resolvió con un ejecutor aparte para el Revisor que esperaba a la CI de su commit.
7. **El archivo `.path` del ejecutor solo se aplica cuando corre como servicio** (`runsvc.sh`). Con `./run.sh` a mano, el PATH es el de la terminal, y los jobs no encontraban el `docker` rootless. Se arranca con `PATH="$(cat .path)" ./run.sh`.
8. **`playwright install --with-deps` llama a `sudo apt-get`.** En un ejecutor propio las dependencias se instalan una vez, a mano y simuladas.

## Si algún día se reactiva

Parte de esta base: los workflows siguen preparados.

1. Monta el ejecutor en una máquina **dedicada a la CI**, no en un host con servicios de producción ni en un equipo de trabajo. Así desaparecen casi todos los problemas de arriba.
2. Crea `AIW_RUNS_ON` con el JSON de sus etiquetas y, si quieres el Revisor aparte, `AIW_RUNS_ON_REVISOR`.
3. Para volver a GitHub, borra esas variables.

El procedimiento detallado de la instalación de septiembre de 2026 está en el historial de git de este archivo. No lo sigas tal cual en otro host sin revisar antes las lecciones.
