import { ROL_APLICACION, crearConexion } from '@aiw/db';

import { APLICACION } from './index';
import { leerConfiguracion, leerTenantsVigilados } from './aprobacion/configuracion';
import { escucharEventosDeAprobacion } from './aprobacion/escucha-eventos';
import { montarPuertos } from './aprobacion/montaje';
import { ServicioDeAprobacion } from './aprobacion/servicio';
import { arrancarServidor } from './aprobacion/servidor';

/**
 * Punto de entrada del proceso de canales.
 *
 * Con la bandera `AIW_APROBACION_CORREO` apagada imprime y termina, igual que antes
 * de esta rebanada. No es solo prudencia: el job «Imagen channels» de la
 * integración continua hace `docker run --rm` y espera que el contenedor salga. Un
 * servidor que arranca siempre dejaría ese job colgado hasta el tiempo límite.
 */
async function principal(): Promise<void> {
  const configuracion = leerConfiguracion();

  if (!configuracion.activa) {
    console.log(`[${APLICACION.nombre}] cimientos listos; sin lógica de negocio todavía.`);
    console.log(`[${APLICACION.nombre}] depende de: ${APLICACION.dependeDe.join(', ')}`);
    console.log(
      `[${APLICACION.nombre}] aprobación por correo apagada (AIW_APROBACION_CORREO). ` +
        'Enciéndela para servir los enlaces firmados.',
    );
    return;
  }

  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('Falta DATABASE_URL: la aprobación por correo escribe en el libro.');
  }

  const conexion = crearConexion({ url, rolAplicacion: ROL_APLICACION });
  const puertos = await montarPuertos(configuracion);
  const servicio = new ServicioDeAprobacion({
    cliente: conexion.cliente,
    configuracion,
    correo: puertos.correo,
    senal: puertos.senal,
  });

  const enMarcha = await arrancarServidor({
    servicio,
    puerto: configuracion.puerto,
    // En un contenedor hay que escuchar en todas las interfaces; en local basta la
    // de loopback, y el Compose publica el puerto solo en 127.0.0.1.
    host: process.env['AIW_APROBACION_HOST'] ?? '0.0.0.0',
  });

  console.log(
    `[${APLICACION.nombre}] enlaces de aprobación en el puerto ${enMarcha.puerto}; ` +
      `correo por ${configuracion.correo.proveedor}, señal por ${configuracion.senal.proveedor}.`,
  );

  const tenantsVigilados = leerTenantsVigilados();
  const escucha =
    tenantsVigilados.length > 0
      ? escucharEventosDeAprobacion({
          cliente: conexion.cliente,
          servicio,
          tenantIds: tenantsVigilados,
          alFallar: (tenantId, error) => {
            console.error(
              `[${APLICACION.nombre}] no se pudo consumir la salida transaccional del tenant ${tenantId}:`,
              error,
            );
          },
        })
      : undefined;
  console.log(
    tenantsVigilados.length > 0
      ? `[${APLICACION.nombre}] correo automático al crearse una aprobación: ${tenantsVigilados.length} tenant(s) vigilados.`
      : `[${APLICACION.nombre}] AIW_APROBACION_TENANTS vacía: ninguna aprobación se manda sola, igual que antes de este seguimiento.`,
  );

  const parar = async (): Promise<void> => {
    escucha?.parar();
    await enMarcha.cerrar();
    await puertos.cerrar();
    await conexion.cerrar();
  };
  process.once('SIGTERM', () => void parar());
  process.once('SIGINT', () => void parar());
}

principal().catch((error: unknown) => {
  console.error(`[${APLICACION.nombre}] no arranca:`, error);
  process.exitCode = 1;
});
