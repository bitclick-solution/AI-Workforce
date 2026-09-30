VIGENTE

# Especificación · Presencia configurable desde el perfil: visible por defecto y opción de aparecer como desconectado

- Rebanada: [Notion](https://app.notion.com/p/3ea530661898819b8f02e48b0a27493a) · Ciclo 2 · Tipo Producto · Paquetes `rooms`, `web`, `api`, `db` · P1
- Rama: `rebanada/presencia-configurable-perfil`
- Plan de referencia: [ADR-026](../adr/ADR-026.md) (privacidad de la presencia, visible por defecto y configurable desde el perfil). Punto de partida: [Sala v1 · presencia](sala-v1-presencia.md) (`packages/rooms/src/presencia.ts`, `packages/rooms/src/centrifugo.ts`, `apps/api/src/rutas/sala.ts`) y [Acceso al panel](acceso-al-panel.md) (sesión validada en el servidor, `apps/web/app/panel/cuenta`).
- Zona crítica: sí. Toca una migración de `packages/db` (columna en `persona`) y la seguridad de fila de esa tabla. «Revisión humana obligatoria» marcada en la rebanada.

## Objetivo

Cada persona decide si las demás la ven conectada en las salas. El ajuste vive en su perfil (`/panel/cuenta`), activado por defecto; al desactivarlo, aparece como desconectada para todo el mundo, en todas las salas, y su «escribiendo» deja de publicarse, sin que el cliente tenga que ocultar nada por su cuenta.

## Paquetes tocados

- `packages/db`: columna `persona.mostrar_presencia` (migración `0007_presencia_configurable_perfil.sql` y su reverso).
- `packages/rooms`: `tokenDeCanal` (`centrifugo.ts`) acepta si hay que ocultar la presencia y añade el `override` de Centrifugo que apaga `presence` y `join_leave` para esa suscripción.
- `apps/api`: `rutas/sala.ts` (`tokenDeSala`, `avisarEscribiendo`, `miembrosDeSala` leen y aplican el ajuste) y `rutas/perfil.ts`, ruta nueva para leer y cambiar el ajuste, con su entrada en el libro.
- `apps/web`: `lib/perfil.ts`, `app/api/perfil/route.ts` (proxy con la cookie de sesión, igual que sala y contador) y el ajuste en `app/panel/cuenta` (`vista.tsx`, `page.tsx`). No se toca `packages/ui`: el interruptor es un control mínimo propio de esta página.

## Endpoints, flujos y datos

- `GET /perfil` y `PATCH /perfil` en `apps/api`, tras la sesión del panel validada en el servidor (`resolverSesion`); sin sesión, 401. A diferencia de `/sala` y `/contador`, no lleva bandera de funcionalidad ni token propio: es una operación sobre el propio perfil, no una API de datos de negocio, y ya exige sesión (decisión 1, más abajo).
- `PATCH /perfil` valida `{ mostrarPresencia: boolean }`, actualiza `persona.mostrar_presencia` con `conTenant` y anota `perfil.presencia_actualizada` en el libro, en la misma transacción.
- Migración `packages/db/drizzle/0007_presencia_configurable_perfil.sql`: añade `persona.mostrar_presencia boolean not null default true`. `persona` ya tiene RLS por `tenant_id` desde la migración inicial; la columna nueva hereda esa política, no crea ninguna.
- Al pedir el token de una sala (`POST /sala/:salaId/token`), la API mira `persona.mostrar_presencia` y, si está desactivado, firma el token de canal con `override: { presence: false, join_leave: false }`: Centrifugo nunca cuenta ni avisa de esa conexión a nadie, así que ni la lista de miembros ni los eventos nativos `join`/`leave` la revelan. Es la capa fuerte: aunque el cliente ignore la respuesta de la API, Centrifugo mismo no publica esa presencia.
- `GET /sala/:salaId/miembros` (`miembrosDeSala`) trae `mostrar_presencia` en la misma consulta y fuerza `conectada = false` para quien lo tiene desactivado, aunque la presencia de Centrifugo diga lo contrario (defensa en profundidad si algún cliente antiguo no llevara el `override`).
- `POST /sala/:salaId/escribiendo` (`avisarEscribiendo`) comprueba el ajuste antes de llamar a Centrifugo: desactivado, no se publica nada, así que «escribiendo» tampoco llega a nadie.

## Criterios de hecho

1. En el perfil de cada persona (`/panel/cuenta`) hay un ajuste «Mostrar mi presencia en las salas», activado por defecto (ADR-026).
2. Desactivado, la persona aparece como desconectada para los demás en todas las salas y no se publica su «escribiendo»; se hace en el servidor (token de Centrifugo sin `presence` ni `join_leave`, `miembrosDeSala` fuerza desconectada, `avisarEscribiendo` no publica), no solo en la interfaz.
3. El ajuste se guarda por persona con RLS por `tenant_id` (heredada de `persona`). Cambiarlo deja una entrada en el libro (`perfil.presencia_actualizada`); la presencia en sí sigue sin guardarse: ni historial ni entrada en el libro por cada conexión o desconexión.
4. Se mantienen las demás reglas del ADR-026, ya cubiertas por Sala v1 y sin cambios en esta rebanada: solo los miembros de una sala ven su presencia (`esMiembro`), inactiva tras diez minutos (`UMBRAL_INACTIVIDAD_MS`) y sin historial.
5. Pruebas del ajuste en la API (`apps/api/src/rutas/perfil.test.ts`, `apps/api/src/pruebas/perfil-puerto.test.ts`) y de extremo a extremo en la Sala v1 con Postgres real (`apps/api/src/pruebas/sala-puerto.test.ts`): con el ajuste desactivado, el token de canal lleva el `override`, la persona no cuenta como conectada en `miembrosDeSala` aunque Centrifugo diga que sí, y `avisarEscribiendo` no llama a Centrifugo. Migración reversible (`db:migrar` / `db:revertir`).

## Casos de prueba y de eval

- Unitario: `packages/rooms/src/centrifugo.test.ts` (el `override` del token de canal, presente y ausente), `apps/api/src/rutas/sala.test.ts` (miembro oculto forzado a «añadido», sin publicar «escribiendo», token con `override`), `apps/api/src/rutas/perfil.test.ts` (leer, actualizar, validación del cuerpo, 401 sin sesión).
- Integración con PostgreSQL: `apps/api/src/pruebas/perfil-puerto.test.ts` (valor por defecto, actualización, entrada en el libro y cadena verificada, aislamiento entre tenants) y una prueba nueva en `apps/api/src/pruebas/sala-puerto.test.ts` con el ajuste desactivado. Se saltan sin `DATABASE_URL`, como el resto del monorepo.
- Eval: ninguno nuevo. No hay comportamiento de agente nuevo: el ajuste es de una persona sobre sí misma.
- Auditoría y contador: `perfil.presencia_actualizada` se comprueba en `apps/api/src/pruebas/perfil-puerto.test.ts` contando en el libro y verificando la cadena de hash. No suma al contador de tareas: cambiar un ajuste del perfil no es una tarea de agente.
- Secretos: no aplica: esta rebanada no añade ninguna credencial ni variable de entorno nueva.

## Fuera de alcance

- Cualquier otro ajuste del perfil: esta rebanada añade solo la presencia.
- La ficha del pack de cumplimiento para el comité de empresa que explique la presencia (ADR-026): no existe todavía ningún fichero en `docs/` para ese pack; queda anotado en el PR para quien abra esa rebanada.
- Cambiar el umbral de diez minutos de inactividad o el resto de reglas de Sala v1 · presencia: ya decididas y sin tocar aquí.

## Decisiones que el plan no fija

1. **`GET`/`PATCH /perfil` no llevan bandera de funcionalidad ni token propio**, a diferencia de `/sala` y `/contador`. Esas dos rutas nacieron antes de «Acceso al panel» y su token era la única prueba de que quien llamaba era el servidor del panel; `/perfil` nace después, ya con sesión validada en el servidor, y añadir un token aparte solo repetiría una comprobación que la sesión ya hace. Se registra en `apps/api/src/servidor.ts` siempre que haya conexión a la base, igual que el contador.
2. **El ajuste vive en `persona`, no en `usuario`.** `usuario` es de Better Auth y solo lo lee el rol `aiw_identidad`; `aiw_app` no tiene ningún permiso sobre él (`0006_acceso_al_panel.sql`). La presencia de Sala v1 se calcula con el rol de aplicación sobre `persona`, así que poner el ajuste ahí evita tocar esa frontera de permisos por una casilla del perfil.
3. **`miembrosDeSala` fuerza la desconexión para todo el mundo, incluida la propia persona.** El criterio de hecho dice «para los demás»; esta especificación no distingue el propio visor del resto para no complicar el contrato de `MiembroDeLaVista` con una marca de «soy yo»: quien apaga su presencia sabe que la apagó, así que verse a sí mismo como «añadido» en su propia lista de miembros no es una sorpresa.

## Presupuesto de tokens

Presupuesto: 12 €. Consumo real: se registra en la rebanada al abrir el PR. Superar el presupuesto en un 50 % pasa la rebanada a Bloqueada con diagnóstico.

## Pregunta abierta

Ninguna: el ADR-026 y los criterios de hecho de la rebanada fijan todo lo que hacía falta decidir.
