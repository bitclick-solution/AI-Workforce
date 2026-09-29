-- Reverso de la última lectura de sala_participante.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'aiw_migrador') then
    execute 'set local role aiw_migrador';
  end if;
end
$$;
--> statement-breakpoint

alter table sala_participante
  drop column if exists ultima_lectura_en;
--> statement-breakpoint
