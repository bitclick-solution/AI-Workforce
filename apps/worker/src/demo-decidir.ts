/**
 * Mandato `decidir`: produce la señal de decisión para la demostración.
 *
 * En producción esta señal la produce «Aprobación por correo v0»: la persona pulsa
 * un enlace firmado de un solo uso, `apps/channels` registra la decisión y la
 * entrega al flujo. Esta rebanada no toca esa aplicación; lo que hace es producir la
 * misma señal desde la línea de mandatos, con las mismas funciones de
 * `@aiw/ledger` y el mismo nombre de señal, para poder demostrar la espera y la
 * reanudación sin depender de un servidor de correo.
 *
 *   pnpm --filter @aiw/worker decidir <aprobacionId> aprobada|rechazada|editada \
 *     [--tenant <tenantId>] [--motivo "..."] [--texto "texto editado"]
 *
 * Con `editada`, `--texto` sustituye `argumentos.texto` del borrador: es la edición
 * más común —reescribir la nota antes de aprobarla— y la que el aprendizaje v0
 * convierte en lección. La edición completa, antes y después, queda en la decisión.
 *
 * El tenant hace falta y no se adivina: las políticas de RLS no dejan leer una
 * aprobación sin saber de quién es, y eso es exactamente lo que se quiere. Sale por
 * `--tenant` o por `AIW_TENANT`.
 */
import { crearConexion } from '@aiw/db';
import { SENTIDOS_DECISION, type SentidoDecision } from '@aiw/domain';
import { cargaDeSenal, leerAprobacion, registrarDecision } from '@aiw/ledger';
import { Client, Connection } from '@temporalio/client';
import { conTenant } from '@aiw/db';

import { leerConfiguracion } from './configuracion.js';
import { NOMBRE_SENAL_DECISION } from './flujos/index.js';

function valorDeBandera(argumentos: string[], nombre: string): string | undefined {
  const indice = argumentos.indexOf(`--${nombre}`);
  if (indice >= 0) return argumentos[indice + 1];
  const junto = argumentos.find((argumento) => argumento.startsWith(`--${nombre}=`));
  return junto?.slice(nombre.length + 3);
}

const argumentos = process.argv.slice(2);
const posicionales = argumentos.filter((argumento) => !argumento.startsWith('--'));
const aprobacionId = posicionales[0];
const sentidoBruto = posicionales[1];
const tenantId = valorDeBandera(argumentos, 'tenant') ?? process.env['AIW_TENANT'];
const motivo = valorDeBandera(argumentos, 'motivo');
const textoEditado = valorDeBandera(argumentos, 'texto');

function salirConAyuda(mensaje: string): never {
  console.error(`${mensaje}\n`);
  console.error(
    'Uso: pnpm --filter @aiw/worker decidir <aprobacionId> aprobada|rechazada|editada \\\n' +
      '       [--tenant <tenantId>] [--motivo "por qué"] [--texto "texto editado"]',
  );
  process.exit(1);
}

if (!aprobacionId) salirConAyuda('Falta el identificador de la aprobación.');
if (!sentidoBruto || !SENTIDOS_DECISION.includes(sentidoBruto as SentidoDecision)) {
  salirConAyuda(`El sentido tiene que ser uno de: ${SENTIDOS_DECISION.join(', ')}.`);
}
if (!tenantId) salirConAyuda('Falta el tenant: pásalo con --tenant o en AIW_TENANT.');
if (sentidoBruto === 'editada' && textoEditado === undefined) {
  salirConAyuda('Una decisión «editada» necesita la edición: pásala con --texto "…".');
}

const configuracion = leerConfiguracion();
if (configuracion.urlBaseDeDatos === undefined) {
  salirConAyuda('Falta DATABASE_URL: sin base no hay aprobación que decidir.');
}

const sentido = sentidoBruto as SentidoDecision;
const conexion = crearConexion({ url: configuracion.urlBaseDeDatos });

/** Lee el borrador y devuelve la edición con `argumentos.texto` sustituido. */
async function edicionDelTexto(texto: string) {
  const [fila] = await conTenant(
    conexion.cliente,
    tenantId as string,
    (tx) => tx<{ carga: { argumentos?: Record<string, unknown> } | null }[]>`
      select borrador_opaco->'carga' as carga from aprobacion
      where tenant_id = ${tenantId as string} and id = ${aprobacionId as string}
    `,
  );
  const antes = fila?.carga;
  if (!antes || typeof antes.argumentos !== 'object' || antes.argumentos === null) {
    salirConAyuda('El borrador de esta aprobación no tiene argumentos que editar.');
  }
  return { antes, despues: { ...antes, argumentos: { ...antes.argumentos, texto } } };
}

try {
  const edicionPrevia =
    sentido === 'editada' && textoEditado !== undefined
      ? await edicionDelTexto(textoEditado)
      : undefined;
  const resultado = await registrarDecision(conexion.cliente, tenantId, {
    aprobacionId,
    sentido,
    ...(motivo === undefined ? {} : { motivo }),
    ...(edicionPrevia === undefined ? {} : { edicionPrevia }),
    // `plataforma` porque la decisión entra por la línea de mandatos y no por un
    // enlace de correo. El canal no cambia lo que se decide, pero se audita.
    origen: 'plataforma',
    herramienta: 'decidir',
  });

  if (resultado.estado === 'rechazada_por_enlace') {
    console.error(`La decisión no se registró: ${resultado.motivo}.`);
    if (resultado.decisionPrevia) {
      console.error(
        `Ya estaba decidida como ${resultado.decisionPrevia.sentido} ` +
          `el ${resultado.decisionPrevia.creadoEn.toISOString()}.`,
      );
    }
    process.exit(2);
  }

  console.log(`Decisión registrada: ${sentido} (${resultado.decision.id}).`);

  const leida = await conTenant(conexion.cliente, tenantId, (tx) =>
    leerAprobacion(tx, tenantId, aprobacionId),
  );
  if (!leida?.flujoTemporalId) {
    console.log('La tarea no tiene flujo asociado: no hay a quién señalar.');
    process.exit(0);
  }

  const carga = cargaDeSenal(tenantId, leida, resultado.decision, 'plataforma', motivo);
  const conexionTemporal = await Connection.connect({
    address: configuracion.temporal.direccion,
  });
  try {
    const cliente = new Client({
      connection: conexionTemporal,
      namespace: configuracion.temporal.espacio,
    });
    await cliente.workflow.getHandle(leida.flujoTemporalId).signal(NOMBRE_SENAL_DECISION, carga);
    console.log(`Señal ${NOMBRE_SENAL_DECISION} entregada al flujo ${leida.flujoTemporalId}.`);
  } finally {
    await conexionTemporal.close();
  }
} finally {
  await conexion.cerrar();
}
