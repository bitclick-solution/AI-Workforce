-- Reverso de la lista blanca de herramientas de una habilidad.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'aiw_migrador') then
    execute 'set local role aiw_migrador';
  end if;
end
$$;
--> statement-breakpoint

alter table habilidad
  drop column if exists herramientas;
--> statement-breakpoint
