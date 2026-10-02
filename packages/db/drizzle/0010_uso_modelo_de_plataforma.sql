-- Uso de modelo de plataforma (rebanada «Sala del departamento: moderador y Director
-- con paso de modelo real», decisión de Jesús del 2-10-2026): el moderador y el
-- Director de IA llaman a un modelo desde la sala, y esa llamada no cuelga de ninguna
-- tarea ni de ningún puesto de negocio. `uso_modelo` exigía tarea, puesto y versión de
-- puesto en todas sus filas, así que el consumo de plataforma no tenía dónde vivir.
--
-- Una fila es de uno de dos orígenes, y la restricción `uso_modelo_origen_coherente`
-- obliga a que sea exactamente uno:
--
-- - **Puesto** (lo de siempre): `tarea_id`, `tarea_raiz_id`, `puesto_id` y
--   `version_puesto_id` rellenos; `sala_id` y `actor_plataforma` vacíos.
-- - **Plataforma** (nuevo): los cuatro de arriba vacíos; `sala_id` y `actor_plataforma`
--   (`moderador` o `director_ia`) rellenos.
--
-- Efecto en el contador, y es a propósito: las consultas por tarea raíz y por puesto
-- (`tareasDelPeriodo`, `costePorPuesto`, `costeDeTareaRaiz`) cruzan por `tarea_raiz_id`
-- o `puesto_id`, así que las filas de plataforma no entran en ellas ni suman al contador
-- de tareas de ningún puesto. Sí entran en el total de euros del periodo
-- (`consumoDelPeriodo.costeModelosEuros`), que ahora cuadra con
-- `contador_consumo.coste_euros`, donde la entrada de la sala ya sumaba ese coste.
--
-- `uso_modelo` ya tiene seguridad de fila por `tenant_id` y su disparador de fila
-- inmutable (`0001`); las columnas nuevas heredan ambos. Esto es DDL: el disparador salta
-- en `UPDATE` de filas, no en una alteración de la tabla. Las filas que ya existen
-- cumplen la rama «puesto», así que la restricción se añade sin reescribirlas.
--
-- Autocontenida: solo altera `uso_modelo` y apunta a `sala` (`0000_inicial.sql`).
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

alter table uso_modelo
  alter column tarea_id drop not null,
  alter column tarea_raiz_id drop not null,
  alter column puesto_id drop not null,
  alter column version_puesto_id drop not null,
  add column sala_id uuid references sala (id) on delete restrict,
  add column actor_plataforma text;
--> statement-breakpoint

alter table uso_modelo
  add constraint uso_modelo_origen_coherente check (
    (
      tarea_id is not null and tarea_raiz_id is not null
      and puesto_id is not null and version_puesto_id is not null
      and sala_id is null and actor_plataforma is null
    )
    or
    (
      tarea_id is null and tarea_raiz_id is null
      and puesto_id is null and version_puesto_id is null
      and sala_id is not null and actor_plataforma in ('moderador', 'director_ia')
    )
  );
--> statement-breakpoint

create index uso_modelo_tenant_sala_creado_idx
  on uso_modelo (tenant_id, sala_id, creado_en desc)
  where sala_id is not null;
--> statement-breakpoint
