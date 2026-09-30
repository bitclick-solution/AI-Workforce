-- Reverso de la presencia configurable desde el perfil.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'aiw_migrador') then
    execute 'set local role aiw_migrador';
  end if;
end
$$;
--> statement-breakpoint

alter table persona
  drop column if exists mostrar_presencia;
--> statement-breakpoint
