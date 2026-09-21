/**
 * Demo reproducible de la aprobación por correo.
 *
 * `pnpm --filter @aiw/channels demo:aprobacion` con `DATABASE_URL` puesto: siembra
 * una organización, pide un permiso, manda el correo y escribe por pantalla el
 * enlace y el cuerpo del mensaje. Con `AIW_CORREO_PROVEEDOR=smtp` el correo sale
 * de verdad hacia Mailpit y se lee en <http://localhost:8025>.
 *
 * Deja la organización sembrada en la base: es una demo, no una prueba, y lo que
 * interesa después es poder abrir el enlace en el navegador y decidir.
 *
 * Escribe con `process.stdout.write` y no con `console.log` porque el registro de
 * la plataforma pasa por el libro de auditoría; esto es la salida de un guion.
 */
import { conTenant, crearConexion } from '@aiw/db';
import { sembrarOrganizacion } from '@aiw/db/pruebas';
import { solicitarAprobacion } from '@aiw/ledger';

import { leerConfiguracion } from '../aprobacion/configuracion.js';
import { montarPuertos } from '../aprobacion/montaje.js';
import { ServicioDeAprobacion } from '../aprobacion/servicio.js';
import { arrancarServidor } from '../aprobacion/servidor.js';

function escribir(linea: string): void {
  process.stdout.write(`${linea}\n`);
}

async function demo(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('Falta DATABASE_URL: la demo escribe en el libro de auditoría.');

  const configuracion = leerConfiguracion();
  if (!configuracion.activa) {
    throw new Error('Enciende AIW_APROBACION_CORREO=1 y pon AIW_APROBACION_CLAVE_FIRMA.');
  }

  const conexion = crearConexion({ url });
  const puertos = await montarPuertos(configuracion);
  const servicio = new ServicioDeAprobacion({
    cliente: conexion.cliente,
    configuracion,
    correo: puertos.correo,
    senal: puertos.senal,
  });

  const org = await sembrarOrganizacion(conexion.cliente, `demo-${Date.now()}`);
  const pedida = await conTenant(conexion.cliente, org.tenantId, (tx) =>
    solicitarAprobacion(tx, org.tenantId, {
      tareaId: org.tareaId,
      pasoId: org.pasoId,
      personaId: org.personaId,
      claseAccion: 'pago.emitir',
      nivelExigido: 'n1',
      borradorOpaco: { tipo: 'pago', carga: { iban: 'no se muestra', importe: 1200 } },
      resumenLegible:
        'Pagar 1.200,00 € a Suministros Pérez por la factura 2026/114, vencida el 15 de septiembre.',
      venceEn: new Date(Date.now() + 3_600_000),
    }),
  );

  const enviada = await servicio.enviarSolicitud(org.tenantId, pedida.id);
  const enMarcha = await arrancarServidor({ servicio, puerto: configuracion.puerto });

  escribir('');
  escribir(`Organización sembrada: ${org.tenantId}`);
  escribir(`Aprobación pedida:     ${pedida.id}`);
  escribir(`Correo enviado por:    ${enviada.proveedor} (${enviada.referencia})`);
  escribir(`Destinatario:          ${enviada.correo.para}`);
  escribir(`Asunto:                ${enviada.correo.asunto}`);
  escribir('');
  escribir('Abre este enlace en el navegador y decide:');
  escribir(`  http://127.0.0.1:${enMarcha.puerto}/aprobaciones/${enviada.token}`);
  escribir('');
  escribir('Después, exporta el libro con el veredicto de la cadena:');
  escribir(
    `  pnpm --filter @aiw/ledger exec tsx -e "import {exportarLibro} from './src/exportar.ts';` +
      ` import postgres from 'postgres';` +
      ` const c = postgres(process.env.DATABASE_URL);` +
      ` console.log((await exportarLibro(c, {tenantId: '${org.tenantId}', formato: 'csv'})).contenido);` +
      ` await c.end();"`,
  );
  escribir('');
  escribir('Ctrl+C para parar el servidor.');

  const parar = async (): Promise<void> => {
    await enMarcha.cerrar();
    await puertos.cerrar();
    await conexion.cerrar();
  };
  process.once('SIGINT', () => void parar());
  process.once('SIGTERM', () => void parar());
}

await demo();
