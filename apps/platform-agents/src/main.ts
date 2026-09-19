import { APLICACION } from './index';

// Punto de entrada del proceso. La lógica llega con las rebanadas de la fase 0 y 1.
console.log(`[${APLICACION.nombre}] cimientos listos; sin lógica de negocio todavía.`);
console.log(`[${APLICACION.nombre}] depende de: ${APLICACION.dependeDe.join(', ')}`);
