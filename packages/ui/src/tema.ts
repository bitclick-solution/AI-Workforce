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
  /** Medidor de un criterio: la pista y el relleno son gráficos y piden 3:1 (contraste.test.ts). */
  medidor: {
    pista: 'h-2 w-full overflow-hidden rounded-full border border-linea bg-superficie-2',
    relleno: 'block h-full rounded-full bg-acento',
  },
  /** Línea de niveles: el punto de cada cambio es un gráfico y pide 3:1. */
  linea: {
    lista: 'flex flex-col border-l-2 border-linea pl-4',
    punto:
      'absolute -left-[1.4rem] top-1.5 h-3 w-3 rounded-full border-2 border-superficie bg-acento',
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
  /**
   * Marcas de presencia del ADR-022 (hoja S0 del lienzo). Cada estado tiene una
   * forma propia; el color es un refuerzo y el texto va siempre al lado.
   * Son gráficos: la prueba de contraste les exige 3:1 sobre la superficie.
   */
  presencia: {
    marca: 'inline-flex shrink-0 items-center justify-center rounded-full',
    enAvatar: 'absolute -bottom-1 -right-1 ring-[3px] ring-superficie',
    tamano: {
      pequeno: 'h-3 w-3',
      base: 'h-3.5 w-3.5',
    },
    forma: {
      'en-la-sala': 'bg-presencia-activa',
      escribiendo: '!w-7 gap-0.5 bg-acento',
      inactivo: 'bg-superficie',
      anadido: 'border-[3px] border-texto-3 bg-superficie',
      trabajando: 'bg-presencia-activa',
      'te-necesita': 'bg-texto-alerta',
      'en-pausa': 'gap-0.5 bg-texto-2',
    },
    punto: 'block h-[3px] w-[3px] rounded-full bg-sobre-acento motion-safe:animate-teclear',
    barra: 'block h-[7px] w-[2px] rounded-[1px] bg-superficie',
    /** Añadido: el avatar se atenúa porque aún no está conectado. */
    avatarAnadido: 'opacity-50',
  },
  miembro: {
    fila: 'flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left',
    nombre: 'font-texto truncate text-sm font-semibold text-texto',
    detalle: 'font-texto truncate text-xs text-texto-3',
    detalleEstado: {
      neutro: 'text-texto-3',
      escribiendo: 'text-acento',
      'te-necesita': 'text-texto-alerta font-medium',
    },
    etiquetaIA:
      'font-texto inline-flex items-center rounded bg-acento-suave px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-acento',
  },
  panelDeMiembros: {
    contenedor: 'flex h-full flex-col gap-3 bg-superficie text-texto',
    titulo: 'font-titulos text-base font-semibold text-texto',
    grupo: 'font-texto text-xs font-medium uppercase tracking-widest text-texto-3',
    filtro:
      'font-texto inline-flex min-h-11 items-center rounded-full border px-3 text-xs font-medium sm:min-h-8',
    filtroActivo: 'border-texto bg-texto text-fondo',
    filtroInactivo: 'border-linea bg-superficie text-texto hover:bg-superficie-2',
  },
  navegacionDeSalas: {
    titulo: 'font-texto px-3 text-xs font-medium uppercase tracking-widest text-texto-3',
    enlace: 'font-texto flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm lg:min-h-9',
    enlaceActual: 'bg-acento-suave text-acento font-semibold',
    enlaceNormal: 'text-texto-2 hover:bg-superficie-2 hover:text-texto',
    enlaceSinLeer: 'text-texto font-semibold hover:bg-superficie-2',
    menciones:
      'ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-acento px-1.5 text-[11px] font-bold text-sobre-acento',
    almohadilla: 'text-texto-3',
  },
  escritura: {
    contenedor: 'font-texto flex min-h-6 items-center gap-2 text-xs text-texto-2',
    punto: 'block h-1 w-1 rounded-full bg-acento motion-safe:animate-teclear',
  },
  filaDePresencia: {
    contenedor:
      'flex w-full items-center gap-3 overflow-x-auto border-b border-linea bg-superficie px-4 py-2 text-left',
    resumen: 'font-texto text-xs text-texto-2',
  },
  hoja: {
    fondo: 'fixed inset-0 z-40 bg-texto/40',
    abajo:
      'fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl bg-superficie text-texto shadow-xl',
    izquierda:
      'fixed inset-y-0 left-0 z-50 flex w-[85vw] max-w-80 flex-col bg-superficie text-texto shadow-xl',
    cabecera: 'flex items-center justify-between gap-3 border-b border-linea px-4 py-2',
    titulo: 'font-titulos text-base font-semibold text-texto',
    cerrar:
      'inline-flex h-11 w-11 items-center justify-center rounded-full text-texto-2 hover:bg-superficie-2 hover:text-texto',
  },
  propuesta: {
    contenedor: 'rounded-xl border border-acento bg-superficie p-4 text-texto',
    etiqueta: 'font-texto text-xs font-medium uppercase tracking-widest text-acento',
    dato: 'font-texto text-xs text-texto-3',
    valor: 'font-texto text-sm text-texto',
    hecha: 'font-texto rounded-lg bg-correcto-suave px-3 py-2 text-sm text-texto-correcto',
  },
} as const;
