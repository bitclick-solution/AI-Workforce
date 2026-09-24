/**
 * Demostración del conector.
 *
 * Sin credenciales corre sobre las respuestas grabadas y es reproducible en
 * cualquier máquina: `pnpm --filter @aiw/connector-odoo demo:odoo`. Con las
 * cuatro variables de entorno puestas, habla con la instancia de pruebas de
 * Odoo a través del MCP dinámico. Escribe por `stdout` con `process.stdout`
 * porque `console` queda para el registro del proceso.
 */
import { clienteGrabado, clienteHttp, type ClienteMcpDinamico } from './cliente.js';
import { hayCredenciales, leerConfiguracion } from './entorno.js';
import { DIA_DE_LA_GRABACION, cargarGrabaciones } from './grabaciones/index.js';
import { crearHerramientas } from './herramientas.js';
import { esProcesoPrincipal } from './proceso.js';

function escribir(linea: string): void {
  process.stdout.write(`${linea}\n`);
}

export async function demostrar(): Promise<void> {
  const contraOdoo = hayCredenciales();
  let cliente: ClienteMcpDinamico;
  let ahora: (() => Date) | undefined;
  if (contraOdoo) {
    const configuracion = leerConfiguracion();
    escribir(`Fuente: instancia de Odoo por el MCP dinámico (${configuracion.extremoMcp}).`);
    cliente = clienteHttp({ extremo: configuracion.extremoMcp });
  } else {
    escribir(
      'Fuente: respuestas grabadas (sin ODOO_URL, ODOO_BASE, ODOO_USUARIO y ODOO_CLAVE_API).',
    );
    cliente = clienteGrabado(cargarGrabaciones());
    ahora = () => DIA_DE_LA_GRABACION;
  }

  const herramientas = crearHerramientas(ahora === undefined ? { cliente } : { cliente, ahora });

  escribir('\n== listar_facturas_vencidas { dias_vencida_minimo: 1, limite: 5 } ==');
  const lista = await herramientas.listarFacturasVencidas({ dias_vencida_minimo: 1, limite: 5 });
  escribir(`total: ${String(lista.total)}`);
  for (const factura of lista.facturas) {
    escribir(
      `  ${factura.numero}  ${factura.cliente.nombre}  ` +
        `${factura.importe_pendiente.toFixed(2)} ${factura.moneda}  ` +
        `vence ${factura.fecha_vencimiento}  ${String(factura.dias_vencida)} días vencida`,
    );
  }

  const primera = lista.facturas[0];
  if (primera === undefined) {
    escribir('\nNo hay facturas vencidas: no hay nota que anotar.');
  } else if (contraOdoo) {
    escribir('\n== crear_nota_seguimiento ==');
    escribir('Saltada contra el ERP real: la demo no escribe en Odoo sin pedirlo.');
  } else {
    escribir('\n== crear_nota_seguimiento { tipo: "nota", clave_idempotencia: "demo-1" } ==');
    const entrada = {
      factura_id: primera.id,
      texto: `Primer aviso de cobro de ${primera.numero}.`,
      clave_idempotencia: 'demo-1',
    };
    const nota = await herramientas.crearNotaSeguimiento(entrada);
    escribir(`  creada: ${JSON.stringify(nota)}`);
    const repetida = await herramientas.crearNotaSeguimiento(entrada);
    escribir(`  repetida con la misma clave: ${JSON.stringify(repetida)}`);
    escribir(`  mismo identificador: ${String(nota.id === repetida.id)}`);
  }

  escribir('\n== errores ==');
  for (const [caso, entrada] of [
    ['texto con HTML', { factura_id: primera?.id ?? 42, texto: '<b>urgente</b>' }],
    ['factura inexistente', { factura_id: 999999, texto: 'Aviso.' }],
  ] as const) {
    try {
      await herramientas.crearNotaSeguimiento(entrada);
      escribir(`  ${caso}: no falló`);
    } catch (error) {
      const fallo = error as { motivo?: string; reintentable?: boolean; message: string };
      escribir(
        `  ${caso}: motivo ${String(fallo.motivo)}, reintentable ${String(fallo.reintentable)} — ${fallo.message}`,
      );
    }
  }

  await cliente.cerrar();
}

if (esProcesoPrincipal(import.meta.url)) {
  demostrar().catch((error: unknown) => {
    process.stderr.write(`La demostración falló: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
