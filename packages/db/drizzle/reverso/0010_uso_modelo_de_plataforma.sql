-- Reverso del uso de modelo de plataforma. Deja `uso_modelo` como antes de
-- `0010_uso_modelo_de_plataforma.sql`: con tarea, puesto y versión obligatorios.
--
-- Las filas de plataforma no tienen tarea ni puesto y no caben en la tabla de antes:
-- se borran. Es la única pérdida de datos de este reverso. El coste que representaban
-- sigue en `entrada_auditoria.coste_euros` y en `contador_consumo`, que son append-only
-- y no se tocan aquí, así que el libro conserva la cuenta aunque desaparezca el detalle.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'aiw_migrador') then
    execute 'set local role aiw_migrador';
  end if;
end
$$;
--> statement-breakpoint

drop index if exists uso_modelo_tenant_sala_creado_idx;
--> statement-breakpoint

delete from uso_modelo where sala_id is not null;
--> statement-breakpoint

alter table uso_modelo
  drop constraint if exists uso_modelo_origen_coherente;
--> statement-breakpoint

alter table uso_modelo
  drop column if exists actor_plataforma,
  drop column if exists sala_id;
--> statement-breakpoint

alter table uso_modelo
  alter column tarea_id set not null,
  alter column tarea_raiz_id set not null,
  alter column puesto_id set not null,
  alter column version_puesto_id set not null;
--> statement-breakpoint

reset role;
--> statement-breakpoint
