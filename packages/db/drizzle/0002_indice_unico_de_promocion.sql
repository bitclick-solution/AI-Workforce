-- Índice único de promoción: una lección se promociona una sola vez.
--
-- El índice `promocion_tenant_leccion_version_key`, de la migración inicial, era
-- único por (tenant_id, leccion_id, version_puesto_resultante_id): dos filas de
-- `promocion` para la misma lección cabían si apuntaban a versiones de puesto
-- distintas, así que el invariante «una lección no se promociona dos veces» lo
-- sostenía solo `promocionarLeccion`, con su bloqueo por puesto (hallazgo del
-- Revisor en el PR #23, Aprendizaje v0). Esta migración lo sostiene también la
-- base: el índice nuevo es único por (tenant_id, leccion_id), así que un segundo
-- `INSERT` en `promocion` para la misma lección falla aunque quien inserte no pase
-- por la aplicación.
--
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

drop index promocion_tenant_leccion_version_key;
--> statement-breakpoint

create unique index promocion_tenant_leccion_key on promocion (tenant_id, leccion_id);
