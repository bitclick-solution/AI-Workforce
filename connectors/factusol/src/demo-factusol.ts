/**
 * Demostración del conector.
 *
 * Sin credenciales corre sobre las respuestas grabadas y es reproducible en
 * cualquier máquina: `pnpm --filter @aiw/connector-factusol demo:factusol`. Con las
 * tres variables de entorno puestas, lee de la instancia de pruebas de Factusol MCP
 * y no escribe nada. Sobre las grabaciones usa un plazo de cobro de 30 días solo para
 * poder enseñar facturas vencidas: contra Factusol real el vencimiento aún no se deriva.
 */
import { clienteGrabado, clienteSse, type ClienteFactusol } from './cliente.js';
import { hayCredenciales, leerConfiguracion } from './entorno.js';
import { DIA_DE_LA_GRABACION, cargarGrabaciones } from './grabaciones/index.js';
import { crearHerramientas } from './herramientas.js';
import { esProcesoPrincipal } from './proceso.js';

function escribir(linea: string): void {
  process.stdout.write(`${linea}\n`);
}

export async function demostrar(): Promise<void> {
  const contraFactusol = hayCredenciales();
  let cliente: ClienteFactusol;
  let herramientas;
  if (contraFactusol) {
    const configuracion = leerConfiguracion();
    escribir(`Fuente: instancia de Factusol MCP (${configuracion.extremoMcp}).`);
    cliente = clienteSse({
      extremo: configuracion.extremoMcp,
      token: configuracion.token,
      tenantId: configuracion.tenantId,
    });
    herramientas = crearHerramientas({ cliente });
  } else {
    escribir(
      'Fuente: respuestas grabadas (sin FACTUSOL_MCP_URL, FACTUSOL_MCP_TOKEN y FACTUSOL_TENANT_ID).',
    );
    cliente = clienteGrabado(cargarGrabaciones());
    herramientas = crearHerramientas({
      cliente,
      ahora: () => DIA_DE_LA_GRABACION,
    });
  }

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
  } else if (contraFactusol) {
    escribir('\n== crear_nota_seguimiento ==');
    escribir('Saltada contra Factusol real: la demo no deja borradores sin pedirlo.');
  } else {
    escribir('\n== crear_nota_seguimiento { tipo: "nota", clave_idempotencia: "demo-1" } ==');
    const entrada = {
      factura_id: primera.id,
      texto: `Primer aviso de cobro de ${primera.numero}.`,
      clave_idempotencia: 'demo-1',
    };
    const nota = await herramientas.crearNotaSeguimiento(entrada);
    escribir(`  borrador creado, pendiente de confirmación en el panel: ${JSON.stringify(nota)}`);
    const repetida = await herramientas.crearNotaSeguimiento(entrada);
    escribir(`  mismo identificador con la misma clave: ${String(nota.id === repetida.id)}`);
  }

  await cliente.cerrar();
}

if (esProcesoPrincipal(import.meta.url)) {
  demostrar().catch((error: unknown) => {
    process.stderr.write(`La demostración falló: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
