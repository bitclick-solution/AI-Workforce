-- Reverso de la promoción de varias versiones. Deja la base como estaba antes de
-- `0011_promocion_version.sql`: sin la tabla `promocion_version`.
--
-- No hay pérdida de datos que no se pueda reconstruir. Cada versión de puesto sigue
-- en `version_puesto` (inmutable) y en su `lecciones_origen`; solo se pierde el
-- vínculo promoción → versiones, que se deriva de `lecciones_origen`. La promoción de
-- la lección conserva su versión de origen en `version_puesto_resultante_id`.
--
-- El disparador, la política, los permisos y los índices se van con la tabla.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'aiw_migrador') then
    execute 'set local role aiw_migrador';
  end if;
end
$$;
--> statement-breakpoint

drop table if exists promocion_version;
--> statement-breakpoint

reset role;
