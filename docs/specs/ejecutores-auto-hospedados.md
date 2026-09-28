VIGENTE

# Especificación · Ejecutores auto-hospedados de GitHub Actions en el VPS Ubuntu y en la máquina de Jesús

- Rebanada: [Notion](https://app.notion.com/p/3e953066189881e7a1a4db3815cdebc1) · Ciclo actual · Tipo Operación · Paquetes `deploy`, `docs`, `.github` · P0
- Rama: `rebanada/ejecutores-auto-hospedados`
- Plan de referencia: [plan v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn), runbooks `docs/runbooks/proteccion-de-rama.md` y `docs/runbooks/bedrock-iam-oidc.md`.
- Zona crítica: sí — toca `.github/`. Marcada "Revisión humana obligatoria" en Notion.

## Objetivo

GitHub Actions ha costado 36 € en este repositorio privado. Jesús decide (28-9-2026) mover la CI a ejecutores auto-hospedados: uno permanente en el VPS Ubuntu de Bitclick y, si conviene, otro en su propia máquina para cuando esté encendida. Los workflows deben poder volver a los ejecutores de GitHub en un minuto cambiando una variable, sin alterar lo que comprueba cada job.

## Paquetes tocados

- `.github/workflows/` (`ci.yml`, `revisor.yml`, `rutinas-nocturnas.yml`): `runs-on` parametrizado y filtros de coste.
- `docs/runbooks/ejecutores-auto-hospedados.md`: instalación, dimensionado, aislamiento, retirada.
- Ningún paquete de producto.

## Endpoints, flujos y datos

No aplica: no hay migración ni esquema. Cambios solo en configuración de CI y en un runbook.

## Criterios de hecho

1. El ejecutor auto-hospedado del VPS Ubuntu está registrado como servicio (`systemd`, `svc.sh install`/`start`), corre con un usuario dedicado sin privilegios, usa etiquetas propias (`self-hosted, linux, x64, aiw`) y limpia el espacio de trabajo entre trabajos (`ActionsRunnerHooks` o `clean` en cada job). Documentado el mismo procedimiento, opcional, para la máquina de Jesús.
2. `ci.yml`, `revisor.yml` y `rutinas-nocturnas.yml` deciden `runs-on` con una variable de repositorio (`AIW_RUNS_ON`, por defecto `ubuntu-24.04`) sin cambiar los pasos ni las comprobaciones de ningún job. Volver a GitHub es cambiar esa variable.
3. Menos minutos de pago: los jobs caros que no aplican (`imagenes`, `e2e`/Playwright, `base-de-datos-carga`) mantienen o mejoran sus condiciones de ruta existentes; la concurrencia que cancela ejecuciones obsoletas sigue activa. Ningún check obligatorio de la protección de `main` se salta sin contar como superado.
4. Seguridad: el ejecutor sirve solo a este repositorio privado (no de organización, salvo que Jesús decida lo contrario tras responder las preguntas de dimensionado); sin secretos en disco del VPS; el token de registro lo obtiene y usa Jesús directamente en su terminal, nunca en el chat ni en el repositorio. Documentado el riesgo de que el grupo `docker` equivale a `root` y cómo aislar el ejecutor del resto de servicios del VPS (usuario propio, sin sudo, red o namespace separado si aplica).
5. La federación OIDC con AWS del job **Bedrock UE · integración** (rol `aiw-ci-bedrock`, ver `docs/runbooks/bedrock-iam-oidc.md`) sigue funcionando desde el ejecutor propio.
6. Runbook `docs/runbooks/ejecutores-auto-hospedados.md` con requisitos de CPU/memoria/disco para los jobs que usan Docker (PostgreSQL de servicio, Compose de desarrollo, Playwright, construcción de imágenes), instalación, actualización, retirada, vigilancia de disco entre ejecuciones y el procedimiento de vuelta a los ejecutores de GitHub.
7. Probado con un PR real: la CI completa corre en el ejecutor propio y en verde, con los minutos de pago de Actions a cero en esa ejecución (o documentado por qué no, si GitHub sigue facturando algo irreducible).

## Casos de prueba y de eval

- Unitario: no aplica (sin código de producto). Prueba manual: `workflow_dispatch` de `ci.yml` sobre la rama y comprobación de que cada check pasa en el ejecutor propio; segunda prueba forzando `AIW_RUNS_ON=ubuntu-24.04` para confirmar la vuelta atrás sin editar el YAML.
- Eval: no aplica — no hay comportamiento de agente nuevo.
- Auditoría y contador: no aplica — cambio de infraestructura de CI, no de la plataforma; se documenta en la rebanada, no en el libro de auditoría de `packages/ledger`.
- Secretos: el job `secretos` (gitleaks) sigue corriendo en el ejecutor propio; verificación manual de que el token de registro del ejecutor no queda en el disco del VPS tras el registro ni en ningún archivo de este repositorio.

## Fuera de alcance

- Ejecutor a nivel de organización de GitHub (si Jesús lo prefiere tras las preguntas de dimensionado, es una rebanada aparte).
- Cualquier cambio en el código de `packages/*` o `apps/*`.
- Migrar el prototipo IAGENT-COMPANY (prohibido por `CLAUDE.md`).
- Endurecimiento general del VPS más allá de aislar el ejecutor (firewall completo, gestor de secretos, etc.), salvo lo mínimo que pide el criterio 4.

## Presupuesto de tokens

Presupuesto: 15 €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

Ninguna todavía: la sesión habla directamente con Jesús para las preguntas de dimensionado (versión de Ubuntu, CPU, memoria, disco libre, Docker instalado, qué más corre en el VPS, ejecutor de repositorio o de organización, y si añade su propia máquina) antes de fijar la configuración exacta del runbook.
