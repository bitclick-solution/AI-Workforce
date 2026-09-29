-- Última lectura de cada participante en su sala (rebanada «Sala v1 · salas por
-- equipo y presencia en vivo»). Nulo significa que nunca ha leído: todo lo que hay
-- en la sala está sin leer, que es lo que necesita «sin leer y menciones» en
-- `ResumenDeSala`. No es zona de auditoría: es una comodidad de lectura, se
-- sobrescribe en sitio y no entra en el libro ni en el contador.
--
-- La presencia en vivo de las personas (en la sala, escribiendo, inactivo) no se
-- guarda a propósito (ADR-022, «fuera de alcance»): no hay migración para ella.
--
-- Autocontenida: solo altera `sala_participante`, creada en `0000_inicial.sql`.
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

alter table sala_participante
  add column ultima_lectura_en timestamptz;
--> statement-breakpoint
