-- Reverso del contador de tareas v0. Deja la base como estaba antes de
-- `0001_contador_uso_de_modelos.sql`: sin las dos tablas nuevas y sin sus permisos.
--
-- No toca roles, funciones ni tablas de la migración inicial, que son de otra
-- migración y de otro reverso. El orden es de la hoja a la raíz: `uso_modelo`
-- referencia a `tarifa_modelo`.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'aiw_migrador') then
    execute 'set local role aiw_migrador';
  end if;
end
$$;
--> statement-breakpoint

drop table if exists uso_modelo;
--> statement-breakpoint
drop table if exists tarifa_modelo;
--> statement-breakpoint

-- Los disparadores y las políticas se van con sus tablas; los permisos del rol de
-- aplicación también. No queda nada que retirar a mano.
reset role;
--> statement-breakpoint
