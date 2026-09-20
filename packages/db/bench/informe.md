VIGENTE

# Informe de carga · modelo de datos v1

Lo genera la prueba `packages/db/src/pruebas/carga.test.ts` con `AIW_PRUEBA_CARGA=1`.
Vuelve a generarlo cuando cambien el esquema, los índices o la versión de PostgreSQL.

- Fecha: 2026-09-20T11:49:26.859Z
- PostgreSQL: PostgreSQL 16.13
- Máquina: linux x64, 4 núcleos
- Entradas de auditoría: 1.000.000
- Mensajes de sala: 100.000
- Límite del plan: 200 ms en el percentil 95

## Consultas del panel

| Consulta | Repeticiones | p50 (ms) | p95 (ms) | Máximo (ms) |
| --- | --- | --- | --- | --- |
| últimas entradas de auditoría del puesto | 50 | 0.42 | 1.16 | 1.42 |
| contador del periodo | 50 | 0.17 | 0.35 | 0.73 |
| últimos mensajes de la sala | 50 | 0.43 | 0.94 | 1.22 |
| aprobaciones sin decisión de la persona | 50 | 0.23 | 0.46 | 0.78 |

## Planes

### últimas entradas de auditoría del puesto

```
Limit  (cost=0.70..7.70 rows=50 width=44)
  ->  Merge Append  (cost=0.70..140030.86 rows=1000022 width=44)
        Sort Key: entrada_auditoria.creado_en DESC
        ->  Index Scan using entrada_auditoria_2026_09_tenant_id_creado_en_idx on entrada_auditoria_2026_09 entrada_auditoria_1  (cost=0.42..127089.45 rows=1000020 width=44)
              Index Cond: (tenant_id = '01a0bea5-f7a0-7fd3-ae95-5d69e96e7cef'::uuid)
              Filter: (puesto_id = '01a0bea5-f7a6-7ea4-bd2e-b0a77c4e7bdc'::uuid)
        ->  Index Scan using entrada_auditoria_2026_10_tenant_id_puesto_id_creado_en_idx on entrada_auditoria_2026_10 entrada_auditoria_2  (cost=0.12..8.14 rows=1 width=76)
              Index Cond: ((tenant_id = '01a0bea5-f7a0-7fd3-ae95-5d69e96e7cef'::uuid) AND (puesto_id = '01a0bea5-f7a6-7ea4-bd2e-b0a77c4e7bdc'::uuid))
        ->  Index Scan using entrada_auditoria_defecto_tenant_id_puesto_id_creado_en_idx on entrada_auditoria_defecto entrada_auditoria_3  (cost=0.12..8.14 rows=1 width=76)
              Index Cond: ((tenant_id = '01a0bea5-f7a0-7fd3-ae95-5d69e96e7cef'::uuid) AND (puesto_id = '01a0bea5-f7a6-7ea4-bd2e-b0a77c4e7bdc'::uuid))
```

### contador del periodo

```
Index Scan using contador_consumo_tenant_periodo_key on contador_consumo  (cost=0.16..8.18 rows=1 width=42)
  Index Cond: ((tenant_id = '01a0bea5-f7a0-7fd3-ae95-5d69e96e7cef'::uuid) AND (periodo = (date_trunc('month'::text, now()))::date))
```

### últimos mensajes de la sala

```
Limit  (cost=0.69..12.56 rows=100 width=48)
  ->  Merge Append  (cost=0.69..11869.90 rows=100003 width=48)
        Sort Key: mensaje.creado_en DESC
        ->  Index Scan Backward using mensaje_2026_09_tenant_id_sala_id_creado_en_idx on mensaje_2026_09 mensaje_1  (cost=0.42..10561.06 rows=100001 width=48)
              Index Cond: ((tenant_id = '01a0bea5-f7a0-7fd3-ae95-5d69e96e7cef'::uuid) AND (sala_id = '01a0bea5-f7b5-7a0d-bc72-287bbba15cb3'::uuid))
        ->  Index Scan Backward using mensaje_2026_10_tenant_id_sala_id_creado_en_idx on mensaje_2026_10 mensaje_2  (cost=0.12..8.14 rows=1 width=56)
              Index Cond: ((tenant_id = '01a0bea5-f7a0-7fd3-ae95-5d69e96e7cef'::uuid) AND (sala_id = '01a0bea5-f7b5-7a0d-bc72-287bbba15cb3'::uuid))
        ->  Index Scan Backward using mensaje_defecto_tenant_id_sala_id_creado_en_idx on mensaje_defecto mensaje_3  (cost=0.12..8.14 rows=1 width=56)
              Index Cond: ((tenant_id = '01a0bea5-f7a0-7fd3-ae95-5d69e96e7cef'::uuid) AND (sala_id = '01a0bea5-f7b5-7a0d-bc72-287bbba15cb3'::uuid))
```

### aprobaciones sin decisión de la persona

```
Limit  (cost=0.29..16.35 rows=1 width=56)
  ->  Nested Loop Anti Join  (cost=0.29..16.35 rows=1 width=56)
        ->  Index Scan Backward using aprobacion_tenant_persona_idx on aprobacion a  (cost=0.15..8.17 rows=1 width=72)
              Index Cond: ((tenant_id = '01a0bea5-f7a0-7fd3-ae95-5d69e96e7cef'::uuid) AND (persona_id = '01a0bea5-f7a3-7d60-97e7-e01c1186dd23'::uuid))
        ->  Index Only Scan using decision_aprobacion_tenant_aprobacion_key on decision_aprobacion d  (cost=0.15..8.17 rows=1 width=32)
              Index Cond: ((tenant_id = '01a0bea5-f7a0-7fd3-ae95-5d69e96e7cef'::uuid) AND (aprobacion_id = a.id))
```
