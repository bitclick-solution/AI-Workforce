/**
 * Datos de ejemplo del prototipo. Todo está aquí y nada sale de aquí: el
 * prototipo no llama a ninguna API, ni al motor de políticas, ni al gateway MCP.
 *
 * Ninguna cifra es inventada. Los puestos, las herramientas, los guardrails, los
 * niveles y los costes salen de `docs/producto/finanzas.md` y de
 * `docs/producto/README.md`; el recorrido, de
 * `docs/producto/experiencia-de-diez-minutos.md`.
 */

export type NivelDeAutonomia = 'N0' | 'N1' | 'N2' | 'N3';

export interface NivelPorClase {
  clase: string;
  nivel: NivelDeAutonomia;
  detalle: string;
}

export interface Herramienta {
  conector: string;
  operaciones: string;
  clase: string;
}

export interface Guardrail {
  riesgo: 'Bajo' | 'Medio' | 'Alto' | 'Crítico';
  limite: string;
}

export interface PropuestaDePuesto {
  puesto: string;
  departamento: string;
  mision: string;
  comoNaceLaTarea: string;
  escalaCuando: string;
  herramientas: Herramienta[];
  guardrails: Guardrail[];
  niveles: NivelPorClase[];
  costeMensualEuros: number;
  tareasAlMes: number;
  horasLiberadas: string;
}

export const PROPUESTA_CONCILIACION: PropuestaDePuesto = {
  puesto: 'Conciliación bancaria',
  departamento: 'Finanzas',
  mision:
    'Casa cada apunte bancario con facturas, cobros y pagos del ERP; propone el asiento de las diferencias; señala duplicados, cargos desconocidos y devoluciones de recibos.',
  comoNaceLaTarea:
    'Cada mañana con el extracto del día. También cuando un apunte lleva más de cinco días sin casar, o cuando Reclamación de cobros pregunta si una factura está cobrada.',
  escalaCuando:
    'Un apunte no casa con nada tras dos intentos; hay una devolución de recibo; aparece un cargo desconocido; una diferencia supera la tolerancia del manual.',
  herramientas: [
    {
      conector: 'ERP (Odoo o Factusol)',
      operaciones:
        'Leer extractos, facturas, cobros, pagos y asientos. Casar un apunte con su documento. Crear el borrador del asiento de diferencia.',
      clase: 'Leer; escribir en un sistema',
    },
    {
      conector: 'Banco',
      operaciones: 'A través del ERP hasta que exista el conector por PSD2.',
      clase: 'Leer',
    },
    {
      conector: 'Conocimiento',
      operaciones: 'Manual de la empresa: reglas de casado, tolerancias y cuentas de diferencias.',
      clase: 'Leer',
    },
  ],
  guardrails: [
    {
      riesgo: 'Bajo',
      limite: 'Hasta 25 llamadas a herramientas por tarea. Delegación solo dentro de finanzas.',
    },
    {
      riesgo: 'Medio',
      limite: 'Casar apuntes y anotar estados, siempre reversible y con documento asociado.',
    },
    {
      riesgo: 'Alto',
      limite:
        'Todo asiento de diferencia se propone con contrapartida y documento; lo aprueba una persona.',
    },
    {
      riesgo: 'Crítico',
      limite:
        'Sin pagos, sin transferencias, sin devoluciones de cobros y sin cambiar datos bancarios. No se ofrecen como acción.',
    },
  ],
  niveles: [
    {
      clase: 'Leer',
      nivel: 'N2',
      detalle: 'Autónomo con aviso. Cada lectura queda en el libro de auditoría.',
    },
    { clase: 'Redactar', nivel: 'N2', detalle: 'El borrador no sale de la plataforma.' },
    {
      clase: 'Escribir en un sistema',
      nivel: 'N1',
      detalle:
        'Casar apuntes puede ascender a N2 con evidencia. El asiento de diferencia se queda en N1.',
    },
    { clase: 'Gastar', nivel: 'N0', detalle: 'Fijo. El agente prepara; una persona ejecuta.' },
    {
      clase: 'Delegar',
      nivel: 'N2',
      detalle: 'Dentro de finanzas. Hacia otros departamentos, N1.',
    },
    {
      clase: 'Aprender',
      nivel: 'N1',
      detalle: 'Toda lección se propone y una persona la confirma.',
    },
  ],
  costeMensualEuros: 50,
  tareasAlMes: 150,
  horasLiberadas: '20 a 25 horas al mes',
};

/** El agente que ya está en plantilla y es quien interviene en la sala. */
export const AGENTE_DE_COBROS = {
  puesto: 'Reclamación de cobros',
  departamento: 'Finanzas',
  supervisor: 'Tú, como gerente',
  estado: 'En periodo de prueba, día 1 de 30',
} as const;

export interface AccionPropuesta {
  id: string;
  titulo: string;
  detalle: string;
  nivel: NivelDeAutonomia;
  tareas: number;
  clase: string;
}

export interface Cita {
  fuente: string;
  dato: string;
}

export const PREGUNTA_DE_LA_SALA = '¿Cómo vamos de cobros este mes?';

export const INTERVENCION_DE_COBROS = {
  moderador:
    'El moderador da la palabra a Reclamación de cobros: la pregunta es de su departamento y tiene el dato.',
  respuesta:
    'Hay 14 facturas vencidas por 23.480 €. Nueve llevan menos de 30 días y suman 9.640 €; dos superan los 60 días y suman 11.200 €; tres están en disputa y no las toco.',
  costeTareas: 1,
  nivel: 'N2' as NivelDeAutonomia,
  porque:
    'He leído los vencimientos del ERP a fecha de hoy y he descartado las facturas de clientes vetados y de trato manual del manual de la empresa. No he escrito nada todavía: proponer no es actuar.',
  citas: [
    { fuente: 'ERP · vencimientos', dato: '14 facturas vencidas, 23.480 € a 21 de septiembre.' },
    {
      fuente: 'Manual de la empresa',
      dato: 'Clientes vetados y de trato manual, versión del 12 de septiembre.',
    },
  ] satisfies Cita[],
  acciones: [
    {
      id: 'recordar',
      titulo: 'Recordar las nueve facturas de menos de 30 días',
      detalle:
        'Un mensaje por factura con la plantilla aprobada, al contacto de facturación del ERP y en horario laboral.',
      nivel: 'N1',
      tareas: 9,
      clase: 'Comunicar con terceros',
    },
    {
      id: 'anotar',
      titulo: 'Anotar el seguimiento en la factura F-2026-0412',
      detalle: 'Deja constancia en el ERP de que el cliente pidió el duplicado el viernes.',
      nivel: 'N1',
      tareas: 1,
      clase: 'Escribir en un sistema',
    },
    {
      id: 'escalar',
      titulo: 'Escalar los dos clientes de más de 60 días',
      detalle:
        'Te los paso a ti con el histórico. No escribo a nadie: a partir del tercer aviso decide una persona.',
      nivel: 'N0',
      tareas: 0,
      clase: 'Comunicar con terceros',
    },
  ] satisfies AccionPropuesta[],
} as const;

/** La petición de escritura que se aprueba desde el móvil. */
export const PETICION_DE_ESCRITURA = {
  id: 'apr-2026-0001',
  agente: 'Reclamación de cobros',
  clase: 'Escribir en un sistema',
  riesgo: 'Medio',
  nivel: 'N1' as NivelDeAutonomia,
  titulo: 'Anotar una nota de seguimiento en la factura F-2026-0412',
  cliente: 'Distribuciones Ribera, S.L.',
  documento: 'Factura F-2026-0412 · 1.840 € · vencida hace 12 días',
  resumen:
    'Quiero dejar constancia en el ERP de que Distribuciones Ribera pidió el viernes un duplicado de la factura F-2026-0412 y dijo que la pagaría esta semana. No envío nada a nadie y no cambio ningún importe: solo escribo la nota en la factura y en la ficha del cliente.',
  borrador:
    'Seguimiento 21/09: el cliente pide duplicado de la factura y anuncia pago esta semana. Duplicado enviado. Próxima revisión el 28/09.',
  queNoHace: [
    'No modifica el importe, el vencimiento ni el estado de la factura.',
    'No envía ningún mensaje al cliente.',
    'No toca ninguna otra factura ni ningún otro cliente.',
  ],
  tareas: 1,
  caducidad: 'El permiso caduca en 48 horas. Si no decides, la tarea se cierra sin hacer nada.',
} as const;

/** El contador es de ejemplo: el real vive en el panel. */
export const CONTADOR_DE_EJEMPLO = { incluidas: 1500, plan: 'Departamento' } as const;

export const OBJETIVO_MINUTOS = 10;
