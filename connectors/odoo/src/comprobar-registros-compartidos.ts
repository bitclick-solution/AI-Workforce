/**
 * Comprobación previa de registros compartidos (ADR-024, criterio de hecho 1).
 *
 * En Odoo, un registro sin empresa asignada (`company_id` vacío) se ve desde
 * cualquier empresa. Antes de conectar el puesto de Cobros a la empresa de
 * pruebas, este guion deja constancia —en la salida de la orden— de qué
 * contactos y qué productos compartidos ve el usuario de permisos mínimos del
 * MCP, para que Jesús les asigne empresa si no deben verse desde la de
 * pruebas. Es solo lectura: no crea, no modifica y no borra nada en Odoo.
 *
 *   pnpm --filter @aiw/connector-odoo comprobar:registros-compartidos
 */
import { clienteHttp, HERRAMIENTAS_DINAMICAS } from './cliente.js';
import { leerConfiguracion, redactar } from './entorno.js';
import { ErrorConector, traducirError } from './errores.js';
import { leerRegistros } from './mapeo.js';
import { esProcesoPrincipal } from './proceso.js';

/** Modelos de Odoo en los que un registro sin empresa se ve desde cualquiera. */
export const MODELOS_COMPARTIBLES = [
  { modelo: 'res.partner', etiqueta: 'contactos', campos: ['id', 'name', 'email'] },
  { modelo: 'product.template', etiqueta: 'productos', campos: ['id', 'name', 'default_code'] },
] as const;

export const LIMITE_POR_MODELO = 200;

export interface RegistroCompartido {
  readonly id: number;
  readonly nombre: string;
  readonly detalle: string;
}

export interface ResultadoModelo {
  readonly modelo: string;
  readonly etiqueta: string;
  readonly registros: readonly RegistroCompartido[];
}

function comoTexto(valor: unknown): string {
  return typeof valor === 'string' && valor.trim() !== '' ? valor : '';
}

function comoRegistroCompartido(registro: unknown): RegistroCompartido | undefined {
  if (typeof registro !== 'object' || registro === null) return undefined;
  const objeto = registro as Record<string, unknown>;
  const id = objeto['id'];
  if (typeof id !== 'number') return undefined;
  const nombre = comoTexto(objeto['name']) || `#${String(id)}`;
  const detalle = comoTexto(objeto['email']) || comoTexto(objeto['default_code']);
  return { id, nombre, detalle };
}

/**
 * Busca los registros sin empresa asignada de un modelo.
 *
 * `company_id = false` es la forma en la que Odoo representa «sin empresa» en
 * un dominio de búsqueda: ese es justo el registro que se ve desde cualquier
 * empresa, incluida la de pruebas.
 */
export async function registrosCompartidosDe(
  cliente: ReturnType<typeof clienteHttp>,
  definicion: (typeof MODELOS_COMPARTIBLES)[number],
): Promise<ResultadoModelo> {
  try {
    const carga = await cliente.llamar(HERRAMIENTAS_DINAMICAS.buscar, {
      model: definicion.modelo,
      domain: [['company_id', '=', false]],
      fields: [...definicion.campos],
      limit: LIMITE_POR_MODELO,
    });
    const registros = leerRegistros(carga)
      .map(comoRegistroCompartido)
      .filter((registro): registro is RegistroCompartido => registro !== undefined);
    return { modelo: definicion.modelo, etiqueta: definicion.etiqueta, registros };
  } catch (error) {
    throw traducirError(
      error,
      `No se pudieron leer los registros compartidos de «${definicion.modelo}»`,
    );
  }
}

function imprimirResultado(resultado: ResultadoModelo): void {
  console.log(
    `— ${resultado.etiqueta} sin empresa asignada (${resultado.modelo}): ${resultado.registros.length}`,
  );
  for (const registro of resultado.registros) {
    const detalle = registro.detalle === '' ? '' : ` — ${registro.detalle}`;
    console.log(`    #${String(registro.id)} ${registro.nombre}${detalle}`);
  }
  if (resultado.registros.length === 0) {
    console.log('    ninguno: el usuario mínimo no ve ningún registro compartido de este modelo.');
  }
}

export async function principal(entorno = process.env): Promise<void> {
  let configuracion;
  try {
    configuracion = leerConfiguracion(entorno);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  console.log(
    `Comprobando registros compartidos en ${configuracion.url} (base «${configuracion.base}»).`,
  );
  console.log('Solo lectura: no se crea, modifica ni borra nada en Odoo.');
  console.log('');

  const cliente = clienteHttp({ extremo: configuracion.extremoMcp });
  try {
    for (const definicion of MODELOS_COMPARTIBLES) {
      imprimirResultado(await registrosCompartidosDe(cliente, definicion));
    }
    console.log('');
    console.log(
      'Si alguno de estos registros no debe verse desde la empresa de pruebas, asígnale ' +
        'empresa en Odoo (pestaña «Empresa» del contacto o del producto) antes de encender ' +
        'AIW_CONECTOR_ODOO=1.',
    );
  } catch (error) {
    const fallo = error instanceof ErrorConector ? error : traducirError(error, 'Fallo inesperado');
    console.error(redactar(fallo.message, [configuracion.claveApi]));
    process.exitCode = 1;
  } finally {
    await cliente.cerrar();
  }
}

if (esProcesoPrincipal(import.meta.url)) {
  principal().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
