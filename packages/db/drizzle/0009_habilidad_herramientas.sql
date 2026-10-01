-- Lista blanca de herramientas de una habilidad (hallazgo bloqueante del Revisor
-- en el PR #67, «habilidades en el bucle del agente»): `habilidad` no tenía
-- columna para las herramientas que sus pasos nombran, así que `sembrarHabilidad`
-- las descartaba al insertar y `proponerActivacionDeHabilidad` las fijaba a `[]`
-- al releer. La puerta del Evaluador certificaba cualquier habilidad sin
-- comprobar de verdad su lista blanca (packages/learning/src/habilidades.ts).
--
-- `habilidad` ya tiene seguridad de fila por `tenant_id` desde `0000_inicial.sql`;
-- una columna nueva hereda esa política sin necesitar ninguna propia, igual que
-- `disposicion_panel` en `0008_disposicion_panel_inicio.sql`. La fila de
-- `habilidad` es inmutable (columnasInmutables en packages/db/src/columnas.ts);
-- esto es una alteración de esquema (DDL), no un UPDATE sobre filas existentes,
-- así que el disparador de inmutabilidad no la afecta.
--
-- Autocontenida: solo altera `habilidad`, creada en `0000_inicial.sql`.
-- Se aplica con `pnpm --filter @aiw/db db:migrar` y se deshace con `db:revertir`.

do $$
begin
  execute format('grant aiw_migrador to %I', current_user);
exception
  when insufficient_privilege then
    raise exception
      'El usuario % no puede asumir aiw_migrador. Dale la pertenencia con «grant aiw_migrador to %» desde un rol con opción de administración y repite la migración.',
      current_user, current_user;
end
$$;
--> statement-breakpoint

set local role aiw_migrador;
--> statement-breakpoint

alter table habilidad
  add column herramientas jsonb not null default '[]'::jsonb;
--> statement-breakpoint
