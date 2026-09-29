import { APLICACION } from './aplicacion.js';
import { BANDERA, leerConfiguracion, queFalta } from './configuracion.js';

/**
 * Punto de entrada del proceso.
 *
 * Con la bandera apagada imprime qué le falta y termina con código cero. El job
 * «Imagen worker» de la integración continua arranca el contenedor sin entorno y
 * espera exactamente eso; y en staging el proceso se puede desplegar antes de la
 * demostración sin que haga nada.
 */
const configuracion = leerConfiguracion();
const falta = queFalta(configuracion);

if (falta.length > 0) {
  console.log(`[${APLICACION.nombre}] cimientos listos; sin arrancar el trabajador.`);
  console.log(`[${APLICACION.nombre}] falta: ${falta.join(', ')}.`);
  console.log(`[${APLICACION.nombre}] depende de: ${APLICACION.dependeDe.join(', ')}`);
  process.exit(0);
}

const { montarTrabajador } = await import('./trabajador.js');
const { NativeConnection } = await import('@temporalio/worker');

const conexion = await NativeConnection.connect({ address: configuracion.temporal.direccion });
const montado = await montarTrabajador({
  urlBaseDeDatos: configuracion.urlBaseDeDatos ?? '',
  cola: configuracion.temporal.cola,
  espacio: configuracion.temporal.espacio,
  conexion,
  ...(configuracion.centrifugo ? { centrifugo: configuracion.centrifugo } : {}),
});

console.log(
  `[${APLICACION.nombre}] trabajador escuchando en la cola ${configuracion.temporal.cola} ` +
    `del espacio ${configuracion.temporal.espacio}.`,
);

async function apagar(): Promise<void> {
  montado.trabajador.shutdown();
  await montado.cerrar();
  await conexion.close();
}

process.on('SIGINT', () => void apagar());
process.on('SIGTERM', () => void apagar());

try {
  await montado.trabajador.run();
} finally {
  await montado.cerrar();
  await conexion.close();
}

// La bandera se nombra aquí para que buscarla en el repositorio lleve a este fichero.
void BANDERA;
