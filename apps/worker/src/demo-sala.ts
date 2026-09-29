/**
 * Demostración de la sala v0, de punta a punta y con un solo comando.
 *
 *   AIW_PRUEBA_STACK=1 pnpm --filter @aiw/worker demo:sala --auto     # recorre y termina
 *   AIW_PRUEBA_STACK=1 pnpm --filter @aiw/worker demo:sala --servir   # deja la sala abierta
 *
 * Con `--auto`: siembra Finanzas con Cobros y la sala general, pregunta «¿cómo vamos
 * de cobros este mes?», espera la intervención de Cobros que elige el moderador,
 * escribe «contrata un agente de conciliación en Finanzas», enseña la propuesta del
 * Director, la confirma con la misma señal que manda el botón y termina con el
 * puesto en prueba, la cadena de auditoría verificada y el contador.
 *
 * Con `--servir`: siembra, deja el trabajador escuchando e imprime las variables
 * para `apps/api` y `apps/web`, para recorrer lo mismo desde `/panel/sala`.
 *
 * Necesita el Compose de desarrollo (`pnpm dev:up`) con la base migrada.
 */
import { conTenant, uuidV7 } from '@aiw/db';
import { verificarCadenaEnBase } from '@aiw/ledger';
import { idFlujoMensaje, idFlujoPropuesta, type EntradaMensajeDeSala } from '@aiw/rooms';
import { Client, Connection } from '@temporalio/client';
import { NativeConnection } from '@temporalio/worker';

import { BANDERA, leerConfiguracion } from './configuracion.js';
import { decisionDePropuesta, mensajeDeSala } from './flujos/index.js';
import { sembrarSala } from './semilla-sala.js';
import { montarTrabajador } from './trabajador.js';

const SERVIR = process.argv.includes('--servir');
const PREGUNTA = '¿cómo vamos de cobros este mes?';
const FRASE = 'contrata un agente de conciliación en Finanzas';

const configuracion = leerConfiguracion();
if (!configuracion.encendida) {
  console.error(`La demostración está detrás de una bandera: pon ${BANDERA}=1.`);
  process.exit(1);
}
if (configuracion.urlBaseDeDatos === undefined) {
  console.error('Falta DATABASE_URL. Levanta el Compose con `pnpm dev:up` y migra con');
  console.error('`pnpm --filter @aiw/db db:migrar`.');
  process.exit(1);
}
if (!configuracion.conectorDemoConfigurado) {
  console.error('Falta DEMO_CONECTOR_SECRETO. `pnpm dev:up` lo añade a .env; vuelve a cargarlo.');
  process.exit(1);
}

// En `--servir` la cola es la configurada, porque la API arranca los flujos en ella.
const cola = SERVIR
  ? configuracion.temporal.cola
  : `${configuracion.temporal.cola}-sala-${Date.now()}`;
const conexionTemporal = await NativeConnection.connect({
  address: configuracion.temporal.direccion,
});
const montado = await montarTrabajador({
  urlBaseDeDatos: configuracion.urlBaseDeDatos,
  cola,
  espacio: configuracion.temporal.espacio,
  conexion: conexionTemporal,
});
const clienteTemporal = new Client({
  connection: await Connection.connect({ address: configuracion.temporal.direccion }),
  namespace: configuracion.temporal.espacio,
});
const cliente = montado.cliente;

console.log('— Sembrando Finanzas con Cobros (activo) y la sala general.');
const semilla = await sembrarSala(cliente, { nombre: `Sala v0 ${new Date().toISOString()}` });
console.log(`  organización: ${semilla.tenantId}`);
console.log(`  sala general: ${semilla.salaId}`);
console.log('');

if (SERVIR) {
  console.log('— Trabajador escuchando en la cola', cola);
  console.log('  Arranca la API y la web con estas variables y abre /panel/sala:');
  console.log(`    AIW_SALA_V0=1 AIW_SALA_TOKEN=<elige uno> AIW_TEMPORAL_COLA=${cola}`);
  console.log(
    '    AIW_ACCESO_PANEL=1 AIW_ACCESO_SECRETO=<secreto>, y entra en /acceso con una persona',
  );
  console.log(
    `    invitada: pnpm --filter @aiw/api invitar-propietario --tenant ${semilla.tenantId} --nombre … --correo …`,
  );
  console.log('  Ctrl+C para terminar.');
  await montado.trabajador.run();
  await montado.cerrar();
  process.exit(0);
}

/** Mensajes que aún no se han impreso, en orden. */
const vistos = new Set<string>();
async function mensajesNuevos() {
  const filas = await conTenant(cliente, semilla.tenantId, async (tx) => [
    ...(await tx<
      {
        id: string;
        cuerpo: string;
        persona: string | null;
        puesto: string | null;
        adjuntos: { tipo: string; agente?: string }[];
        creado_en: Date;
      }[]
    >`
      select m.id, m.cuerpo, pe.nombre as persona, pu.nombre as puesto, m.adjuntos, m.creado_en
      from mensaje m
      left join persona pe on pe.tenant_id = m.tenant_id and pe.id = m.autor_persona_id
      left join puesto pu on pu.tenant_id = m.tenant_id and pu.id = m.autor_puesto_id
      where m.tenant_id = ${semilla.tenantId}
      order by m.creado_en, m.id
    `),
  ]);
  const nuevas = filas.filter((fila) => !vistos.has(fila.id));
  for (const fila of nuevas) vistos.add(fila.id);
  return nuevas;
}

function autor(mensaje: Awaited<ReturnType<typeof mensajesNuevos>>[number]): string {
  const plataforma = mensaje.adjuntos.find((a) => a.tipo === 'autor_plataforma');
  if (plataforma) return plataforma.agente === 'moderador' ? 'Moderador' : 'Director de IA';
  return mensaje.persona ?? mensaje.puesto ?? '¿?';
}

async function escribir(texto: string) {
  const entrada: EntradaMensajeDeSala = {
    tenantId: semilla.tenantId,
    salaId: semilla.salaId,
    mensajeId: uuidV7(),
    personaId: semilla.personaId,
    texto,
  };
  const resultado = await clienteTemporal.workflow.execute(mensajeDeSala, {
    taskQueue: cola,
    workflowId: idFlujoMensaje(entrada.mensajeId),
    args: [entrada],
  });
  for (const mensaje of await mensajesNuevos()) {
    const plegado = mensaje.adjuntos.some((a) => a.tipo === 'moderacion') ? ' (plegado)' : '';
    console.log(`  ${autor(mensaje)}${plegado}: ${mensaje.cuerpo}`);
  }
  return resultado;
}

await montado.trabajador.runUntil(async () => {
  console.log('— 1. Pregunta en la sala general.');
  const pregunta = await escribir(PREGUNTA);
  console.log(
    `  intervenciones: ${pregunta.intervenciones.length}, estado ${pregunta.intervenciones[0]?.estado ?? '—'}`,
  );
  console.log('');

  console.log('— 2. Contratación desde una frase.');
  const frase = await escribir(FRASE);
  if (frase.propuestaId === null) throw new Error('El Director no propuso nada.');
  const [propuesta] = await conTenant(
    cliente,
    semilla.tenantId,
    (tx) =>
      tx<{ resumen: string; nivel_exigido: string; efectos_previstos: Record<string, unknown> }[]>`
      select resumen, nivel_exigido, efectos_previstos from propuesta_operacion
      where tenant_id = ${semilla.tenantId} and id = ${frase.propuestaId}
    `,
  );
  const efectos = propuesta?.efectos_previstos as {
    puesto: { ficha: { mision: string; tareas: string[] } };
    herramientas: { disponibles: { nombre: string }[]; porConectar: { nombre: string }[] };
    guardrails: { clase: string; regla: string }[];
    coste: { tareasMes: number; eurosMesCliente: number; eurosMesModelo: number };
  };
  console.log(`  propuesta:     ${propuesta?.resumen} (${propuesta?.nivel_exigido.toUpperCase()})`);
  console.log(`  misión:        ${efectos.puesto.ficha.mision}`);
  console.log(
    `  herramientas:  ${efectos.herramientas.disponibles.map((h) => h.nombre).join(', ')}`,
  );
  console.log(
    `  por conectar:  ${efectos.herramientas.porConectar.map((h) => h.nombre).join(', ')}`,
  );
  for (const guardrail of efectos.guardrails) {
    console.log(`  guardrail ${guardrail.clase.padEnd(7)} ${guardrail.regla}`);
  }
  console.log(
    `  coste:         ${efectos.coste.eurosMesCliente} €/mes para el cliente, ` +
      `${efectos.coste.tareasMes} tareas, ${efectos.coste.eurosMesModelo} € de modelos`,
  );
  console.log('');

  console.log('— 3. Un clic: confirmar.');
  const mango = clienteTemporal.workflow.getHandle(idFlujoPropuesta(frase.propuestaId));
  await mango.signal(decisionDePropuesta, { personaId: semilla.personaId, sentido: 'aprobada' });
  const hecho = (await mango.result()) as { estado: string; puestoId: string | null };
  for (const mensaje of await mensajesNuevos()) {
    console.log(`  ${autor(mensaje)}: ${mensaje.cuerpo}`);
  }
  const [puesto] = await conTenant(
    cliente,
    semilla.tenantId,
    (tx) =>
      tx<{ nombre: string; estado: string }[]>`
      select nombre, estado from puesto
      where tenant_id = ${semilla.tenantId} and id = ${hecho.puestoId}
    `,
  );
  console.log(`  propuesta ${hecho.estado}: ${puesto?.nombre} queda ${puesto?.estado}`);
  console.log('');
});

const verificacion = await conTenant(cliente, semilla.tenantId, (tx) =>
  verificarCadenaEnBase(tx, semilla.tenantId),
);
const acciones = await conTenant(cliente, semilla.tenantId, async (tx) => [
  ...(await tx<{ accion: string; n: string }[]>`
    select accion, count(*) as n from entrada_auditoria
    where tenant_id = ${semilla.tenantId} and (accion like 'sala.%' or accion like 'propuesta.%'
      or accion in ('puesto.contratado', 'tarea.contada'))
    group by accion order by accion
  `),
]);
console.log('— Libro de auditoría y contador.');
console.log(
  `  cadena verificada: ${verificacion.valida ? 'sí' : `no (${verificacion.motivo})`}, ${verificacion.entradas} entradas`,
);
for (const fila of acciones) console.log(`  ${fila.accion.padEnd(26)} ${fila.n}`);

// `runUntil` ya paró el trabajador: pararlo otra vez lanza `IllegalStateError`.
await montado.cerrar();
await conexionTemporal.close();
await clienteTemporal.connection.close();
process.exit(0);
