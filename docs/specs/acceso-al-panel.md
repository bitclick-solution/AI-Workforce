VIGENTE

# Especificación · Acceso al panel: inicio de sesión con Better Auth y la organización de la sesión en la RLS

- Rebanada: [Notion](https://app.notion.com/p/3e553066189881e9a248f4fae6ae2e96) · Ciclo, tipo y prioridad: los del tablero (esta sesión no tuvo acceso al MCP de Notion; ver «Pregunta abierta») · Paquetes `apps/api`, `apps/web`, `packages/db` · Presupuesto 40 €
- Rama: `rebanada/acceso-al-panel`
- Plan de referencia: ADR-002 (Better Auth en el stack), ADR-007 (PostgreSQL única fuente de verdad, `tenant_id` y RLS, UUID v7, filas inmutables), ADR-001 (plano de control agnóstico, interfaz de aprobación genérica) y las fronteras de `CLAUDE.md` (libro con un único punto de escritura, credenciales fuera del contexto).
- Zona crítica: sí: identidad y permisos, migración de datos (`0005_acceso_al_panel.sql`), RLS y libro de auditoría (se escribe con `anotar`; `packages/ledger` no cambia). «Revisión humana obligatoria» en la rebanada.

## Objetivo

Hoy el servidor de Next lee el tenant y la persona de `AIW_SALA_TENANT`, `AIW_SALA_PERSONA` y `AIW_PANEL_TENANT` y la API se fía de las cabeceras `x-aiw-tenant` y `x-aiw-persona`. Cuando esta rebanada está hecha, la persona propietaria entra al panel con un enlace por correo o con una passkey, la API valida la sesión en el servidor y fija `aiw.tenant_id` de la RLS a partir de ella, y ninguna cabecera ni parámetro del cliente decide el tenant. Solo entra quien Bitclick ha invitado.

## Paquetes tocados

- `packages/db`: `src/identidad.ts` (tablas `usuario`, `sesion`, `cuenta`, `verificacion`, `clave_acceso`), registro en `tablas.ts`, purga en `mantenimiento.ts`, migración `drizzle/0005_acceso_al_panel.sql` y su reverso, y pruebas de aislamiento con dos organizaciones.
- `apps/api`: `src/identidad/` (configuración, Better Auth, correo, resolución de sesión, anotaciones del libro, invitación) y `src/rutas/acceso.ts`; `rutas/sala.ts` y `rutas/contador.ts` toman tenant y persona de la sesión; comando `invitar-propietario`.
- `apps/web`: `app/api/auth/[...ruta]` (reenvío a la API), `app/acceso` (entrar), `app/panel/cuenta` (passkey y cierre), `app/panel/layout.tsx` (sin sesión, a `/acceso`), y los proxies de sala y contador reenvían la cookie de sesión en vez de un tenant de entorno.

## Endpoints, flujos y datos

- **Tablas nuevas.** `usuario` (identidad global, correo único, enlazada a una `persona` y su `tenant_id`), `sesion` (con `tenant_id` y `persona_id` copiados de `usuario` por un disparador: la aplicación no puede elegirlos), `cuenta` (exigida por Better Auth; sin contraseña por `check`), `verificacion` (enlaces y retos de WebAuthn, identificador con hash) y `clave_acceso` (passkeys). UUID v7 en todas.
- **Rol nuevo `aiw_identidad`.** Solo él lee y escribe esas tablas (política `…_identidad`), porque el acceso ocurre antes de conocer el tenant. `aiw_app` no tiene ningún permiso sobre ellas: una consulta de negocio no puede leer un token de sesión ni de su propio tenant. `usuario` y `sesion` llevan además la política estándar por tenant, que es la que usa la purga.
- **API.** `/api/auth/*` es Better Auth (enlace por correo, passkey, `get-session`, `sign-out`) detrás de `AIW_ACCESO_PANEL`. `/sala/*` y `/contador/*` exigen sesión válida y leen con `conTenant(tenantDeLaSesion)`; las cabeceras `x-aiw-tenant` y `x-aiw-persona` se ignoran.
- **Web.** El navegador habla con Next; Next reenvía `/api/auth/*` a la API y solo pasa la cookie `aiw.session_token`. `baseURL` de Better Auth es la URL pública del panel, así que la passkey usa `rpID=localhost` y origen `http://localhost:3000` en local.
- **Invitación.** `pnpm --filter @aiw/api invitar-propietario -- --organizacion "<nombre>" --nombre "<persona>" --correo <correo>` crea organización, persona y usuario en una transacción, anota `acceso.propietario.invitado` y manda el aviso por el correo configurado (Mailpit en local). Con `--tenant <uuid>` usa una organización existente.
- **Sin sesión, la aprobación por correo sigue igual**: vive en `apps/channels`, que no se toca.

## Criterios de hecho

1. `POST /api/auth/sign-in/magic-link` con un correo invitado envía un enlace de un solo uso (15 min, token guardado con hash); abrirlo crea la sesión y la cookie. Con un correo no invitado responde lo mismo, no envía nada y no crea usuario.
2. Una passkey se registra desde `/panel/cuenta` con sesión, y `signIn.passkey` crea sesión sin correo, en `http://localhost`.
3. La API resuelve tenant y persona solo desde la sesión validada en el servidor; una petición con cabeceras de tenant y sin sesión recibe 401 y ninguna fila.
4. `POST /api/auth/sign-out` borra la sesión; una sesión caducada (`AIW_SESION_HORAS`, 12 por defecto, sin renovación deslizante) no vale y se borra al presentarse.
5. Cada inicio, cierre y caducidad de sesión, cada enlace enviado y cada invitación emite su entrada con `anotar` en el tenant de la persona y suma al contador. Si la entrada no se escribe, no hay cookie de sesión.
6. Una persona desactivada o de una organización no activa no obtiene sesión.
7. Con la RLS y el rol `aiw_app`: sin tenant de sesión, cero filas; con el tenant de otra organización, cero filas de la primera. `aiw_app` no puede leer `sesion` ni `usuario`.
8. Las pruebas de `apps/channels` (aprobación por correo sin sesión) siguen en verde sin cambios.

## Casos de prueba y de eval

- Unitario: configuración (bandera, secreto de 32+ caracteres, valores por defecto), resolución de sesión (sin cookie, cookie inválida, sesión válida), rutas de sala y contador con y sin sesión (401, cabeceras ignoradas), reenvío de Next (solo la cookie de sesión, varias `set-cookie`, redirecciones).
- Integración con PostgreSQL: flujo completo con Better Auth real (enlace → sesión → `get-session` → datos del tenant → cierre), caducidad, persona inactiva, correo no invitado, aislamiento entre dos organizaciones, entradas del libro y cadena verificada, disparador que impone tenant y persona.
- Eval: no aplica; no hay comportamiento de agente nuevo.
- Auditoría y contador: `acceso.propietario.invitado`, `acceso.enlace.enviado`, `acceso.sesion.iniciada`, `acceso.sesion.cerrada`, `acceso.sesion.caducada`; se comprueban con `verificarCadena` y con `contador_consumo.acciones`.
- Secretos: `buscarSecretos` sobre `apps/api` y `apps/web`; el secreto de Better Auth llega por `AIW_ACCESO_SECRETO` (`GENERAR` en `.env.example`) y no aparece en registros ni en errores.

## Fuera de alcance

- SSO, SCIM, varias organizaciones por usuario, roles y permisos finos: rebanada «Identidad y organizaciones».
- Guardar el token de sesión con hash (Better Auth 1.7 no lo ofrece) y limpiar sesiones caducadas que nadie vuelve a presentar: propuesta de rebanada.
- Mover los transportes de correo de `apps/channels` a `packages/notifications`: propuesta de rebanada; aquí hay un transporte mínimo propio en `apps/api`.
- La presencia de la sala y su migración: «Sala v1 · presencia».

## Presupuesto de tokens

Presupuesto: 40 €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

Esta sesión no pudo leer la página de Notion (sin MCP de Notion): los criterios de arriba salen del encargo del orquestador. Si la página pide algo que aquí no está, dilo en el PR.
