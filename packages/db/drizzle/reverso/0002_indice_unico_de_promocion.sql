-- Reverso de 0002_indice_unico_de_promocion.sql: vuelve al índice único por
-- (tenant_id, leccion_id, version_puesto_resultante_id) de la migración inicial.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'aiw_migrador') then
    execute 'set local role aiw_migrador';
  end if;
end
$$;
--> statement-breakpoint

drop index if exists promocion_tenant_leccion_key;
--> statement-breakpoint

create unique index promocion_tenant_leccion_version_key
  on promocion (tenant_id, leccion_id, version_puesto_resultante_id);
--> statement-breakpoint

reset role;
