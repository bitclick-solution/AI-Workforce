/**
 * Fichero único de estilo del sistema de componentes.
 *
 * Base sobria y neutra con un solo acento. El panel tiene identidad propia y no
 * hereda la paleta de BitclickLabs ni los tokens cosechados del prototipo
 * (decisión de Jesús, 2026-09-21): de la marca se toma la voz y no el color.
 *
 * Esta base es provisional a propósito. Cuando exista el sistema de diseño del
 * producto, se cambia este fichero y no los componentes: ningún componente de
 * este paquete debe llevar un color, un radio ni una sombra escritos a mano.
 */
export const TEMA = {
  superficie: {
    pagina: 'bg-neutral-50 text-neutral-900',
    tarjeta: 'bg-white border border-neutral-200 rounded-xl shadow-sm',
    apagada: 'bg-neutral-100 text-neutral-700',
  },
  texto: {
    titulo: 'text-neutral-900 font-semibold tracking-tight',
    cuerpo: 'text-neutral-700',
    apagado: 'text-neutral-500',
    etiqueta: 'text-xs font-medium uppercase tracking-widest text-neutral-500',
  },
  boton: {
    base: 'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 disabled:cursor-not-allowed disabled:opacity-50',
    primario: 'bg-neutral-900 text-white hover:bg-neutral-700',
    secundario: 'bg-white text-neutral-900 border border-neutral-300 hover:bg-neutral-100',
    peligro: 'bg-white text-red-700 border border-red-300 hover:bg-red-50',
  },
  aviso: {
    vacio: 'border-neutral-300 bg-neutral-50 text-neutral-800',
    error: 'border-red-300 bg-red-50 text-red-900',
    'necesita-persona': 'border-amber-300 bg-amber-50 text-amber-900',
    informacion: 'border-sky-300 bg-sky-50 text-sky-900',
  },
  insignia: {
    base: 'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
    neutro: 'border-neutral-300 bg-neutral-100 text-neutral-800',
    exito: 'border-emerald-300 bg-emerald-50 text-emerald-900',
    aviso: 'border-amber-300 bg-amber-50 text-amber-900',
    peligro: 'border-red-300 bg-red-50 text-red-900',
  },
  campo: {
    control:
      'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-900',
    controlConError: 'border-red-400',
  },
} as const;
