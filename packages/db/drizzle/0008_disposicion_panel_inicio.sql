-- Disposición del panel de widgets del inicio, por persona (rebanada «Inicio:
-- widgets, agentes en tiempo real y avisos a la derecha», ADR-020): qué widgets
-- del catálogo cerrado ve cada persona, en qué orden, con qué tamaño y cuáles
-- oculta. Un JSON pequeño por persona (unas pocas entradas `{id, tamano,
-- oculto}`), así que es una columna y no una tabla propia: sin ella caben todas
-- las combinaciones del catálogo cerrado v1 y no hace falta ningún índice ni
-- ninguna consulta por su contenido.
--
-- `persona` ya tiene seguridad de fila por `tenant_id` desde `0000_inicial.sql`;
-- una columna nueva hereda esa política sin necesitar ninguna propia, igual que
-- `mostrar_presencia` en `0007_presencia_configurable_perfil.sql`.
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
  add column disposicion_panel jsonb not null default '[]'::jsonb;
--> statement-breakpoint
