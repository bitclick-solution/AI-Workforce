/**
 * Mandato `aprendizaje`: la promoción y la reversión a mano de v0.
 *
 * En v0 ninguna lección se promociona sola (docs/specs/aprendizaje-v0.md, decisión
 * 6): la promociona una persona, con su identificador, y la puerta del Evaluador
 * certifica o bloquea antes de crear la versión. El panel llamará a las mismas
 * funciones de `@aiw/learning`; hasta entonces, esto es el panel.
 *
 *   pnpm --filter @aiw/worker aprendizaje expediente <puestoId> --tenant <t>
 *   pnpm --filter @aiw/worker aprendizaje promocionar <leccionId> --persona <p> --tenant <t> [--motivo "…"]
 *   pnpm --filter @aiw/worker aprendizaje revertir <puestoId> --a <versionId> --persona <p> --tenant <t> [--motivo "…"]
 *
 * El tenant sale de `--tenant` o de `AIW_TENANT`; la persona, de `--persona` o de
 * `AIW_PERSONA`. No se adivinan: la promoción queda a nombre de quien la hace.
 */
import { crearConexion } from '@aiw/db';
import { aprendizaje as evalsAprendizaje } from '@aiw/evals';
import {
  ErrorDeAprendizaje,
  leerExpediente,
  promocionarLeccion,
  revertirVersion,
} from '@aiw/learning';

import { BANDERA_APRENDIZAJE, aprendizajeEncendido, leerConfiguracion } from './configuracion.js';

function valorDeBandera(argumentos: string[], nombre: string): string | undefined {
  const indice = argumentos.indexOf(`--${nombre}`);
  if (indice >= 0) return argumentos[indice + 1];
  const junto = argumentos.find((argumento) => argumento.startsWith(`--${nombre}=`));
  return junto?.slice(nombre.length + 3);
}

const USO =
  'Uso: pnpm --filter @aiw/worker aprendizaje expediente <puestoId> --tenant <t>\n' +
  '     pnpm --filter @aiw/worker aprendizaje promocionar <leccionId> --persona <p> --tenant <t> [--motivo "…"]\n' +
  '     pnpm --filter @aiw/worker aprendizaje revertir <puestoId> --a <versionId> --persona <p> --tenant <t> [--motivo "…"]';

function salirConAyuda(mensaje: string): never {
  console.error(`${mensaje}\n\n${USO}`);
  process.exit(1);
}

const argumentos = process.argv.slice(2);
// Los valores de las banderas no cuentan como posicionales.
const posicionales = argumentos.filter(
  (argumento, i) => !argumento.startsWith('--') && !argumentos[i - 1]?.startsWith('--'),
);
const [mandato, objetivo] = posicionales;
const tenantId = valorDeBandera(argumentos, 'tenant') ?? process.env['AIW_TENANT'];
const personaId = valorDeBandera(argumentos, 'persona') ?? process.env['AIW_PERSONA'];
const motivo = valorDeBandera(argumentos, 'motivo');

if (!aprendizajeEncendido())
  salirConAyuda(`El aprendizaje v0 está detrás de ${BANDERA_APRENDIZAJE}=1.`);
if (!mandato || !['expediente', 'promocionar', 'revertir'].includes(mandato)) {
  salirConAyuda('Indica el mandato: expediente, promocionar o revertir.');
}
if (!objetivo) salirConAyuda('Falta el identificador sobre el que actuar.');
if (!tenantId) salirConAyuda('Falta el tenant: pásalo con --tenant o en AIW_TENANT.');
const configuracion = leerConfiguracion();
if (configuracion.urlBaseDeDatos === undefined) salirConAyuda('Falta DATABASE_URL.');

const conexion = crearConexion({ url: configuracion.urlBaseDeDatos });
try {
  if (mandato === 'expediente') {
    const expediente = await leerExpediente(conexion.cliente, tenantId, objetivo);
    console.log(
      `Versión activa: ${expediente.versionActiva.numero} (${expediente.versionActiva.versionPuestoId})`,
    );
    for (const version of expediente.versiones) {
      console.log(
        `  v${version.numero}  ${version.versionPuestoId}  lecciones: ${version.lecciones.length}`,
      );
    }
    for (const leccion of expediente.lecciones) {
      console.log(`  [${leccion.estado}] ${leccion.leccionId}  ${leccion.linea}`);
    }
  } else if (mandato === 'promocionar') {
    if (!personaId) salirConAyuda('Una promoción la hace una persona: pásala con --persona.');
    const resultado = await promocionarLeccion(conexion.cliente, tenantId, {
      leccionId: objetivo,
      personaId,
      puerta: evalsAprendizaje.certificarPromocion,
      ...(motivo === undefined ? {} : { motivo }),
    });
    for (const caso of resultado.resultados.casos) {
      console.log(`  ${caso.superado ? 'ok ' : 'NO '} ${caso.diagnostico}`);
    }
    if (resultado.estado === 'bloqueada') {
      console.error('El Evaluador bloqueó la promoción: no se creó ninguna versión.');
      process.exitCode = 2;
    } else {
      console.log(
        `Promocionada: versión ${resultado.numero} (${resultado.versionPuestoId}); ` +
          `la anterior era ${resultado.versionAnteriorId}.`,
      );
    }
  } else {
    const aVersionId = valorDeBandera(argumentos, 'a');
    if (!aVersionId) salirConAyuda('Indica la versión a la que volver con --a <versionId>.');
    if (!personaId) salirConAyuda('Una reversión la hace una persona: pásala con --persona.');
    const hecha = await revertirVersion(conexion.cliente, tenantId, {
      puestoId: objetivo,
      aVersionId,
      personaId,
      ...(motivo === undefined ? {} : { motivo }),
    });
    console.log(`Vuelta a la versión ${hecha.numero} (${hecha.aVersionId}).`);
    console.log(`  Lecciones retiradas: ${hecha.retiradas.join(', ') || 'ninguna'}`);
    console.log(`  Lecciones repuestas: ${hecha.repuestas.join(', ') || 'ninguna'}`);
  }
} catch (error) {
  if (error instanceof ErrorDeAprendizaje) {
    console.error(`No se hizo nada (${error.codigo}): ${error.message}`);
    process.exitCode = 2;
  } else {
    throw error;
  }
} finally {
  await conexion.cerrar();
}
