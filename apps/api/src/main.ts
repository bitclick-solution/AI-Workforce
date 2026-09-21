import { APLICACION } from './index';
import { configuracionDesdeEntorno } from './rutas/contador';
import { arrancarApi } from './servidor';

// Punto de entrada del proceso. La lógica llega con las rebanadas de la fase 0 y 1.
console.log(`[${APLICACION.nombre}] cimientos listos; sin lógica de negocio todavía.`);
console.log(`[${APLICACION.nombre}] depende de: ${APLICACION.dependeDe.join(', ')}`);

// El servidor solo escucha si hay algo que servir: la bandera del contador puesta,
// su token en el entorno y una base a la que preguntar. Sin eso, el proceso dice qué
// es y termina, que es lo que comprueba la CI cuando arranca la imagen.
const hayContador = configuracionDesdeEntorno(process.env) !== undefined;
const hayBase = Boolean(process.env['DATABASE_URL']);

if (hayContador && hayBase) {
  const api = await arrancarApi();
  console.log(`[${APLICACION.nombre}] contador de tareas v0 escuchando en el puerto ${api.puerto}`);
  for (const senal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(senal, () => {
      void api.cerrar().then(() => process.exit(0));
    });
  }
} else {
  const motivo = hayContador ? 'falta DATABASE_URL' : 'la bandera del contador está apagada';
  console.log(`[${APLICACION.nombre}] sin servidor HTTP: ${motivo}.`);
}
