-- Reverso de la migración inicial. Deja la base como estaba antes de `0000_inicial.sql`.
--
-- No borra las extensiones `pgcrypto` ni `vector` porque pueden servir a otra base
-- del mismo clúster; sí borra todo lo que crea la migración: tablas, tipos, funciones
-- y roles. El orden es de la hoja a la raíz porque las claves foráneas restringen.

drop table if exists contador_consumo;
--> statement-breakpoint
drop table if exists entrada_auditoria;
--> statement-breakpoint
drop table if exists evento_salida;
--> statement-breakpoint
drop table if exists notificacion;
--> statement-breakpoint
drop table if exists indicador_valor;
--> statement-breakpoint
drop table if exists indicador;
--> statement-breakpoint
drop table if exists relacion;
--> statement-breakpoint
drop table if exists entidad;
--> statement-breakpoint
drop table if exists memoria;
--> statement-breakpoint
drop table if exists fragmento_conocimiento;
--> statement-breakpoint
drop table if exists documento_canonico;
--> statement-breakpoint
drop table if exists autorizacion_herramientas;
--> statement-breakpoint
drop table if exists conector;
--> statement-breakpoint
drop table if exists propuesta_operacion;
--> statement-breakpoint
drop table if exists intervencion;
--> statement-breakpoint
drop table if exists mensaje;
--> statement-breakpoint
drop table if exists sala_participante;
--> statement-breakpoint
drop table if exists sala;
--> statement-breakpoint
drop table if exists promocion;
--> statement-breakpoint
drop table if exists leccion_senal;
--> statement-breakpoint
drop table if exists leccion;
--> statement-breakpoint
drop table if exists senal;
--> statement-breakpoint
drop table if exists disparador;
--> statement-breakpoint
drop table if exists aprobacion;
--> statement-breakpoint
drop table if exists delegacion;
--> statement-breakpoint
drop table if exists paso;
--> statement-breakpoint
drop table if exists tarea;
--> statement-breakpoint
drop table if exists habilidad_version_puesto;
--> statement-breakpoint
drop table if exists habilidad;
--> statement-breakpoint
alter table if exists puesto drop constraint if exists puesto_version_activa_fk;
--> statement-breakpoint
alter table if exists departamento drop constraint if exists departamento_supervisor_puesto_fk;
--> statement-breakpoint
drop table if exists version_puesto;
--> statement-breakpoint
drop table if exists puesto;
--> statement-breakpoint
drop table if exists departamento;
--> statement-breakpoint
drop table if exists paquete_tareas;
--> statement-breakpoint
drop table if exists persona;
--> statement-breakpoint
-- La política del paraguas mira dentro de `organizacion`: se retira antes.
do $$
begin
  if to_regclass('public.organizacion_paraguas') is not null then
    execute 'drop policy if exists organizacion_paraguas_lectura on organizacion_paraguas';
  end if;
end
$$;
--> statement-breakpoint
drop table if exists organizacion;
--> statement-breakpoint
drop table if exists organizacion_paraguas;
--> statement-breakpoint
drop table if exists migracion_aplicada;
--> statement-breakpoint

drop type if exists estado_evento_salida;
--> statement-breakpoint
drop type if exists estado_notificacion;
--> statement-breakpoint
drop type if exists canal_notificacion;
--> statement-breakpoint
drop type if exists rol_participante;
--> statement-breakpoint
drop type if exists ambito;
--> statement-breakpoint
drop type if exists tipo_disparador;
--> statement-breakpoint
drop type if exists estado_conector;
--> statement-breakpoint
drop type if exists tipo_conector;
--> statement-breakpoint
drop type if exists tipo_actor;
--> statement-breakpoint
drop type if exists estado_propuesta;
--> statement-breakpoint
drop type if exists tipo_operacion;
--> statement-breakpoint
drop type if exists estado_leccion;
--> statement-breakpoint
drop type if exists tipo_senal;
--> statement-breakpoint
drop type if exists decision_aprobacion;
--> statement-breakpoint
drop type if exists resultado_accion;
--> statement-breakpoint
drop type if exists estado_tarea;
--> statement-breakpoint
drop type if exists origen_tarea;
--> statement-breakpoint
drop type if exists nivel_autonomia;
--> statement-breakpoint
drop type if exists clase_riesgo;
--> statement-breakpoint
drop type if exists estado_puesto;
--> statement-breakpoint
drop type if exists estado_departamento;
--> statement-breakpoint
drop type if exists estado_organizacion;
--> statement-breakpoint
drop type if exists plan_organizacion;
--> statement-breakpoint

drop function if exists crear_particion_mensual(text, date);
--> statement-breakpoint
drop function if exists aiw_proteger_particion(text);
--> statement-breakpoint
drop function if exists aiw_libro_solo_insercion();
--> statement-breakpoint
drop function if exists aiw_tenant_actual();
--> statement-breakpoint
drop function if exists uuid_generar_v7();
--> statement-breakpoint

-- `drop owned by` retira los permisos que quedan (uso del esquema, funciones)
-- antes de borrar el rol; si no, PostgreSQL se niega por dependencias.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'aiw_app') then
    execute 'drop owned by aiw_app';
    execute 'drop role aiw_app';
  end if;
  if exists (select 1 from pg_roles where rolname = 'aiw_migrador') then
    execute 'drop owned by aiw_migrador';
    execute 'drop role aiw_migrador';
  end if;
end
$$;
--> statement-breakpoint
