-- Presencia configurable desde el perfil (ADR-026, rebanada «Presencia
-- configurable desde el perfil»): cada persona decide si las demás la ven
-- conectada en las salas. Visible por defecto.
--
-- `persona` ya tiene seguridad de fila por `tenant_id` desde `0000_inicial.sql`;
-- una columna nueva hereda esa política sin necesitar ninguna propia.
--
-- Autocontenida: solo altera `persona`, creada en `0000_inicial.sql`.
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

alter table persona
  add column mostrar_presencia boolean not null default true;
--> statement-breakpoint
