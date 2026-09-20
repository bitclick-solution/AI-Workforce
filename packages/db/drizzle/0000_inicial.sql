-- Migración inicial del modelo de datos v1 (ADR-007).
--
-- Cubre lo que el esquema Drizzle de `packages/db/src` y `packages/ledger/src/db`
-- declara, más lo que Drizzle no expresa: extensiones, función de UUID v7, roles,
-- seguridad a nivel de fila con sus políticas, particionado mensual, índices HNSW,
-- permisos del rol de aplicación y la prohibición de tocar el libro de auditoría.
--
-- Se aplica con `pnpm --filter @aiw/db db:migrar` y se deshace con `db:revertir`.
-- Ningún entorno se cambia a mano.

create extension if not exists pgcrypto;
--> statement-breakpoint
create extension if not exists vector;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Roles. `aiw_migrador` posee el esquema; `aiw_app` corre la aplicación y no
-- tiene BYPASSRLS, así que las políticas se le aplican siempre.
--
-- Se crean lo primero y el usuario que migra los asume: todo lo que viene después
-- —funciones, tipos y tablas— queda a nombre de `aiw_migrador` y no del usuario
-- que abrió la conexión, que cambia entre entornos. Sin esto, el dueño del esquema
-- sería quien migró ese día.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'aiw_migrador') then
    create role aiw_migrador nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'aiw_app') then
    create role aiw_app nologin;
  end if;
end
$$;
--> statement-breakpoint

-- El esquema `public` no deja crear a cualquiera desde PostgreSQL 15.
grant usage, create on schema public to aiw_migrador;
--> statement-breakpoint

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

-- Local a la transacción de la migración: al terminar, la sesión vuelve a su rol.
set local role aiw_migrador;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Identificadores ordenables: UUID v7. PostgreSQL 16 todavía no trae uuidv7().
-- ---------------------------------------------------------------------------
create or replace function uuid_generar_v7() returns uuid
language plpgsql
parallel safe
as $$
declare
  v_milisegundos bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_uuid bytea;
begin
  v_uuid := substring(int8send(v_milisegundos) from 3 for 6) || gen_random_bytes(10);
  -- Versión 7 en los cuatro bits altos del séptimo byte.
  v_uuid := set_byte(v_uuid, 6, (get_byte(v_uuid, 6) & 15) | 112);
  -- Variante RFC 4122 en los dos bits altos del noveno byte.
  v_uuid := set_byte(v_uuid, 8, (get_byte(v_uuid, 8) & 63) | 128);
  return encode(v_uuid, 'hex')::uuid;
end;
$$;
--> statement-breakpoint

-- Tenant de la sesión. Sin ajuste devuelve NULL y ninguna política deja ver nada.
create or replace function aiw_tenant_actual() returns uuid
language sql
stable
parallel safe
as $$
  select nullif(current_setting('aiw.tenant_id', true), '')::uuid
$$;
--> statement-breakpoint

create table if not exists migracion_aplicada (
  nombre text primary key,
  huella text not null,
  aplicada_en timestamptz not null default now()
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Enumeraciones. Columnas para lo que se filtra y se ordena.
-- ---------------------------------------------------------------------------
create type estado_organizacion as enum ('activa', 'pausada', 'dada_de_baja');
--> statement-breakpoint
create type estado_departamento as enum ('propuesto', 'activo', 'pausado', 'disuelto', 'fusionado');
--> statement-breakpoint
create type estado_puesto as enum ('propuesto', 'en_prueba', 'activo', 'pausado', 'degradado', 'dado_de_baja');
--> statement-breakpoint
create type clase_riesgo as enum ('bajo', 'medio', 'alto', 'critico');
--> statement-breakpoint
create type nivel_autonomia as enum ('n0', 'n1', 'n2', 'n3');
--> statement-breakpoint
create type origen_tarea as enum ('sala', 'canal', 'programacion', 'delegacion', 'manual');
--> statement-breakpoint
create type estado_tarea as enum ('pendiente', 'en_curso', 'esperando_aprobacion', 'completada', 'fallida', 'cancelada');
--> statement-breakpoint
create type resultado_accion as enum ('exito', 'error', 'rechazado', 'parcial');
--> statement-breakpoint
-- Sin «pendiente»: una aprobación pendiente es la que no tiene fila de decisión.
create type sentido_decision as enum ('aprobada', 'rechazada', 'editada');
--> statement-breakpoint
create type tipo_senal as enum ('aprobacion', 'correccion', 'queja', 'eval', 'metrica', 'incidencia');
--> statement-breakpoint
create type estado_leccion as enum ('propuesta', 'evaluada', 'promocionada', 'descartada');
--> statement-breakpoint
create type tipo_operacion as enum ('crear_departamento', 'disolver_departamento', 'contratar', 'mover', 'pausar', 'dar_de_baja', 'conectar', 'cambiar_nivel', 'cambiar_presupuesto', 'publicar_manual');
--> statement-breakpoint
create type estado_propuesta as enum ('borrador', 'pendiente', 'aprobada', 'rechazada', 'ejecutada', 'revertida');
--> statement-breakpoint
create type tipo_actor as enum ('persona', 'agente', 'plataforma', 'sistema');
--> statement-breakpoint
create type tipo_conector as enum ('mcp', 'nango', 'n8n', 'interno');
--> statement-breakpoint
create type estado_conector as enum ('configurado', 'activo', 'pausado', 'error');
--> statement-breakpoint
create type tipo_disparador as enum ('programacion', 'evento', 'mensaje', 'sala', 'delegacion');
--> statement-breakpoint
create type ambito as enum ('organizacion', 'departamento', 'puesto');
--> statement-breakpoint
create type rol_participante as enum ('humano', 'agente', 'moderador', 'observador');
--> statement-breakpoint
create type canal_notificacion as enum ('panel', 'correo', 'whatsapp', 'slack', 'teams');
--> statement-breakpoint
create type estado_notificacion as enum ('pendiente', 'enviada', 'leida', 'vencida', 'escalada');
--> statement-breakpoint
create type estado_evento_salida as enum ('pendiente', 'publicado', 'fallido');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Raíces de tenant.
-- ---------------------------------------------------------------------------
create table organizacion_paraguas (
  id uuid primary key default uuid_generar_v7(),
  nombre text not null,
  identificacion_fiscal text,
  facturacion jsonb not null default '{}'::jsonb,
  plantillas_compartibles jsonb not null default '[]'::jsonb,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
--> statement-breakpoint
create index organizacion_paraguas_nombre_idx on organizacion_paraguas (nombre);
--> statement-breakpoint

create table organizacion (
  id uuid primary key default uuid_generar_v7(),
  paraguas_id uuid references organizacion_paraguas (id) on delete restrict,
  nombre text not null,
  -- Texto y no tipo enum a propósito: el ADR-011 marca los planes como hipótesis
  -- que se revisa al cierre de la fase 1. Lo valida el esquema Zod
  -- `esquemas.planOrganizacion` de `@aiw/domain`; cambiar la lista no es migración.
  plan text not null default 'departamento',
  region_datos text not null default 'eu-west',
  limites jsonb not null default '{}'::jsonb,
  -- ADR-010: mínimo 6 meses, por defecto 24, máximo 10 años.
  retencion_meses bigint not null default 24,
  politica_cruce_departamentos jsonb not null default '{}'::jsonb,
  brand_voice jsonb not null default '{}'::jsonb,
  estado estado_organizacion not null default 'activa',
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint organizacion_retencion_rango check (retencion_meses between 6 and 120)
);
--> statement-breakpoint
create index organizacion_paraguas_idx on organizacion (paraguas_id, creado_en);
--> statement-breakpoint
create index organizacion_estado_idx on organizacion (estado, creado_en);
--> statement-breakpoint

create table persona (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  nombre text not null,
  correo text not null,
  telefono text,
  activa boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
--> statement-breakpoint
create unique index persona_tenant_correo_key on persona (tenant_id, correo);
--> statement-breakpoint
create index persona_tenant_activa_idx on persona (tenant_id, activa, creado_en);
--> statement-breakpoint

create table paquete_tareas (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  tareas_compradas bigint not null,
  tareas_consumidas bigint not null default 0,
  precio_euros numeric(12, 4) not null default 0,
  caduca_en timestamptz not null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
--> statement-breakpoint
create index paquete_tareas_tenant_caduca_idx on paquete_tareas (tenant_id, caduca_en);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Equipo: departamento, puesto, versión de puesto, habilidad.
-- Las claves foráneas circulares se añaden al final del bloque.
-- ---------------------------------------------------------------------------
create table departamento (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  nombre text not null,
  brand_voice jsonb not null default '{}'::jsonb,
  version_brand_voice bigint not null default 1,
  supervisor_persona_id uuid references persona (id) on delete restrict,
  supervisor_puesto_id uuid,
  presupuesto_euros numeric(12, 4) not null default 0,
  memoria_compartida boolean not null default true,
  estado estado_departamento not null default 'propuesto',
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
--> statement-breakpoint
create unique index departamento_tenant_nombre_key on departamento (tenant_id, nombre);
--> statement-breakpoint
create index departamento_tenant_estado_idx on departamento (tenant_id, estado, creado_en);
--> statement-breakpoint

create table puesto (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  departamento_id uuid not null references departamento (id) on delete restrict,
  nombre text not null,
  ficha jsonb not null default '{}'::jsonb,
  clase_riesgo clase_riesgo not null default 'bajo',
  enrutado_modelo jsonb not null default '{}'::jsonb,
  version_activa_id uuid,
  expediente jsonb not null default '{}'::jsonb,
  estado estado_puesto not null default 'propuesto',
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
--> statement-breakpoint
create unique index puesto_tenant_departamento_nombre_key on puesto (tenant_id, departamento_id, nombre);
--> statement-breakpoint
create index puesto_tenant_estado_idx on puesto (tenant_id, estado, creado_en);
--> statement-breakpoint
create index puesto_tenant_departamento_idx on puesto (tenant_id, departamento_id, creado_en);
--> statement-breakpoint

create table version_puesto (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  puesto_id uuid not null references puesto (id) on delete restrict,
  numero bigint not null,
  prompt text not null,
  politica jsonb not null default '{}'::jsonb,
  habilidades_congeladas jsonb not null default '[]'::jsonb,
  memoria_congelada jsonb not null default '{}'::jsonb,
  lecciones_origen jsonb not null default '[]'::jsonb,
  resultados_eval jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now()
);
--> statement-breakpoint
create unique index version_puesto_tenant_puesto_numero_key on version_puesto (tenant_id, puesto_id, numero);
--> statement-breakpoint
create index version_puesto_tenant_creado_idx on version_puesto (tenant_id, creado_en);
--> statement-breakpoint

alter table departamento
  add constraint departamento_supervisor_puesto_fk
  foreign key (supervisor_puesto_id) references puesto (id) on delete restrict;
--> statement-breakpoint
alter table puesto
  add constraint puesto_version_activa_fk
  foreign key (version_activa_id) references version_puesto (id) on delete restrict;
--> statement-breakpoint

create table habilidad (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  nombre text not null,
  version bigint not null default 1,
  pasos jsonb not null default '[]'::jsonb,
  comprobaciones jsonb not null default '[]'::jsonb,
  casos_que_aplican jsonb not null default '[]'::jsonb,
  activa boolean not null default false,
  creado_en timestamptz not null default now()
);
--> statement-breakpoint
create unique index habilidad_tenant_nombre_version_key on habilidad (tenant_id, nombre, version);
--> statement-breakpoint
create index habilidad_tenant_activa_idx on habilidad (tenant_id, activa, creado_en);
--> statement-breakpoint

create table habilidad_version_puesto (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  habilidad_id uuid not null references habilidad (id) on delete restrict,
  version_puesto_id uuid not null references version_puesto (id) on delete restrict,
  version_habilidad_fijada bigint not null,
  creado_en timestamptz not null default now()
);
--> statement-breakpoint
create unique index habilidad_version_puesto_key on habilidad_version_puesto (tenant_id, habilidad_id, version_puesto_id);
--> statement-breakpoint
create index habilidad_version_puesto_tenant_version_idx on habilidad_version_puesto (tenant_id, version_puesto_id);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Trabajo: tarea, paso, delegación, aprobación, disparador.
-- ---------------------------------------------------------------------------
create table tarea (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  tarea_raiz_id uuid references tarea (id) on delete restrict,
  tarea_padre_id uuid references tarea (id) on delete restrict,
  puesto_id uuid not null references puesto (id) on delete restrict,
  version_puesto_id uuid not null references version_puesto (id) on delete restrict,
  origen origen_tarea not null,
  origen_referencia_id uuid,
  estado estado_tarea not null default 'pendiente',
  flujo_temporal_id text,
  ejecucion_temporal_id text,
  presupuesto_euros numeric(12, 4) not null default 0,
  coste_euros numeric(12, 4) not null default 0,
  resultado jsonb not null default '{}'::jsonb,
  proyectado_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
--> statement-breakpoint
create index tarea_tenant_estado_creado_idx on tarea (tenant_id, estado, creado_en);
--> statement-breakpoint
create index tarea_tenant_puesto_creado_idx on tarea (tenant_id, puesto_id, creado_en);
--> statement-breakpoint
create index tarea_tenant_raiz_idx on tarea (tenant_id, tarea_raiz_id);
--> statement-breakpoint
create index tarea_tenant_creado_idx on tarea (tenant_id, creado_en);
--> statement-breakpoint

create table paso (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  tarea_id uuid not null references tarea (id) on delete restrict,
  version_puesto_id uuid not null references version_puesto (id) on delete restrict,
  numero integer not null,
  tipo text not null,
  herramienta text,
  entrada jsonb not null default '{}'::jsonb,
  salida jsonb not null default '{}'::jsonb,
  resultado resultado_accion not null default 'exito',
  coste_euros numeric(12, 4) not null default 0,
  duracion_ms integer not null default 0,
  creado_en timestamptz not null default now()
);
--> statement-breakpoint
create unique index paso_tenant_tarea_numero_key on paso (tenant_id, tarea_id, numero);
--> statement-breakpoint
create index paso_tenant_creado_idx on paso (tenant_id, creado_en);
--> statement-breakpoint

create table delegacion (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  tarea_origen_id uuid not null references tarea (id) on delete restrict,
  tarea_destino_id uuid references tarea (id) on delete restrict,
  puesto_origen_id uuid not null references puesto (id) on delete restrict,
  puesto_destino_id uuid not null references puesto (id) on delete restrict,
  encargo text not null,
  plazo timestamptz,
  presupuesto_euros numeric(12, 4) not null default 0,
  formato jsonb not null default '{}'::jsonb,
  cruza_departamento boolean not null default false,
  resultado jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
--> statement-breakpoint
create index delegacion_tenant_origen_idx on delegacion (tenant_id, tarea_origen_id);
--> statement-breakpoint
create index delegacion_tenant_destino_idx on delegacion (tenant_id, puesto_destino_id, creado_en);
--> statement-breakpoint

-- La aprobación es inmutable: se inserta cuando el agente pide permiso y no se
-- toca nunca más. Resolverla inserta una fila en `decision_aprobacion` (ADR-005).
create table aprobacion (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  tarea_id uuid not null references tarea (id) on delete restrict,
  paso_id uuid references paso (id) on delete restrict,
  persona_id uuid references persona (id) on delete restrict,
  clase_accion text not null,
  nivel_exigido nivel_autonomia not null,
  borrador_opaco jsonb not null default '{}'::jsonb,
  resumen_legible text not null,
  vence_en timestamptz,
  creado_en timestamptz not null default now()
);
--> statement-breakpoint
create index aprobacion_tenant_tarea_idx on aprobacion (tenant_id, tarea_id);
--> statement-breakpoint
create index aprobacion_tenant_persona_idx on aprobacion (tenant_id, persona_id, creado_en);
--> statement-breakpoint
create index aprobacion_tenant_clase_idx on aprobacion (tenant_id, clase_accion, creado_en);
--> statement-breakpoint

-- Una fila por decisión, una decisión por aprobación. La unicidad es lo que hace
-- fiable la consulta «aprobaciones sin decisión» del panel.
create table decision_aprobacion (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  aprobacion_id uuid not null references aprobacion (id) on delete restrict,
  persona_id uuid references persona (id) on delete restrict,
  sentido sentido_decision not null,
  motivo text,
  edicion_previa jsonb,
  creado_en timestamptz not null default now()
);
--> statement-breakpoint
create unique index decision_aprobacion_tenant_aprobacion_key on decision_aprobacion (tenant_id, aprobacion_id);
--> statement-breakpoint
create index decision_aprobacion_tenant_sentido_idx on decision_aprobacion (tenant_id, sentido, creado_en);
--> statement-breakpoint
create index decision_aprobacion_tenant_persona_idx on decision_aprobacion (tenant_id, persona_id, creado_en);
--> statement-breakpoint

create table disparador (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  tipo tipo_disparador not null,
  puesto_id uuid not null references puesto (id) on delete restrict,
  propietario_persona_id uuid references persona (id) on delete restrict,
  nivel nivel_autonomia not null default 'n0',
  presupuesto_euros numeric(12, 4) not null default 0,
  configuracion jsonb not null default '{}'::jsonb,
  activo boolean not null default false,
  disparos_acumulados bigint not null default 0,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
--> statement-breakpoint
create index disparador_tenant_activo_idx on disparador (tenant_id, activo, tipo);
--> statement-breakpoint
create index disparador_tenant_puesto_idx on disparador (tenant_id, puesto_id);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Aprendizaje. `senal` va particionada por mes.
-- ---------------------------------------------------------------------------
create table senal (
  id uuid not null default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  puesto_id uuid not null references puesto (id) on delete restrict,
  tipo tipo_senal not null,
  origen text not null,
  aprobacion_id uuid,
  tarea_id uuid,
  contenido jsonb not null default '{}'::jsonb,
  evaluacion jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now(),
  constraint senal_pkey primary key (id, creado_en)
) partition by range (creado_en);
--> statement-breakpoint
create index senal_tenant_puesto_creado_idx on senal (tenant_id, puesto_id, creado_en);
--> statement-breakpoint
create index senal_tenant_tipo_creado_idx on senal (tenant_id, tipo, creado_en);
--> statement-breakpoint

create table leccion (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  puesto_id uuid not null references puesto (id) on delete restrict,
  titulo text not null,
  contenido jsonb not null default '{}'::jsonb,
  parametros jsonb not null default '{}'::jsonb,
  estado estado_leccion not null default 'propuesta',
  creado_en timestamptz not null default now()
);
--> statement-breakpoint
create index leccion_tenant_estado_creado_idx on leccion (tenant_id, estado, creado_en);
--> statement-breakpoint
create index leccion_tenant_puesto_idx on leccion (tenant_id, puesto_id, creado_en);
--> statement-breakpoint

create table leccion_senal (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  leccion_id uuid not null references leccion (id) on delete restrict,
  senal_id uuid not null,
  senal_creado_en timestamptz not null,
  creado_en timestamptz not null default now()
);
--> statement-breakpoint
create unique index leccion_senal_key on leccion_senal (tenant_id, leccion_id, senal_id);
--> statement-breakpoint
create index leccion_senal_tenant_senal_idx on leccion_senal (tenant_id, senal_id);
--> statement-breakpoint

create table promocion (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  leccion_id uuid not null references leccion (id) on delete restrict,
  version_puesto_resultante_id uuid not null references version_puesto (id) on delete restrict,
  decidida_por_persona_id uuid references persona (id) on delete restrict,
  evidencia jsonb not null default '{}'::jsonb,
  resultados_eval jsonb not null default '{}'::jsonb,
  revertida_en timestamptz,
  creado_en timestamptz not null default now()
);
--> statement-breakpoint
create unique index promocion_tenant_leccion_version_key on promocion (tenant_id, leccion_id, version_puesto_resultante_id);
--> statement-breakpoint
create index promocion_tenant_creado_idx on promocion (tenant_id, creado_en);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Salas. `mensaje` va particionada por mes.
-- ---------------------------------------------------------------------------
create table sala (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  departamento_id uuid references departamento (id) on delete restrict,
  ambito ambito not null default 'departamento',
  nombre text not null,
  acuerdos jsonb not null default '[]'::jsonb,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
--> statement-breakpoint
create unique index sala_tenant_nombre_key on sala (tenant_id, nombre);
--> statement-breakpoint
create index sala_tenant_departamento_idx on sala (tenant_id, departamento_id);
--> statement-breakpoint

create table sala_participante (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  sala_id uuid not null references sala (id) on delete restrict,
  persona_id uuid references persona (id) on delete restrict,
  puesto_id uuid references puesto (id) on delete restrict,
  rol rol_participante not null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
--> statement-breakpoint
create unique index sala_participante_persona_key on sala_participante (tenant_id, sala_id, persona_id);
--> statement-breakpoint
create unique index sala_participante_puesto_key on sala_participante (tenant_id, sala_id, puesto_id);
--> statement-breakpoint
create index sala_participante_tenant_sala_idx on sala_participante (tenant_id, sala_id, rol);
--> statement-breakpoint

create table mensaje (
  id uuid not null default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  sala_id uuid not null references sala (id) on delete restrict,
  hilo_id uuid,
  autor_persona_id uuid references persona (id) on delete restrict,
  autor_puesto_id uuid references puesto (id) on delete restrict,
  cuerpo text not null,
  adjuntos jsonb not null default '[]'::jsonb,
  creado_en timestamptz not null default now(),
  constraint mensaje_pkey primary key (id, creado_en)
) partition by range (creado_en);
--> statement-breakpoint
create index mensaje_tenant_sala_creado_idx on mensaje (tenant_id, sala_id, creado_en);
--> statement-breakpoint
create index mensaje_tenant_hilo_creado_idx on mensaje (tenant_id, hilo_id, creado_en);
--> statement-breakpoint

create table intervencion (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  sala_id uuid not null references sala (id) on delete restrict,
  mensaje_id uuid not null,
  mensaje_creado_en timestamptz not null,
  tarea_id uuid references tarea (id) on delete restrict,
  moderador_puesto_id uuid references puesto (id) on delete restrict,
  motivo text not null,
  creado_en timestamptz not null default now()
);
--> statement-breakpoint
create index intervencion_tenant_sala_creado_idx on intervencion (tenant_id, sala_id, creado_en);
--> statement-breakpoint
create index intervencion_tenant_mensaje_idx on intervencion (tenant_id, mensaje_id);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Operaciones de organización.
-- ---------------------------------------------------------------------------
create table propuesta_operacion (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  tipo tipo_operacion not null,
  actor_tipo tipo_actor not null,
  actor_persona_id uuid references persona (id) on delete restrict,
  actor_puesto_id uuid references puesto (id) on delete restrict,
  resumen text not null,
  entidades_tocadas jsonb not null default '[]'::jsonb,
  efectos_previstos jsonb not null default '{}'::jsonb,
  coste_estimado_euros numeric(12, 4) not null default 0,
  evidencia jsonb not null default '{}'::jsonb,
  nivel_exigido nivel_autonomia not null default 'n0',
  estado estado_propuesta not null default 'borrador',
  decidida_por_persona_id uuid references persona (id) on delete restrict,
  motivo_decision text,
  forma_reversion jsonb not null default '{}'::jsonb,
  ejecutada_en timestamptz,
  revertida_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
--> statement-breakpoint
create index propuesta_operacion_tenant_estado_idx on propuesta_operacion (tenant_id, estado, creado_en);
--> statement-breakpoint
create index propuesta_operacion_tenant_tipo_idx on propuesta_operacion (tenant_id, tipo, creado_en);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Conectores. Las credenciales se guardan cifradas y nunca van al modelo.
-- ---------------------------------------------------------------------------
create table conector (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  tipo tipo_conector not null,
  nombre text not null,
  credenciales_cifradas text,
  referencia_secreto text,
  herramientas_descubiertas jsonb not null default '[]'::jsonb,
  estado estado_conector not null default 'configurado',
  ultima_sincronizacion timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
--> statement-breakpoint
create unique index conector_tenant_nombre_key on conector (tenant_id, nombre);
--> statement-breakpoint
create index conector_tenant_estado_idx on conector (tenant_id, estado, creado_en);
--> statement-breakpoint

create table autorizacion_herramientas (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  puesto_id uuid not null references puesto (id) on delete restrict,
  conector_id uuid not null references conector (id) on delete restrict,
  lista_blanca jsonb not null default '[]'::jsonb,
  niveles_por_clase jsonb not null default '{}'::jsonb,
  concedida_por_persona_id uuid references persona (id) on delete restrict,
  revocada_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
--> statement-breakpoint
create unique index autorizacion_herramientas_key on autorizacion_herramientas (tenant_id, puesto_id, conector_id);
--> statement-breakpoint
create index autorizacion_herramientas_tenant_conector_idx on autorizacion_herramientas (tenant_id, conector_id);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Conocimiento y memoria con ámbito.
-- ---------------------------------------------------------------------------
create table documento_canonico (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  titulo text not null,
  contenido text not null,
  version integer not null default 1,
  propietario_persona_id uuid references persona (id) on delete restrict,
  ambito ambito not null default 'organizacion',
  ambito_id uuid,
  vigente boolean not null default true,
  revisado_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
--> statement-breakpoint
create unique index documento_canonico_tenant_titulo_version_key on documento_canonico (tenant_id, titulo, version);
--> statement-breakpoint
create index documento_canonico_tenant_vigente_idx on documento_canonico (tenant_id, vigente, ambito);
--> statement-breakpoint

create table fragmento_conocimiento (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  ambito ambito not null default 'organizacion',
  ambito_id uuid,
  fuente text not null,
  documento_origen_id uuid,
  version_documento integer not null default 1,
  texto text not null,
  embedding vector(1024),
  control_acceso jsonb not null default '{}'::jsonb,
  frescura timestamptz,
  categoria_especial boolean not null default false,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
--> statement-breakpoint
create index fragmento_conocimiento_tenant_ambito_idx on fragmento_conocimiento (tenant_id, ambito, ambito_id);
--> statement-breakpoint
create index fragmento_conocimiento_tenant_origen_idx on fragmento_conocimiento (tenant_id, documento_origen_id);
--> statement-breakpoint
create index fragmento_conocimiento_embedding_hnsw on fragmento_conocimiento using hnsw (embedding vector_cosine_ops);
--> statement-breakpoint

create table memoria (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  ambito ambito not null,
  ambito_id uuid,
  clave text not null,
  contenido text not null,
  embedding vector(1024),
  metadatos jsonb not null default '{}'::jsonb,
  categoria_especial boolean not null default false,
  caduca_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
--> statement-breakpoint
create index memoria_tenant_ambito_idx on memoria (tenant_id, ambito, ambito_id);
--> statement-breakpoint
create index memoria_tenant_caduca_idx on memoria (tenant_id, caduca_en);
--> statement-breakpoint
create index memoria_embedding_hnsw on memoria using hnsw (embedding vector_cosine_ops);
--> statement-breakpoint

create table entidad (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  tipo text not null,
  nombre text not null,
  identificadores jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
--> statement-breakpoint
create index entidad_tenant_tipo_nombre_idx on entidad (tenant_id, tipo, nombre);
--> statement-breakpoint
create index entidad_tenant_identificadores_idx on entidad using gin (identificadores);
--> statement-breakpoint

create table relacion (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  origen_id uuid not null references entidad (id) on delete restrict,
  destino_id uuid not null references entidad (id) on delete restrict,
  tipo text not null,
  atributos jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now()
);
--> statement-breakpoint
create unique index relacion_key on relacion (tenant_id, origen_id, destino_id, tipo);
--> statement-breakpoint
create index relacion_tenant_destino_idx on relacion (tenant_id, destino_id);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Indicadores, notificaciones y salida transaccional de eventos.
-- ---------------------------------------------------------------------------
create table indicador (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  clave text not null,
  definicion jsonb not null default '{}'::jsonb,
  formula text not null,
  fuentes jsonb not null default '[]'::jsonb,
  umbrales jsonb not null default '{}'::jsonb,
  ambito ambito not null default 'organizacion',
  ambito_id uuid,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
--> statement-breakpoint
create unique index indicador_tenant_clave_key on indicador (tenant_id, clave);
--> statement-breakpoint
create index indicador_tenant_ambito_idx on indicador (tenant_id, ambito, ambito_id);
--> statement-breakpoint

create table indicador_valor (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  indicador_id uuid not null references indicador (id) on delete restrict,
  periodo timestamptz not null,
  valor numeric(18, 6) not null,
  detalle jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now()
);
--> statement-breakpoint
create unique index indicador_valor_key on indicador_valor (tenant_id, indicador_id, periodo);
--> statement-breakpoint
create index indicador_valor_tenant_periodo_idx on indicador_valor (tenant_id, periodo);
--> statement-breakpoint

create table notificacion (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  destinatario_persona_id uuid not null references persona (id) on delete restrict,
  suplente_persona_id uuid references persona (id) on delete restrict,
  canal canal_notificacion not null,
  motivo text not null,
  entidad_tipo text not null,
  entidad_id uuid not null,
  estado estado_notificacion not null default 'pendiente',
  vence_en timestamptz,
  lote_id uuid,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
--> statement-breakpoint
create index notificacion_tenant_destinatario_estado_idx on notificacion (tenant_id, destinatario_persona_id, estado, creado_en);
--> statement-breakpoint
create index notificacion_tenant_vence_idx on notificacion (tenant_id, vence_en);
--> statement-breakpoint

create table evento_salida (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  tipo text not null,
  destino text not null,
  carga jsonb not null default '{}'::jsonb,
  estado estado_evento_salida not null default 'pendiente',
  intentos integer not null default 0,
  ultimo_error text,
  publicado_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
--> statement-breakpoint
create index evento_salida_tenant_estado_creado_idx on evento_salida (tenant_id, estado, creado_en);
--> statement-breakpoint
create index evento_salida_pendientes_idx on evento_salida (estado, creado_en);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Libro de auditoría y contador (`@aiw/ledger`).
-- La entrada referencia entidades por identificador, nunca por clave foránea,
-- para que sobreviva a purgas y archivados.
-- ---------------------------------------------------------------------------
create table entrada_auditoria (
  id uuid not null default uuid_generar_v7(),
  tenant_id uuid not null,
  numero_orden bigint not null,
  actor_tipo tipo_actor not null,
  actor_id uuid,
  puesto_id uuid,
  version_puesto_id uuid,
  tarea_id uuid,
  paso_id uuid,
  accion text not null,
  herramienta text,
  datos_referenciados jsonb not null default '[]'::jsonb,
  resultado resultado_accion not null,
  coste_euros numeric(12, 4) not null default 0,
  duracion_ms integer not null default 0,
  aprobada_por_persona_id uuid,
  leccion_aplicada_id uuid,
  nivel_aplicado nivel_autonomia,
  cambio_de_nivel jsonb,
  hash_anterior text,
  hash text not null,
  creado_en timestamptz not null default now(),
  constraint entrada_auditoria_pkey primary key (id, creado_en)
) partition by range (creado_en);
--> statement-breakpoint
create index entrada_auditoria_tenant_orden_idx on entrada_auditoria (tenant_id, numero_orden desc);
--> statement-breakpoint
create index entrada_auditoria_tenant_creado_idx on entrada_auditoria (tenant_id, creado_en desc);
--> statement-breakpoint
create index entrada_auditoria_tenant_puesto_creado_idx on entrada_auditoria (tenant_id, puesto_id, creado_en desc);
--> statement-breakpoint
create index entrada_auditoria_tenant_tarea_idx on entrada_auditoria (tenant_id, tarea_id, creado_en desc);
--> statement-breakpoint

create table contador_consumo (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  periodo date not null,
  tareas bigint not null default 0,
  pasos bigint not null default 0,
  acciones bigint not null default 0,
  coste_euros numeric(14, 4) not null default 0,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
--> statement-breakpoint
create unique index contador_consumo_tenant_periodo_key on contador_consumo (tenant_id, periodo);
--> statement-breakpoint

-- El libro no se actualiza ni se borra. La retención suelta particiones, no filas.
create or replace function aiw_libro_solo_insercion() returns trigger
language plpgsql
as $$
begin
  raise exception 'El libro de auditoría es append-only: % no está permitido sobre %',
    tg_op, tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;
--> statement-breakpoint
create trigger entrada_auditoria_sin_actualizar
  before update or delete on entrada_auditoria
  for each row execute function aiw_libro_solo_insercion();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Particionado por tiempo. La partición por defecto evita que una inserción
-- fuera de rango falle; el mantenimiento crea las del mes actual y el siguiente.
-- ---------------------------------------------------------------------------
-- Una partición hereda las políticas del padre cuando se consulta a través de él,
-- pero no cuando se consulta directamente. Se le ponen las suyas, y además se le
-- retiran los permisos: todo pasa por la tabla padre.
create or replace function aiw_proteger_particion(p_particion text)
returns void
language plpgsql
as $$
begin
  execute format('alter table %I enable row level security', p_particion);
  execute format('alter table %I force row level security', p_particion);
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = p_particion and policyname = p_particion || '_tenant'
  ) then
    execute format(
      'create policy %I on %I using (tenant_id = aiw_tenant_actual()) with check (tenant_id = aiw_tenant_actual())',
      p_particion || '_tenant', p_particion
    );
  end if;
  execute format('revoke all on %I from aiw_app', p_particion);
end;
$$;
--> statement-breakpoint

create or replace function crear_particion_mensual(p_tabla text, p_mes date)
returns text
language plpgsql
as $$
declare
  v_inicio date := date_trunc('month', p_mes)::date;
  v_fin date := (date_trunc('month', p_mes) + interval '1 month')::date;
  v_nombre text := format('%s_%s', p_tabla, to_char(v_inicio, 'YYYY_MM'));
begin
  if p_tabla not in ('entrada_auditoria', 'mensaje', 'senal') then
    raise exception 'Tabla no particionada por mes: %', p_tabla;
  end if;
  if to_regclass(quote_ident(v_nombre)) is not null then
    return v_nombre;
  end if;
  execute format(
    'create table %I partition of %I for values from (%L) to (%L)',
    v_nombre, p_tabla, v_inicio, v_fin
  );
  perform aiw_proteger_particion(v_nombre);
  return v_nombre;
end;
$$;
--> statement-breakpoint

create table entrada_auditoria_defecto partition of entrada_auditoria default;
--> statement-breakpoint
create table mensaje_defecto partition of mensaje default;
--> statement-breakpoint
create table senal_defecto partition of senal default;
--> statement-breakpoint

select crear_particion_mensual('entrada_auditoria', current_date);
--> statement-breakpoint
select crear_particion_mensual('entrada_auditoria', (current_date + interval '1 month')::date);
--> statement-breakpoint
select crear_particion_mensual('mensaje', current_date);
--> statement-breakpoint
select crear_particion_mensual('mensaje', (current_date + interval '1 month')::date);
--> statement-breakpoint
select crear_particion_mensual('senal', current_date);
--> statement-breakpoint
select crear_particion_mensual('senal', (current_date + interval '1 month')::date);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Seguridad a nivel de fila. `force` también para el propietario del esquema.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tabla text;
  v_tablas text[] := array[
    'persona', 'paquete_tareas', 'departamento', 'puesto', 'version_puesto',
    'habilidad', 'habilidad_version_puesto', 'tarea', 'paso', 'delegacion',
    'aprobacion', 'decision_aprobacion', 'disparador', 'senal', 'leccion',
    'leccion_senal', 'promocion',
    'sala', 'sala_participante', 'mensaje', 'intervencion', 'propuesta_operacion',
    'conector', 'autorizacion_herramientas', 'documento_canonico',
    'fragmento_conocimiento', 'memoria', 'entidad', 'relacion', 'indicador',
    'indicador_valor', 'notificacion', 'evento_salida', 'entrada_auditoria',
    'contador_consumo'
  ];
begin
  foreach v_tabla in array v_tablas loop
    execute format('alter table %I enable row level security', v_tabla);
    execute format('alter table %I force row level security', v_tabla);
    execute format(
      'create policy %I on %I using (tenant_id = aiw_tenant_actual()) with check (tenant_id = aiw_tenant_actual())',
      v_tabla || '_tenant', v_tabla
    );
  end loop;
end
$$;
--> statement-breakpoint

-- La organización es su propio tenant.
alter table organizacion enable row level security;
--> statement-breakpoint
alter table organizacion force row level security;
--> statement-breakpoint
create policy organizacion_tenant on organizacion
  using (id = aiw_tenant_actual())
  with check (id = aiw_tenant_actual());
--> statement-breakpoint

-- El paraguas cruza organizaciones: solo se lee, y solo el que pertenece al tenant.
-- Crearlo y cambiarlo es una operación de plataforma, no del rol de aplicación.
alter table organizacion_paraguas enable row level security;
--> statement-breakpoint
alter table organizacion_paraguas force row level security;
--> statement-breakpoint
create policy organizacion_paraguas_lectura on organizacion_paraguas
  for select
  using (
    exists (
      select 1 from organizacion o
      where o.paraguas_id = organizacion_paraguas.id
        and o.id = aiw_tenant_actual()
    )
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Permisos del rol de aplicación.
-- ---------------------------------------------------------------------------
grant usage on schema public to aiw_app;
--> statement-breakpoint
grant select, insert, update, delete on all tables in schema public to aiw_app;
--> statement-breakpoint
-- El libro solo admite inserciones.
revoke update, delete on entrada_auditoria from aiw_app;
--> statement-breakpoint
-- La tabla de migraciones es del migrador.
revoke all on migracion_aplicada from aiw_app;
--> statement-breakpoint
-- Las particiones no se tocan directamente: todo pasa por la tabla padre.
do $$
declare
  v_particion text;
begin
  for v_particion in
    select c.relname
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    join pg_class p on p.oid = i.inhparent
    where p.relname in ('entrada_auditoria', 'mensaje', 'senal')
  loop
    perform aiw_proteger_particion(v_particion);
  end loop;
end
$$;
--> statement-breakpoint
grant execute on function uuid_generar_v7() to aiw_app;
--> statement-breakpoint
grant execute on function aiw_tenant_actual() to aiw_app;
--> statement-breakpoint
revoke execute on function crear_particion_mensual(text, date) from public;
--> statement-breakpoint
