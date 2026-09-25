-- Reverso de la migración de región, moneda y caché de escritura en tarifa_modelo.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'aiw_migrador') then
    execute 'set local role aiw_migrador';
  end if;
end
$$;
--> statement-breakpoint

alter table tarifa_modelo
  drop constraint if exists tarifa_modelo_moneda_origen_no_vacia,
  drop constraint if exists tarifa_modelo_tipo_cambio_positivo,
  drop constraint if exists tarifa_modelo_precios_origen_no_negativos,
  drop constraint if exists tarifa_modelo_cache_escritura_no_negativa;
--> statement-breakpoint

alter table tarifa_modelo
  drop column if exists region,
  drop column if exists moneda_origen,
  drop column if exists tipo_cambio_a_euros,
  drop column if exists precio_origen_por_millon_entrada,
  drop column if exists precio_origen_por_millon_salida,
  drop column if exists precio_origen_por_millon_entrada_cache,
  drop column if exists euros_por_millon_entrada_cache_escritura_5m,
  drop column if exists euros_por_millon_entrada_cache_escritura_1h;
--> statement-breakpoint
