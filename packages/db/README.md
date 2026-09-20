VIGENTE

# @aiw/db

Esquema de PostgreSQL con Drizzle, migraciones versionadas y lo que hace falta para
hablar con la base sin saltarse el aislamiento por tenant.

Zona crítica: migración de datos. Cualquier cambio del modelo es una migración con su
propia rebanada y la revisión de Jesús.

- `src/`: esquema Drizzle por familias (organización, equipo, trabajo, aprendizaje,
  salas, operaciones, conectores, conocimiento, observación), cliente, migrador,
  mantenimiento y carga sintética.
- `src/pruebas/`: entorno y semilla que comparten las pruebas de base de datos de
  este paquete y de `@aiw/ledger`.
- `drizzle/`: migraciones versionadas y sus reversos.
- `bench/`: informe de carga.

Depende de [`@aiw/domain`](../domain/README.md) para las enumeraciones y los esquemas
Zod, y de ningún otro paquete del monorepo. El diagrama de entidades está en
[`docs/datos/modelo-de-datos-v1.md`](../../docs/datos/modelo-de-datos-v1.md).

## Roles de base de datos

La migración inicial crea dos roles, ninguno con contraseña y ninguno con `LOGIN`: el
despliegue crea los usuarios que los asumen y les pone la contraseña desde el gestor
de secretos.

| Rol            | Para qué      | Qué puede                                                                                                                                                                                 |
| -------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aiw_migrador` | Migraciones   | Es el dueño del esquema: suyos son los tipos, las funciones y las tablas. Solo lo usan las migraciones                                                                                    |
| `aiw_app`      | La aplicación | `select`, `insert`, `update` y `delete` sobre las tablas del tenant; sobre `entrada_auditoria`, solo `insert`. No tiene `BYPASSRLS` ni acceso a `migracion_aplicada` ni a las particiones |

### El migrador es el dueño, no quien conecta

La migración crea los roles lo primero y acto seguido hace `grant aiw_migrador to
current_user` y `set local role aiw_migrador`. Todo lo que viene después —funciones,
tipos, tablas, particiones— queda a nombre de `aiw_migrador` y no del usuario que
abrió la conexión, que cambia entre entornos y entre despliegues. El `set local` se
deshace solo al cerrar la transacción de la migración.

Si el usuario que migra no puede asumir el rol, la migración para con un mensaje que
dice qué hacer: darle la pertenencia con `grant aiw_migrador to <usuario>` desde un
rol con opción de administración. Una prueba recorre `pg_tables` y falla si alguna
tabla tiene otro dueño.

### El usuario de la aplicación

El usuario con el que conecta la aplicación necesita la pertenencia:

```sql
-- La contraseña la pone el despliegue desde el gestor de secretos, nunca un fichero.
create role aiw_api login;
grant aiw_app to aiw_api;
```

La pertenencia no basta: el rol se fija al abrir la conexión, con `set role aiw_app`
o, dentro de una transacción, con `set local role aiw_app`. Eso es lo que hace
`conTenantYRol`, y es lo que evita que un usuario con privilegios de más se lleve por
delante la seguridad de fila sin que nadie se entere. Un usuario que conecte como
superusuario o como dueño del esquema se salta las políticas: no se despliega así.

## El tenant de la sesión

Toda consulta corre dentro de una transacción con el tenant fijado. Las políticas de
seguridad de fila leen `aiw.tenant_id`; sin ese ajuste no se ve ninguna fila, que es
el comportamiento seguro por defecto.

```ts
import { conTenant, crearConexion } from '@aiw/db';

const { cliente, cerrar } = crearConexion({ url: process.env.DATABASE_URL! });
const tareas = await conTenant(cliente, tenantId, (tx) => tx`select id from tarea`);
await cerrar();
```

`set_config(..., true)` es local a la transacción: al terminar, la conexión vuelve al
estado sin tenant y nunca arrastra el de la petición anterior.

## Quién crea organizaciones y paraguas

Crear una organización es una operación de plataforma, no del inquilino: la hace el
plano de control (`apps/platform-agents` y la consola de operación) y no un agente ni
la aplicación en nombre de un cliente.

- **Organización.** La política de `organizacion` es `id = aiw_tenant_actual()`, así
  que el alta exige fijar `aiw.tenant_id` al identificador nuevo **antes** del
  `insert`: se genera el UUID v7 con `uuidV7()`, se abre la transacción con
  `conTenant(cliente, idNuevo, ...)` y se inserta con ese mismo `id`. Sin el ajuste,
  el `with check` de la política rechaza la fila.
- **Organización paraguas.** Su única política es de lectura, y solo deja ver el
  paraguas al que pertenece el tenant de la sesión. Crearlo y cambiarlo no lo puede
  hacer `aiw_app`: lo hace el rol de operación de plataforma (hoy, `aiw_migrador` o
  el dueño de la base en un runbook; el rol propio llega con «Identidad y
  organizaciones»). Vincular una organización a su paraguas se hace en el mismo alta.

Ambas altas emiten entrada en el libro de auditoría con actor `plataforma`.

## Migraciones

```bash
DATABASE_URL=... pnpm --filter @aiw/db db:migrar
DATABASE_URL=... pnpm --filter @aiw/db db:revertir
```

Lo aplicado queda en `migracion_aplicada` con la huella del fichero: si alguien edita
una migración ya aplicada, `db:migrar` se niega a seguir. Ningún entorno se cambia a mano.

## Particiones

`entrada_auditoria`, `mensaje` y `senal` están particionadas por mes sobre `creado_en`.
La migración crea la partición del mes actual, la del siguiente y una por defecto.
El mantenimiento mensual usa la función de la base:

```sql
select crear_particion_mensual('entrada_auditoria', (current_date + interval '2 months')::date);
```

Hoy no hay nada que la programe: la rutina mensual llega con «Exportación y
retención», y hasta entonces la partición por defecto recoge lo que se salga de rango.
La retención se cumple archivando y soltando particiones, nunca borrando filas.

## Aprobaciones y decisiones

`aprobacion` es inmutable: se inserta cuando el agente pide permiso y no se toca. La
decisión es una fila propia en `decision_aprobacion`, una por aprobación (ADR-005).
«Aprobación pendiente» no es un estado: es una aprobación sin fila de decisión, y así
la busca el panel.

## Borrado y exportación

`exportarOrganizacion` escribe un JSONL por tabla y `purgarOrganizacion` vacía el
tenant en el orden correcto; `exportarPuesto` y `purgarPuesto` hacen lo propio con un
agente. El libro de auditoría se exporta pero no se purga.

## Pruebas

Las pruebas que necesitan PostgreSQL leen `DATABASE_URL` y se saltan con un mensaje
claro cuando no está. En la integración continua las ejecuta el job «Base de datos».

```bash
DATABASE_URL=... pnpm --filter @aiw/db test
# Carga completa del plan: un millón de entradas y cien mil mensajes, con informe.
DATABASE_URL=... AIW_PRUEBA_CARGA=1 pnpm --filter @aiw/db test
```
