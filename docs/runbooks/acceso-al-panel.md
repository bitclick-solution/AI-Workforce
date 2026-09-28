VIGENTE

# Runbook · Acceso al panel: activarlo, invitar al propietario y revocar

Cómo se enciende el inicio de sesión del panel en un entorno, cómo entra el primer propietario de una organización y cómo se le quita el acceso. Especificación: [`docs/specs/acceso-al-panel.md`](../specs/acceso-al-panel.md).

## Requisitos previos

- La migración `0005_acceso_al_panel` aplicada (`pnpm --filter @aiw/db db:migrar`). Crea el rol `aiw_identidad`.
- El usuario de base con el que corre la API puede asumir `aiw_app` y `aiw_identidad`. En desarrollo y en la CI es superusuario y ya puede; en staging y producción, desde un rol con opción de administración: `grant aiw_app, aiw_identidad to <usuario de la API>;`. Quien ejecute `invitar-propietario` necesita los mismos dos roles.
- Un secreto para firmar las cookies, de 32 caracteres o más, en el gestor de secretos del entorno: `openssl rand -base64 48`. Nunca en el repositorio.

## Activar el acceso

1. En la API: `AIW_ACCESO_PANEL=1`, `AIW_ACCESO_SECRETO=<secreto>`, `AIW_WEB_URL_PUBLICA=<URL del panel tal como la ve el navegador>` y las variables `AIW_CORREO_*` del proveedor de correo (en local, `AIW_CORREO_PROVEEDOR=smtp` con Mailpit en `localhost:1025`).
2. En el panel: `AIW_ACCESO_PANEL=1` y `AIW_API_URL=<URL interna de la API>`.
3. Fuera de `localhost`, la URL pública tiene que ser `https`: WebAuthn no admite passkeys en `http` salvo en `localhost`, y la API se niega a arrancar si no.
4. Con la bandera apagada no hay `/api/auth` y la sala y el contador responden 401: el tenant ya no llega por cabecera ni por entorno.

## Invitar al propietario de una organización

- Organización nueva: `pnpm --filter @aiw/api invitar-propietario --organizacion "<nombre>" --nombre "<persona>" --correo <correo>`.
- Organización existente: `pnpm --filter @aiw/api invitar-propietario --tenant <uuid> --nombre "<persona>" --correo <correo>`.

El comando crea organización, persona y usuario en una transacción, anota `acceso.propietario.invitado` en el libro de la organización y manda el aviso por correo. Si el aviso falla, la invitación queda hecha y la persona pide su enlace en `<URL pública>/acceso`. Un correo que ya tiene acceso no se invita dos veces.

## Comprobar que funciona

1. Abre `<URL pública>/acceso`, escribe el correo invitado y abre el enlace que llega (en local, en Mailpit: `http://localhost:8025`).
2. Llegas a `/panel/cuenta` con tu nombre. Registra una passkey, cierra sesión y vuelve a entrar con «Entrar con passkey».
3. En el libro de la organización aparecen `acceso.enlace.enviado`, `acceso.sesion.iniciada` (con `better-auth:magic-link` o `better-auth:passkey`) y `acceso.sesion.cerrada`.

## Revocar el acceso

- De una persona: `update persona set activa = false where id = <persona>` con el tenant fijado. Pierde la sesión en la siguiente petición y no recibe más enlaces.
- De todas las sesiones de una persona, sin desactivarla: `delete from sesion where persona_id = <persona>` con el rol `aiw_identidad`.
- De todo el entorno: rota `AIW_ACCESO_SECRETO` y reinicia la API. Todas las cookies dejan de validar.

## Problemas conocidos

- Las sesiones caducadas que nadie vuelve a presentar se quedan en `sesion` hasta la purga: la caducidad se anota cuando alguien presenta la cookie.
- El token de sesión se guarda sin hash (Better Auth 1.7 no lo ofrece); solo `aiw_identidad` puede leer la tabla.
