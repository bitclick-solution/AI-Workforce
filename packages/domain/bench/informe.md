VIGENTE

# Informe de carga · modelo de datos v1

Lo genera la prueba `packages/domain/src/pruebas/carga.test.ts` con `AIW_PRUEBA_CARGA=1`.
Vuelve a generarlo cuando cambien el esquema, los índices o la versión de PostgreSQL.

- Fecha: 2026-09-19T23:43:46.549Z
- PostgreSQL: PostgreSQL 16.13
- Máquina: linux x64, 4 núcleos
- Entradas de auditoría: 1.000.000
- Mensajes de sala: 100.000
- Límite del plan: 200 ms en el percentil 95

## Consultas del panel

| Consulta | Repeticiones | p50 (ms) | p95 (ms) | Máximo (ms) |
| --- | --- | --- | --- | --- |
| últimas entradas de auditoría del puesto | 50 | 0.49 | 1.35 | 1.74 |
| contador del periodo | 50 | 0.18 | 0.24 | 0.68 |
| últimos mensajes de la sala | 50 | 0.47 | 1.03 | 1.68 |
| aprobaciones pendientes de la persona | 50 | 0.25 | 0.34 | 1.13 |

## Planes

### últimas entradas de auditoría del puesto

```
Limit  (cost=0.70..7.70 rows=50 width=44)
  ->  Merge Append  (cost=0.70..140030.07 rows=999998 width=44)
        Sort Key: entrada_auditoria.creado_en DESC
        ->  Index Scan using entrada_auditoria_2026_09_tenant_id_creado_en_idx on entrada_auditoria_2026_09 entrada_auditoria_1  (cost=0.42..127088.97 rows=999996 width=44)
              Index Cond: (tenant_id = '01a0bc0d-7fe9-7820-afbf-6f202a5c297e'::uuid)
              Filter: (puesto_id = '01a0bc0d-7ff5-7edf-9143-293572b0d909'::uuid)
        ->  Index Scan using entrada_auditoria_2026_10_tenant_id_puesto_id_creado_en_idx on entrada_auditoria_2026_10 entrada_auditoria_2  (cost=0.12..8.14 rows=1 width=76)
              Index Cond: ((tenant_id = '01a0bc0d-7fe9-7820-afbf-6f202a5c297e'::uuid) AND (puesto_id = '01a0bc0d-7ff5-7edf-9143-293572b0d909'::uuid))
        ->  Index Scan using entrada_auditoria_defecto_tenant_id_puesto_id_creado_en_idx on entrada_auditoria_defecto entrada_auditoria_3  (cost=0.12..8.14 rows=1 width=76)
              Index Cond: ((tenant_id = '01a0bc0d-7fe9-7820-afbf-6f202a5c297e'::uuid) AND (puesto_id = '01a0bc0d-7ff5-7edf-9143-293572b0d909'::uuid))
```

### contador del periodo

```
Seq Scan on contador_consumo  (cost=0.00..1.00 rows=1 width=28)
  Filter: ((tenant_id = '01a0bc0d-7fe9-7820-afbf-6f202a5c297e'::uuid) AND (periodo = (date_trunc('month'::text, now()))::date))
```

### últimos mensajes de la sala

```
Limit  (cost=0.69..12.59 rows=100 width=48)
  ->  Merge Append  (cost=0.69..11901.67 rows=99996 width=48)
        Sort Key: mensaje.creado_en DESC
        ->  Index Scan Backward using mensaje_2026_09_tenant_id_sala_id_creado_en_idx on mensaje_2026_09 mensaje_1  (cost=0.42..10592.92 rows=99994 width=48)
              Index Cond: ((tenant_id = '01a0bc0d-7fe9-7820-afbf-6f202a5c297e'::uuid) AND (sala_id = '01a0bc0d-8007-74a7-a9e8-1d1a40fed170'::uuid))
        ->  Index Scan Backward using mensaje_2026_10_tenant_id_sala_id_creado_en_idx on mensaje_2026_10 mensaje_2  (cost=0.12..8.14 rows=1 width=56)
              Index Cond: ((tenant_id = '01a0bc0d-7fe9-7820-afbf-6f202a5c297e'::uuid) AND (sala_id = '01a0bc0d-8007-74a7-a9e8-1d1a40fed170'::uuid))
        ->  Index Scan Backward using mensaje_defecto_tenant_id_sala_id_creado_en_idx on mensaje_defecto mensaje_3  (cost=0.12..8.14 rows=1 width=56)
              Index Cond: ((tenant_id = '01a0bc0d-7fe9-7820-afbf-6f202a5c297e'::uuid) AND (sala_id = '01a0bc0d-8007-74a7-a9e8-1d1a40fed170'::uuid))
```

### aprobaciones pendientes de la persona

```
Limit  (cost=0.15..8.17 rows=1 width=56)
  ->  Index Scan Backward using aprobacion_tenant_persona_idx on aprobacion  (cost=0.15..8.17 rows=1 width=56)
        Index Cond: ((tenant_id = '01a0bc0d-7fe9-7820-afbf-6f202a5c297e'::uuid) AND (persona_id = '01a0bc0d-7fef-7c66-b4bb-1da5d857c813'::uuid))
        Filter: (decision = 'pendiente'::decision_aprobacion)
```
