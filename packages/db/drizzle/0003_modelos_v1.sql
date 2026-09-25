-- Modelos v1: modelo, esfuerzo por clase de paso y modelo de respaldo en la versión
-- de puesto; plataforma real y multiplicador documental en la tabla de tarifas
-- (ADR-017, ADR-018).
--
-- Zona crítica: toca `version_puesto` (versión de puesto) y el contador
-- (`tarifa_modelo`, `uso_modelo`). Las tres columnas nuevas llevan `default` para
-- que las filas ya escritas —inmutables— sigan siendo válidas sin reescribirlas:
-- corregirlas sería un `UPDATE` sobre una fila que el disparador de inmutabilidad
-- rechaza (ADR-007).
--
-- Autocontenida: solo altera tablas de `0000_inicial.sql` y `0001_contador_uso_de_modelos.sql`.
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

-- ---------------------------------------------------------------------------
-- Versión de puesto: modelo, esfuerzo por clase de paso y modelo de respaldo.
-- Validado por `configuracionModeloPuesto` de `@aiw/domain`, igual que `politica`.
-- ---------------------------------------------------------------------------
alter table version_puesto
  add column configuracion_modelo jsonb not null default '{}'::jsonb;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Tarifa de modelo: plataforma real (bedrock-eu, vertex-eu, primera-parte, ai-sdk)
-- y multiplicador documental frente a la lista oficial de Anthropic. El
-- multiplicador no participa en el cálculo del coste, que sigue leyendo los
-- `euros_por_millon_*` de la fila: es trazabilidad, no un factor en caliente.
--
-- El mismo proveedor y modelo puede tener una tarifa vigente distinta por
-- plataforma a la vez, así que la única pasa a incluir la plataforma.
-- ---------------------------------------------------------------------------
alter table tarifa_modelo
  add column plataforma text not null default 'primera-parte',
  add column multiplicador_lista_oficial numeric(10, 4) not null default 1;
--> statement-breakpoint

alter table tarifa_modelo
  add constraint tarifa_modelo_plataforma_no_vacia check (length(btrim(plataforma)) > 0),
  add constraint tarifa_modelo_multiplicador_positivo check (multiplicador_lista_oficial > 0);
--> statement-breakpoint

drop index tarifa_modelo_tenant_modelo_vigencia_key;
--> statement-breakpoint
create unique index tarifa_modelo_tenant_modelo_plataforma_vigencia_key
  on tarifa_modelo (tenant_id, proveedor, modelo, plataforma, vigente_desde);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Uso de modelo: qué plataforma sirvió la llamada, para el panel y la auditoría.
-- ---------------------------------------------------------------------------
alter table uso_modelo
  add column plataforma text not null default 'primera-parte';
--> statement-breakpoint
