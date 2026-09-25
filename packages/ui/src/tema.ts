/**
 * Fichero único de estilo del sistema de componentes.
 *
 * Tokens «Oficina cercana» (ADR-020): los valores hexadecimales viven en
 * `tema.css` (y en `paleta.ts`, para la prueba de contraste); aquí solo hay
 * nombres de clase de Tailwind que los usan. Ningún componente de este
 * paquete debe llevar un color, un radio ni una sombra escritos a mano: todo
 * pasa por este fichero.
 */
export const TEMA = {
  superficie: {
    pagina: 'bg-fondo text-texto',
    tarjeta: 'bg-superficie border border-linea rounded-xl shadow-sm',
    apagada: 'bg-superficie-2 text-texto-2',
  },
  texto: {
    // Sin color: para componerla con un color que decide otra clave de TEMA
    // (`Indicador`, por tono) sin dejar dos clases `text-*` compitiendo en el
    // mismo elemento, que es lo que arregla ese color desde otro fichero.
    tituloBase: 'font-titulos font-semibold tracking-tight',
    titulo: 'font-titulos text-texto font-semibold tracking-tight',
    cuerpo: 'font-texto text-texto',
    apagado: 'font-texto text-texto-3',
    // Sin color: el texto-3 fijo no pasa la AA sobre los fondos «suaves» de
    // Aviso. Ahí la etiqueta hereda el color del propio aviso (`Aviso` la
    // compone con `etiquetaBase`); en el resto de sitios se usa `etiqueta`.
    etiquetaBase: 'font-texto text-xs font-medium uppercase tracking-widest',
    etiqueta: 'font-texto text-xs font-medium uppercase tracking-widest text-texto-3',
  },
  foco: 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento',
  boton: {
    base: 'font-texto inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    primario: 'bg-acento text-sobre-acento hover:opacity-90',
    secundario: 'bg-superficie text-texto border border-linea hover:bg-superficie-2',
    peligro: 'bg-superficie text-peligro border border-peligro hover:bg-peligro-suave',
  },
  aviso: {
    vacio: 'border-linea bg-superficie-2 text-texto',
    error: 'border-peligro bg-peligro-suave text-peligro',
    'necesita-persona': 'border-alerta bg-alerta-suave text-texto-alerta',
    informacion: 'border-azul bg-azul-suave text-texto',
  },
  insignia: {
    base: 'font-texto inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
    neutro: 'border-linea bg-superficie-2 text-texto-2',
    exito: 'border-transparent bg-correcto-suave text-texto-correcto',
    aviso: 'border-alerta bg-alerta-suave text-texto-alerta',
    peligro: 'border-peligro bg-peligro-suave text-peligro',
  },
  campo: {
    etiqueta: 'font-texto text-sm font-medium text-texto',
    control:
      'font-texto w-full rounded-lg border border-linea bg-superficie px-3 py-2 text-sm text-texto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-acento',
    controlConError: 'border-peligro',
    error: 'font-texto text-xs font-medium text-peligro',
  },
  indicador: {
    neutro: 'text-texto',
    exito: 'text-texto-correcto',
    aviso: 'text-texto-alerta',
    peligro: 'text-peligro',
  },
  widget: {
    boton:
      'inline-flex h-6 w-6 items-center justify-center rounded-full text-texto-3 hover:bg-superficie-2 hover:text-texto',
  },
  avatar: {
    base: 'relative inline-flex shrink-0 items-center justify-center',
    agente: 'rounded-avatar',
    persona: 'rounded-full bg-persona text-sobre-persona font-titulos font-semibold',
    color: {
      melocoton: 'bg-avatar-melocoton',
      menta: 'bg-avatar-menta',
      cielo: 'bg-avatar-cielo',
      lila: 'bg-avatar-lila',
      limon: 'bg-avatar-limon',
      rosa: 'bg-avatar-rosa',
    },
    tamano: {
      pequeno: 'h-8 w-8 text-xs',
      base: 'h-12 w-12 text-sm',
      grande: 'h-16 w-16 text-base',
    },
    estado: {
      'te-necesita': 'ring-[3px] ring-alerta ring-offset-2 ring-offset-fondo',
      trabajando: '',
      'en-espera': 'ring-2 ring-inactivo ring-offset-2 ring-offset-fondo',
    },
    trabajando:
      'absolute -inset-1 rounded-[inherit] border-2 border-dashed border-acento motion-safe:animate-girar',
    emblema:
      'absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-avatar-emblema shadow-sm',
  },
} as const;
