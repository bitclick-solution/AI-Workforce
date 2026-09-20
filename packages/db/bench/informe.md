VIGENTE

# Informe de carga · modelo de datos v1

Lo genera la prueba `packages/db/src/pruebas/carga.test.ts` con `AIW_PRUEBA_CARGA=1`.
Vuelve a generarlo cuando cambien el esquema, los índices o la versión de PostgreSQL.

- Fecha: 2026-09-20T08:03:08.135Z
- PostgreSQL: PostgreSQL 16.13
- Máquina: linux x64, 4 núcleos
- Entradas de auditoría: 1.000.000
- Mensajes de sala: 100.000
- Límite del plan: 200 ms en el percentil 95

## Consultas del panel

| Consulta | Repeticiones | p50 (ms) | p95 (ms) | Máximo (ms) |
| --- | --- | --- | --- | --- |
| últimas entradas de auditoría del puesto | 50 | 0.68 | 1.59 | 1.66 |
| contador del periodo | 50 | 0.19 | 0.55 | 1.06 |
| últimos mensajes de la sala | 50 | 0.48 | 1.05 | 1.28 |
| aprobaciones sin decisión de la persona | 50 | 0.28 | 0.73 | 1.76 |

## Planes

### últimas entradas de auditoría del puesto

```
Limit  (cost=0.70..7.70 rows=50 width=44)
  ->  Merge Append  (cost=0.70..140030.07 rows=999998 width=44)
        Sort Key: entrada_auditoria.creado_en DESC
        ->  Index Scan using entrada_auditoria_2026_09_tenant_id_creado_en_idx on entrada_auditoria_2026_09 entrada_auditoria_1  (cost=0.42..127088.97 rows=999996 width=44)
              Index Cond: (tenant_id = '01a0bdd6-bece-7c79-84cc-be86f560ad5b'::uuid)
              Filter: (puesto_id = '01a0bdd6-bed6-71c6-97b1-2c4965a3decf'::uuid)
        ->  Index Scan using entrada_auditoria_2026_10_tenant_id_puesto_id_creado_en_idx on entrada_auditoria_2026_10 entrada_auditoria_2  (cost=0.12..8.14 rows=1 width=76)
              Index Cond: ((tenant_id = '01a0bdd6-bece-7c79-84cc-be86f560ad5b'::uuid) AND (puesto_id = '01a0bdd6-bed6-71c6-97b1-2c4965a3decf'::uuid))
        ->  Index Scan using entrada_auditoria_defecto_tenant_id_puesto_id_creado_en_idx on entrada_auditoria_defecto entrada_auditoria_3  (cost=0.12..8.14 rows=1 width=76)
              Index Cond: ((tenant_id = '01a0bdd6-bece-7c79-84cc-be86f560ad5b'::uuid) AND (puesto_id = '01a0bdd6-bed6-71c6-97b1-2c4965a3decf'::uuid))
```

### contador del periodo

```
Index Scan using contador_consumo_tenant_periodo_key on contador_consumo  (cost=0.16..8.18 rows=1 width=42)
  Index Cond: ((tenant_id = '01a0bdd6-bece-7c79-84cc-be86f560ad5b'::uuid) AND (periodo = (date_trunc('month'::text, now()))::date))
```

### últimos mensajes de la sala

```
Limit  (cost=0.69..12.56 rows=100 width=48)
  ->  Merge Append  (cost=0.69..11869.90 rows=100003 width=48)
        Sort Key: mensaje.creado_en DESC
        ->  Index Scan Backward using mensaje_2026_09_tenant_id_sala_id_creado_en_idx on mensaje_2026_09 mensaje_1  (cost=0.42..10561.06 rows=100001 width=48)
              Index Cond: ((tenant_id = '01a0bdd6-bece-7c79-84cc-be86f560ad5b'::uuid) AND (sala_id = '01a0bdd6-bee5-7482-9c72-dc90e84086f8'::uuid))
        ->  Index Scan Backward using mensaje_2026_10_tenant_id_sala_id_creado_en_idx on mensaje_2026_10 mensaje_2  (cost=0.12..8.14 rows=1 width=56)
              Index Cond: ((tenant_id = '01a0bdd6-bece-7c79-84cc-be86f560ad5b'::uuid) AND (sala_id = '01a0bdd6-bee5-7482-9c72-dc90e84086f8'::uuid))
        ->  Index Scan Backward using mensaje_defecto_tenant_id_sala_id_creado_en_idx on mensaje_defecto mensaje_3  (cost=0.12..8.14 rows=1 width=56)
              Index Cond: ((tenant_id = '01a0bdd6-bece-7c79-84cc-be86f560ad5b'::uuid) AND (sala_id = '01a0bdd6-bee5-7482-9c72-dc90e84086f8'::uuid))
```

### aprobaciones sin decisión de la persona

```
Limit  (cost=0.29..16.35 rows=1 width=56)
  ->  Nested Loop Anti Join  (cost=0.29..16.35 rows=1 width=56)
        ->  Index Scan Backward using aprobacion_tenant_persona_idx on aprobacion a  (cost=0.15..8.17 rows=1 width=72)
              Index Cond: ((tenant_id = '01a0bdd6-bece-7c79-84cc-be86f560ad5b'::uuid) AND (persona_id = '01a0bdd6-bed2-7e13-8ecc-57866514a2bd'::uuid))
        ->  Index Only Scan using decision_aprobacion_tenant_aprobacion_key on decision_aprobacion d  (cost=0.15..8.17 rows=1 width=32)
              Index Cond: ((tenant_id = '01a0bdd6-bece-7c79-84cc-be86f560ad5b'::uuid) AND (aprobacion_id = a.id))
```
