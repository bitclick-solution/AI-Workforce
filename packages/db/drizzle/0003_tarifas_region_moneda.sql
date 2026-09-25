-- Región, moneda de origen y precio de escritura de caché en la tabla de tarifas
-- (decisión de Jesús, 2026-09-25, rebanada «Modelos v1»).
--
-- Bedrock cotiza en USD; el contador sigue cobrando en euros. Esta migración añade
-- de dónde sale el precio en euros —la región del partner, la moneda de origen y el
-- tipo de cambio aplicado, todo documental— y los dos precios de escritura de
-- caché (5 minutos y 1 hora de TTL) que Anthropic publica y que `tarifa_modelo`
-- todavía no tenía. Ninguna columna participa en `calcularCosteEuros`: siguen
-- siendo los `euros_por_millon_*` de la fila los que fijan el coste real, igual que
-- desde `0002_modelos_v1.sql`.
--
-- Todas las columnas llevan `default` o son nulas: ninguna tarifa ya registrada
-- cambia de significado.
--
-- Autocontenida: solo altera `tarifa_modelo`, creada en `0001_contador_uso_de_modelos.sql`.
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

alter table tarifa_modelo
  add column region text,
  add column moneda_origen text not null default 'eur',
  add column tipo_cambio_a_euros numeric(12, 6) not null default 1,
  add column precio_origen_por_millon_entrada numeric(14, 6),
  add column precio_origen_por_millon_salida numeric(14, 6),
  add column precio_origen_por_millon_entrada_cache numeric(14, 6),
  add column euros_por_millon_entrada_cache_escritura_5m numeric(14, 6) not null default 0,
  add column euros_por_millon_entrada_cache_escritura_1h numeric(14, 6) not null default 0;
--> statement-breakpoint

alter table tarifa_modelo
  add constraint tarifa_modelo_moneda_origen_no_vacia check (length(btrim(moneda_origen)) > 0),
  add constraint tarifa_modelo_tipo_cambio_positivo check (tipo_cambio_a_euros > 0),
  add constraint tarifa_modelo_precios_origen_no_negativos check (
    (precio_origen_por_millon_entrada is null or precio_origen_por_millon_entrada >= 0)
    and (precio_origen_por_millon_salida is null or precio_origen_por_millon_salida >= 0)
    and (precio_origen_por_millon_entrada_cache is null or precio_origen_por_millon_entrada_cache >= 0)
  ),
  add constraint tarifa_modelo_cache_escritura_no_negativa check (
    euros_por_millon_entrada_cache_escritura_5m >= 0
    and euros_por_millon_entrada_cache_escritura_1h >= 0
  );
--> statement-breakpoint
