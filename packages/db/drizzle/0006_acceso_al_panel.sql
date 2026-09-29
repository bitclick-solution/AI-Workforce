-- Acceso al panel: tablas de Better Auth, rol de identidad y su seguridad de fila
-- (ADR-002, ADR-007; rebanada «Acceso al panel»).
--
-- El acceso ocurre antes de saber el tenant: quien pide un enlace da un correo y
-- quien presenta una cookie da un token. Por eso estas tablas las lee un rol propio,
-- `aiw_identidad`, que ve todas sus filas y no tiene ningún permiso sobre el resto
-- del modelo. `aiw_app` no tiene ningún permiso sobre ellas: una consulta de negocio
-- no puede leer un token de sesión, ni siquiera de su propio tenant.
--
-- La sesión lleva `tenant_id` y `persona_id`, y los copia de `usuario` un disparador
-- al insertar: ni Better Auth ni la aplicación los eligen. Ese tenant es el que la
-- API fija después en `aiw.tenant_id` para todo lo demás.
--
-- Autocontenida: solo usa objetos de la migración inicial (aiw_migrador,
-- uuid_generar_v7(), aiw_tenant_actual(), organizacion y persona) y no altera
-- ninguna tabla existente, así que no depende del orden respecto a otras 000N.
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

-- El rol se crea antes de asumir aiw_migrador, que no puede crear roles.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'aiw_identidad') then
    create role aiw_identidad nologin;
  end if;
end
$$;
--> statement-breakpoint

-- Local a la transacción: las tablas nuevas quedan a nombre de aiw_migrador.
set local role aiw_migrador;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------
create table usuario (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  persona_id uuid not null references persona (id) on delete restrict,
  nombre text not null,
  correo text not null,
  correo_verificado boolean not null default false,
  imagen text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint usuario_correo_en_minusculas check (correo = lower(btrim(correo)) and length(correo) > 3)
);
--> statement-breakpoint
create unique index usuario_correo_key on usuario (correo);
--> statement-breakpoint
create unique index usuario_persona_key on usuario (persona_id);
--> statement-breakpoint
create index usuario_tenant_idx on usuario (tenant_id, creado_en);
--> statement-breakpoint

create table sesion (
  id uuid primary key default uuid_generar_v7(),
  tenant_id uuid not null references organizacion (id) on delete restrict,
  persona_id uuid not null references persona (id) on delete restrict,
  usuario_id uuid not null references usuario (id) on delete restrict,
  token text not null,
  caduca_en timestamptz not null,
  ip text,
  agente_usuario text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
--> statement-breakpoint
create unique index sesion_token_key on sesion (token);
--> statement-breakpoint
create index sesion_tenant_idx on sesion (tenant_id, creado_en);
--> statement-breakpoint
create index sesion_usuario_idx on sesion (usuario_id);
--> statement-breakpoint

-- Sin contraseñas ni OAuth: el acceso es por enlace y por passkey.
create table cuenta (
  id uuid primary key default uuid_generar_v7(),
  usuario_id uuid not null references usuario (id) on delete restrict,
  cuenta_id text not null,
  proveedor_id text not null,
  token_acceso text,
  token_refresco text,
  token_identidad text,
  token_acceso_caduca_en timestamptz,
  token_refresco_caduca_en timestamptz,
  alcance text,
  contrasena text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint cuenta_sin_credenciales check (
    contrasena is null and token_acceso is null and token_refresco is null and token_identidad is null
  )
);
--> statement-breakpoint
create index cuenta_usuario_idx on cuenta (usuario_id);
--> statement-breakpoint

-- El `id` es texto y no UUID: Better Auth reserva el un solo uso de un enlace
-- insertando una fila con un `id` derivado del token (un hash en base64url), y es
-- la clave primaria la que hace que el segundo intento choque.
create table verificacion (
  id text primary key default uuid_generar_v7()::text,
  identificador text not null,
  valor text not null,
  caduca_en timestamptz not null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
--> statement-breakpoint
create index verificacion_identificador_idx on verificacion (identificador);
--> statement-breakpoint

create table clave_acceso (
  id uuid primary key default uuid_generar_v7(),
  usuario_id uuid not null references usuario (id) on delete restrict,
  nombre text,
  clave_publica text not null,
  credencial_id text not null,
  contador bigint not null,
  tipo_dispositivo text not null,
  respaldada boolean not null,
  transportes text,
  aaguid text,
  creado_en timestamptz default now()
);
--> statement-breakpoint
create unique index clave_acceso_credencial_key on clave_acceso (credencial_id);
--> statement-breakpoint
create index clave_acceso_usuario_idx on clave_acceso (usuario_id);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- La sesión hereda tenant y persona de su usuario, y no los cambia nunca.
-- ---------------------------------------------------------------------------
create or replace function aiw_sesion_de_usuario() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.usuario_id is distinct from old.usuario_id
      or new.tenant_id is distinct from old.tenant_id
      or new.persona_id is distinct from old.persona_id
      or new.token is distinct from old.token then
      raise exception 'Una sesión no cambia de usuario, tenant, persona ni token.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  select u.tenant_id, u.persona_id into new.tenant_id, new.persona_id
  from usuario u
  where u.id = new.usuario_id;
  if not found then
    raise exception 'La sesión apunta a un usuario que no existe.'
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger sesion_de_usuario
  before insert or update on sesion
  for each row execute function aiw_sesion_de_usuario();
--> statement-breakpoint

-- Un usuario no se muda de tenant ni de persona: eso sería otra identidad.
create or replace function aiw_usuario_sin_mudanza() returns trigger
language plpgsql
as $$
begin
  if new.tenant_id is distinct from old.tenant_id or new.persona_id is distinct from old.persona_id then
    raise exception 'Un usuario no cambia de tenant ni de persona.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger usuario_sin_mudanza
  before update on usuario
  for each row execute function aiw_usuario_sin_mudanza();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Seguridad a nivel de fila. `force` también para el dueño del esquema.
--
-- `aiw_identidad` ve todas las filas de estas cinco tablas: el acceso ocurre antes
-- de saber el tenant. El resto de roles solo ven las del tenant de la sesión, que
-- es lo que usa la purga de una organización.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tabla text;
  v_tablas text[] := array['usuario', 'sesion', 'cuenta', 'verificacion', 'clave_acceso'];
begin
  foreach v_tabla in array v_tablas loop
    execute format('alter table %I enable row level security', v_tabla);
    execute format('alter table %I force row level security', v_tabla);
    execute format(
      'create policy %I on %I to aiw_identidad using (true) with check (true)',
      v_tabla || '_identidad', v_tabla
    );
  end loop;
end
$$;
--> statement-breakpoint
create policy usuario_tenant on usuario
  using (tenant_id = aiw_tenant_actual())
  with check (tenant_id = aiw_tenant_actual());
--> statement-breakpoint
create policy sesion_tenant on sesion
  using (tenant_id = aiw_tenant_actual())
  with check (tenant_id = aiw_tenant_actual());
--> statement-breakpoint
create policy cuenta_tenant on cuenta
  using (exists (select 1 from usuario u where u.id = cuenta.usuario_id and u.tenant_id = aiw_tenant_actual()));
--> statement-breakpoint
create policy clave_acceso_tenant on clave_acceso
  using (exists (select 1 from usuario u where u.id = clave_acceso.usuario_id and u.tenant_id = aiw_tenant_actual()));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Permisos. `aiw_identidad` solo toca sus cinco tablas; `aiw_app`, ninguna.
-- ---------------------------------------------------------------------------
grant usage on schema public to aiw_identidad;
--> statement-breakpoint
grant select, insert, update, delete on usuario, sesion, cuenta, verificacion, clave_acceso to aiw_identidad;
--> statement-breakpoint
grant execute on function uuid_generar_v7() to aiw_identidad;
--> statement-breakpoint
grant execute on function aiw_tenant_actual() to aiw_identidad;
--> statement-breakpoint
revoke all on usuario, sesion, cuenta, verificacion, clave_acceso from aiw_app;
--> statement-breakpoint
