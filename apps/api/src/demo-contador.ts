/**
 * Demo del contador de tareas v0. Script de operación, no camino de producción.
 *
 * Crea una organización de demostración con un puesto, una tarea raíz, una
 * delegación, una tarifa y unos usos de modelo, y deja la cabecera de tenant lista
 * para curl y para el panel. Todo lo que escribe pasa por los puntos de escritura
 * del contador, así que la demo es el mismo camino que usará el motor.
 *
 * Uso:
 *   DATABASE_URL=postgresql://... pnpm --filter @aiw/api demo:contador
 */
import { conTenant, crearConexion, uuidV7 } from '@aiw/db';
import { registrarTarifa, registrarTareaRaiz, registrarUsoDeModelo } from '@aiw/ledger';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('Falta DATABASE_URL. Arranca PostgreSQL y aplica las migraciones primero.');
  process.exit(1);
}

const { cliente, cerrar } = crearConexion({ url });
const tenantId = uuidV7();
const nombre = `Demo del contador ${new Date().toISOString().slice(0, 16)}`;

await conTenant(cliente, tenantId, async (tx) => {
  await tx`insert into organizacion (id, nombre, plan) values (${tenantId}, ${nombre}, 'departamento')`;
  const [persona] = await tx<{ id: string }[]>`
    insert into persona (tenant_id, nombre, correo)
    values (${tenantId}, 'Jesús', ${`jefatura+${tenantId.slice(0, 8)}@demo.local`})
    returning id
  `;
  const [departamento] = await tx<{ id: string }[]>`
    insert into departamento (tenant_id, nombre, supervisor_persona_id, estado)
    values (${tenantId}, 'Finanzas', ${persona?.id ?? null}, 'activo')
    returning id
  `;
  const [puesto] = await tx<{ id: string }[]>`
    insert into puesto (tenant_id, departamento_id, nombre, clase_riesgo, estado)
    values (${tenantId}, ${departamento?.id ?? null}, 'Contable', 'medio', 'activo')
    returning id
  `;
  const [version] = await tx<{ id: string }[]>`
    insert into version_puesto (tenant_id, puesto_id, numero, prompt, politica)
    values (${tenantId}, ${puesto?.id ?? null}, 1, 'Eres el contable.', '{}'::jsonb)
    returning id
  `;
  const puestoId = puesto?.id ?? '';
  const versionPuestoId = version?.id ?? '';

  const [raiz] = await tx<{ id: string }[]>`
    insert into tarea (tenant_id, puesto_id, version_puesto_id, origen, estado)
    values (${tenantId}, ${puestoId}, ${versionPuestoId}, 'sala', 'en_curso')
    returning id
  `;
  const raizId = raiz?.id ?? '';
  await tx`update tarea set tarea_raiz_id = ${raizId} where id = ${raizId}`;

  const [delegada] = await tx<{ id: string }[]>`
    insert into tarea (tenant_id, tarea_raiz_id, tarea_padre_id, puesto_id, version_puesto_id, origen, estado)
    values (${tenantId}, ${raizId}, ${raizId}, ${puestoId}, ${versionPuestoId}, 'delegacion', 'completada')
    returning id
  `;

  await registrarTarifa(tx, tenantId, {
    proveedor: 'anthropic',
    modelo: 'claude-haiku-4-5',
    eurosPorMillonEntrada: 1,
    eurosPorMillonSalida: 5,
    eurosPorMillonEntradaCache: 0.1,
    vigenteDesde: new Date('2026-01-01T00:00:00.000Z'),
    fuente: 'demo: catálogo de desarrollo',
  });

  const contada = await registrarTareaRaiz(tx, tenantId, {
    tareaId: raizId,
    puestoId,
    versionPuestoId,
  });
  // Y otra vez, para ver que el reintento no vuelve a sumar.
  const reintento = await registrarTareaRaiz(tx, tenantId, { tareaId: raizId, puestoId });

  const uso = await registrarUsoDeModelo(tx, tenantId, {
    tareaId: raizId,
    puestoId,
    versionPuestoId,
    proveedor: 'anthropic',
    modelo: 'claude-haiku-4-5',
    tokens: { entrada: 180_000, salida: 12_000, entradaCache: 60_000 },
    claveIdempotencia: `demo-${raizId}-1`,
  });

  const usoDelegado = await registrarUsoDeModelo(tx, tenantId, {
    tareaId: delegada?.id ?? raizId,
    puestoId,
    versionPuestoId,
    proveedor: 'anthropic',
    modelo: 'claude-haiku-4-5',
    tokens: { entrada: 40_000, salida: 3_000 },
    claveIdempotencia: `demo-${raizId}-2`,
  });

  console.log(`Organización de demostración: ${nombre}`);
  console.log(`Tenant:                       ${tenantId}`);
  console.log(`Tarea raíz:                    ${raizId} (contada: ${String(contada.conto)})`);
  console.log(`Reintento de la misma tarea:   contada de nuevo: ${String(reintento.conto)}`);
  console.log(`Uso de la raíz:                ${uso.costeEuros} € (tarifa ${uso.tarifaId})`);
  console.log(
    `Uso de la delegación:          ${usoDelegado.costeEuros} €, sumado a la raíz ${usoDelegado.tareaRaizId}`,
  );
  console.log('');
  console.log('Levanta la API y pregúntale:');
  console.log(
    `  AIW_CONTADOR_V0=1 AIW_CONTADOR_TOKEN=<token> DATABASE_URL=$DATABASE_URL pnpm --filter @aiw/api dev`,
  );
  console.log(
    `  curl -s -H "authorization: Bearer <token>" -H "x-aiw-tenant: ${tenantId}" http://127.0.0.1:3002/contador/periodo`,
  );
});

await cerrar();
