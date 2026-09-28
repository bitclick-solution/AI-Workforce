-- Reverso del acceso al panel. Deja la base como estaba antes de
-- `0005_acceso_al_panel.sql`: sin las tablas de identidad, sin sus funciones y sin
-- el rol `aiw_identidad`.
--
-- No toca roles, funciones ni tablas de otras migraciones. El orden es de la hoja a
-- la raíz: sesión, cuenta y passkey referencian a `usuario`.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'aiw_migrador') then
    execute 'set local role aiw_migrador';
  end if;
end
$$;
--> statement-breakpoint

drop table if exists clave_acceso;
--> statement-breakpoint
drop table if exists cuenta;
--> statement-breakpoint
drop table if exists sesion;
--> statement-breakpoint
drop table if exists verificacion;
--> statement-breakpoint
drop table if exists usuario;
--> statement-breakpoint
drop function if exists aiw_sesion_de_usuario();
--> statement-breakpoint
drop function if exists aiw_usuario_sin_mudanza();
--> statement-breakpoint

reset role;
--> statement-breakpoint

-- `drop owned by` retira el uso del esquema y la ejecución de funciones que quedan.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'aiw_identidad') then
    execute 'drop owned by aiw_identidad';
    execute 'drop role aiw_identidad';
  end if;
end
$$;
--> statement-breakpoint
