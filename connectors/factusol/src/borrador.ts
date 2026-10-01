/**
 * Lectura de la respuesta de `draft_modificar_cliente`.
 *
 * Es JSON estructurado y no Markdown. Del informe del Probador constan `draft_id`,
 * el diff «valor actual → nuevo» por campo y la caducidad de 30 minutos; no consta
 * la forma exacta del diff. Aquí se asume lo mínimo —un objeto `observaciones`
 * con `valor_actual` en algún nivel— y se rechaza con `invalido` todo lo demás.
 * La prueba de contrato contra la instancia local (criterio 6) fija la forma real.
 */
import { ErrorConector } from './errores.js';

export interface BorradorLeido {
  readonly draftId: string;
  /** Lo que había en `observaciones` del cliente antes del borrador. */
  readonly observacionesActuales: string;
}

function fallo(mensaje: string): never {
  throw new ErrorConector(
    'invalido',
    `El borrador de Factusol MCP no encaja en el contrato: ${mensaje}`,
  );
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function buscarClave(valor: unknown, clave: string, profundidad = 0): unknown {
  if (profundidad > 6 || !esObjeto(valor)) return undefined;
  if (clave in valor) return valor[clave];
  for (const hijo of Object.values(valor)) {
    const hallado = buscarClave(hijo, clave, profundidad + 1);
    if (hallado !== undefined) return hallado;
  }
  return undefined;
}

export function leerBorrador(estructurado: unknown): BorradorLeido {
  if (!esObjeto(estructurado)) return fallo('la respuesta no es JSON estructurado');
  const draftId = buscarClave(estructurado, 'draft_id');
  if (typeof draftId !== 'string' || draftId.trim() === '') return fallo('no trae «draft_id»');
  const observaciones = buscarClave(estructurado, 'observaciones');
  if (!esObjeto(observaciones) || !('valor_actual' in observaciones)) {
    return fallo('el diff no trae «observaciones» con «valor_actual»');
  }
  const actual = observaciones['valor_actual'];
  if (actual !== null && typeof actual !== 'string') {
    return fallo('«valor_actual» de «observaciones» no es texto');
  }
  return { draftId, observacionesActuales: actual ?? '' };
}

export interface CambioDeCampo {
  readonly actual: string;
  readonly nuevo: string;
}

function comoTexto(valor: unknown): string | undefined {
  if (valor === null) return '';
  return typeof valor === 'string' ? valor : undefined;
}

function recogerCambios(
  valor: unknown,
  cambios: Map<string, CambioDeCampo>,
  profundidad = 0,
): void {
  if (profundidad > 6 || !esObjeto(valor)) return;
  for (const [campo, hijo] of Object.entries(valor)) {
    if (esObjeto(hijo) && 'valor_actual' in hijo && 'valor_nuevo' in hijo) {
      const actual = comoTexto(hijo['valor_actual']);
      const nuevo = comoTexto(hijo['valor_nuevo']);
      if (actual === undefined || nuevo === undefined) {
        fallo(`el cambio de «${campo}» no trae texto en «valor_actual» y «valor_nuevo»`);
      }
      cambios.set(campo, { actual, nuevo });
    } else {
      recogerCambios(hijo, cambios, profundidad + 1);
    }
  }
}

/**
 * Cambios del borrador por campo, «valor actual → nuevo». Forma provisional (ver arriba):
 * un objeto con `valor_actual` y `valor_nuevo` bajo el nombre del campo. Sin ninguno,
 * el mapa viene vacío y quien confirma no confirma.
 */
export function leerCambios(estructurado: unknown): Map<string, CambioDeCampo> {
  const cambios = new Map<string, CambioDeCampo>();
  recogerCambios(estructurado, cambios);
  return cambios;
}

export type EstadoDeBorrador = 'pendiente' | 'ejecutado' | 'cancelado' | 'caducado';

export interface EstadoLeido {
  readonly estado: EstadoDeBorrador;
  readonly cambios: Map<string, CambioDeCampo>;
}

/**
 * Respuesta de `get_estado_borrador`. Del informe constan `estado` (`pendiente`,
 * `ya_ejecutado`, `bloqueado`, cancelado) y, ya ejecutado, `escrito: sí` y `resultado: ok`.
 * `caducado` no consta con ese nombre: se acepta también `expirado` y todo estado
 * desconocido es `invalido`, sin confirmar nada.
 */
export function leerEstado(estructurado: unknown): EstadoLeido {
  if (!esObjeto(estructurado)) return fallo('el estado no es JSON estructurado');
  const crudo = buscarClave(estructurado, 'estado');
  if (typeof crudo !== 'string') return fallo('el estado no trae «estado»');
  const estado = crudo.trim().toLowerCase();
  const cambios = leerCambios(estructurado);
  if (['pendiente', 'bloqueado'].includes(estado)) return { estado: 'pendiente', cambios };
  if (['cancelado', 'cancelada'].includes(estado)) return { estado: 'cancelado', cambios };
  if (['caducado', 'expirado'].includes(estado)) return { estado: 'caducado', cambios };
  if (['ya_ejecutado', 'confirmado', 'ejecutado'].includes(estado)) {
    const escrito = buscarClave(estructurado, 'escrito');
    const escritoSi =
      escrito === true || (typeof escrito === 'string' && /^s[ií]$/i.test(escrito.trim()));
    if (!escritoSi) return fallo('el borrador figura ejecutado pero no «escrito: sí»');
    const resultado = buscarClave(estructurado, 'resultado');
    if (
      resultado !== undefined &&
      !(typeof resultado === 'string' && resultado.trim().toLowerCase() === 'ok')
    ) {
      return fallo('el borrador ejecutado no trae «resultado: ok»');
    }
    return { estado: 'ejecutado', cambios };
  }
  return fallo(`estado de borrador desconocido «${estado.slice(0, 40)}»`);
}

/** Identificador del borrador aunque su diff no se pueda leer, para poder cancelarlo. */
export function leerIdDeBorrador(estructurado: unknown): string | undefined {
  const id = buscarClave(estructurado, 'draft_id');
  return typeof id === 'string' && id.trim() !== '' ? id : undefined;
}
