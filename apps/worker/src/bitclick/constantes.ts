/**
 * Constantes de la organización persistente de Bitclick (ADR-024).
 *
 * Un solo sitio para los nombres que comparten la siembra, el lanzamiento y el
 * informe: si alguno cambiara, cambiaría aquí y no en cada guion.
 */

/** Nombre de la organización persistente. Único en la base local de Jesús. */
export const NOMBRE_ORGANIZACION_BITCLICK = 'Bitclick';

/** Nombre del departamento, igual que en la plantilla y en la prueba técnica del stack. */
export const NOMBRE_DEPARTAMENTO_FINANZAS = 'Finanzas';

/** Fila `conector.nombre` para el conector real de Odoo de esta organización. */
export const NOMBRE_CONECTOR_ODOO = 'Odoo';

/**
 * Referencia del secreto del conector de Odoo (`conector.referencia_secreto`).
 *
 * Solo la clave de API es secreto: la URL, la base y el usuario son configuración
 * y viajan por su propia variable de entorno cuando el gateway lanza el conector
 * como proceso hijo (`registroDeOdooPorProceso`), nunca por esta referencia.
 */
export const REFERENCIA_SECRETO_ODOO = 'env:ODOO_CLAVE_API';

/** Plantilla certificada del catálogo de `@aiw/platform-agents` para el puesto de Cobros. */
export const ID_PLANTILLA_COBROS = 'finanzas.reclamacion-de-cobros';

/** Herramientas del conector que autoriza el puesto de Cobros. Ni una más. */
export const LISTA_BLANCA_COBROS = ['listar_facturas_vencidas', 'crear_nota_seguimiento'] as const;

/** Ruta del estado local que enlaza los guiones de Bitclick con su tenant ya sembrado. */
export const RUTA_ESTADO_LOCAL = '.aiw-local/bitclick.json';
