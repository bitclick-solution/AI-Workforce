VIGENTE

# @aiw/domain

Entidades del dominio, esquemas Zod de las cargas `jsonb` y el esquema de PostgreSQL
con sus migraciones. No depende de ningún otro paquete del monorepo.

- `src/db/`: esquema Drizzle, cliente, migrador, mantenimiento y carga sintética.
- `src/esquemas/`: esquemas Zod de lo que va en `jsonb`.
- `src/pruebas/`: entorno y semilla que comparten las pruebas de base de datos de este paquete y de `@aiw/ledger`.
- `drizzle/`: migraciones versionadas y sus reversos.

El diagrama de entidades está en [`docs/datos/modelo-de-datos-v1.md`](../../docs/datos/modelo-de-datos-v1.md).

## Roles de base de datos

La migración inicial crea dos roles, ninguno con contraseña: el despliegue les asigna
la suya desde el gestor de secretos.

| Rol            | Para qué      | Qué puede                                                                                                                                                                                 |
| -------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aiw_migrador` | Migraciones   | Es el dueño del esquema. Solo lo usan las migraciones                                                                                                                                     |
| `aiw_app`      | La aplicación | `select`, `insert`, `update` y `delete` sobre las tablas del tenant; sobre `entrada_auditoria`, solo `insert`. No tiene `BYPASSRLS` ni acceso a `migracion_aplicada` ni a las particiones |

## El tenant de la sesión

Toda consulta corre dentro de una transacción con el tenant fijado. Las políticas de
seguridad de fila leen `aiw.tenant_id`; sin ese ajuste no se ve ninguna fila, que es
el comportamiento seguro por defecto.

```ts
import { conTenant, crearConexion } from '@aiw/domain/db';

const { cliente, cerrar } = crearConexion({ url: process.env.DATABASE_URL! });
const tareas = await conTenant(cliente, tenantId, (tx) => tx`select id from tarea`);
await cerrar();
```

`set_config(..., true)` es local a la transacción: al terminar, la conexión vuelve al
estado sin tenant y nunca arrastra el de la petición anterior.

## Migraciones

```bash
DATABASE_URL=... pnpm --filter @aiw/domain db:migrar
DATABASE_URL=... pnpm --filter @aiw/domain db:revertir
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

La retención se cumple archivando y soltando particiones, nunca borrando filas.

## Borrado y exportación

`exportarOrganizacion` escribe un JSONL por tabla y `purgarOrganizacion` vacía el
tenant en el orden correcto; `exportarPuesto` y `purgarPuesto` hacen lo propio con un
agente. El libro de auditoría se exporta pero no se purga.

## Pruebas

Las pruebas que necesitan PostgreSQL leen `DATABASE_URL` y se saltan con un mensaje
claro cuando no está. En la integración continua las ejecuta el job «Base de datos».

```bash
DATABASE_URL=... pnpm --filter @aiw/domain test
# Carga completa del plan: un millón de entradas y cien mil mensajes, con informe.
DATABASE_URL=... AIW_PRUEBA_CARGA=1 pnpm --filter @aiw/domain test
```
