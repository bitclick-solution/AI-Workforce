import { describe, expect, it } from 'vitest';

import { ratioDeContraste } from './contraste';
import { PALETA_CLARA, PALETA_OSCURA, type PaletaDeModo } from './paleta';
import { TEMA } from './tema';

const MINIMO_AA = 4.5;

/** Del nombre de la clase de Tailwind (p. ej. `texto-3`) a la clave de la paleta. */
const CLAVE_A_CAMPO: Record<string, keyof PaletaDeModo> = {
  fondo: 'fondo',
  superficie: 'superficie',
  'superficie-2': 'superficie2',
  linea: 'linea',
  texto: 'texto',
  'texto-2': 'texto2',
  'texto-3': 'texto3',
  alerta: 'alerta',
  'texto-alerta': 'textoAlerta',
  'alerta-suave': 'alertaSuave',
  'sobre-alerta': 'sobreAlerta',
  peligro: 'peligro',
  'sobre-peligro': 'sobrePeligro',
  'peligro-suave': 'peligroSuave',
  'correcto-suave': 'correctoSuave',
  'texto-correcto': 'textoCorrecto',
  persona: 'persona',
  'sobre-persona': 'sobrePersona',
  inactivo: 'inactivo',
  acento: 'acento',
  'acento-suave': 'acentoSuave',
  'sobre-acento': 'sobreAcento',
  coral: 'coral',
  'coral-suave': 'coralSuave',
  'sobre-coral': 'sobreCoral',
  azul: 'azul',
  'azul-suave': 'azulSuave',
  'sobre-azul': 'sobreAzul',
  'presencia-activa': 'presenciaActiva',
  'presencia-inactiva': 'presenciaInactiva',
};

function cadenasDeClase(valor: unknown): string[] {
  if (typeof valor === 'string') return [valor];
  if (valor !== null && typeof valor === 'object') {
    return Object.values(valor).flatMap(cadenasDeClase);
  }
  return [];
}

function tokensDeColor(clases: string, prefijo: 'bg' | 'text'): (keyof PaletaDeModo)[] {
  const patron = new RegExp(`(?:^|\\s)(?:[a-z-]+:)*${prefijo}-([a-z0-9-]+)`, 'g');
  const encontrados: (keyof PaletaDeModo)[] = [];
  for (const coincidencia of clases.matchAll(patron)) {
    const campo = CLAVE_A_CAMPO[coincidencia[1] ?? ''];
    if (campo) encontrados.push(campo);
  }
  return encontrados;
}

/**
 * Cada par de fondo y texto que aparece junto en una misma clase de `TEMA`
 * (incluida su variante `hover:`, que se pinta a la vez que el texto que la
 * acompaña en esa misma cadena). Así un tono nuevo en `tema.ts` no se queda
 * sin probar: esta lista sale del propio fichero, no se escribe a mano.
 */
function paresDerivadosDeTema(): [keyof PaletaDeModo, keyof PaletaDeModo][] {
  const vistos = new Set<string>();
  const pares: [keyof PaletaDeModo, keyof PaletaDeModo][] = [];
  for (const clases of cadenasDeClase(TEMA)) {
    const fondos = tokensDeColor(clases, 'bg');
    const textos = tokensDeColor(clases, 'text');
    for (const fondo of fondos) {
      for (const texto of textos) {
        const clave = `${texto}/${fondo}`;
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        pares.push([texto, fondo]);
      }
    }
  }
  return pares;
}

/**
 * Pares que cruzan de componente y que `paresDerivadosDeTema` no puede ver,
 * porque el texto y el fondo salen de dos claves distintas de `TEMA` que un
 * componente compone en tiempo de render:
 * - el valor de `Indicador` con el color de `TEMA.indicador[tono]` sobre la
 *   tarjeta de `TEMA.superficie.tarjeta`;
 * - un texto sobre el fondo ambiente de la página (`fondo`) en vez del de su
 *   propia tarjeta: el vacío de `ListaDeAvisos` y el error de `Campo`.
 *
 * La etiqueta de `Aviso` no está aquí a propósito: usa `TEMA.texto.etiquetaBase`,
 * sin color propio, así que hereda el de `TEMA.aviso[tipo]` y ese par ya lo
 * cubre `paresDerivadosDeTema`. (Con el texto-3 fijo que llevaba antes, la
 * etiqueta no pasaba la AA sobre `alerta-suave` ni sobre `peligro-suave`: por
 * eso se quitó el color en vez de añadir esos pares aquí.)
 */
const PARES_COMPUESTOS: [keyof PaletaDeModo, keyof PaletaDeModo][] = [
  ['texto3', 'fondo'],
  ['peligro', 'fondo'],
  ['textoCorrecto', 'superficie'],
  ['textoAlerta', 'superficie'],
  // Sala v1: la línea de estado de `FilaDeMiembro` (texto-3, acento en
  // «escribiendo» y texto-alerta en «te necesita») y el resumen de la
  // `FilaDePresencia` van sobre la superficie del panel o de la hoja.
  ['texto3', 'superficie'],
  ['acento', 'superficie'],
  ['texto2', 'superficie'],
  // La etiqueta de la `TarjetaDePropuesta` y su título sobre la superficie.
  ['texto', 'superficie'],
];

function paresDeTextoYFondo(p: PaletaDeModo): [string, string, string][] {
  const todos = [...paresDerivadosDeTema(), ...PARES_COMPUESTOS];
  const vistos = new Set<string>();
  const pares: [string, string, string][] = [];
  for (const [texto, fondo] of todos) {
    const clave = `${texto}/${fondo}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    pares.push([`${texto} sobre ${fondo}`, p[texto], p[fondo]]);
  }
  return pares;
}

describe.each([
  ['claro', PALETA_CLARA],
  ['oscuro', PALETA_OSCURA],
] as const)('contraste AA (4,5:1) · modo %s', (_nombreDelModo, paleta) => {
  const pares = paresDeTextoYFondo(paleta);

  it('encuentra pares que probar', () => {
    expect(pares.length).toBeGreaterThan(15);
  });

  it.each(pares)('%s cumple el mínimo de la AA', (_etiqueta, texto, fondo) => {
    expect(ratioDeContraste(texto, fondo)).toBeGreaterThanOrEqual(MINIMO_AA);
  });
});

/**
 * Las marcas de presencia son gráficos, no texto: la WCAG 1.4.11 les pide 3:1
 * contra lo que tienen al lado. Se comprueban sobre la superficie (panel de
 * miembros, hoja móvil) y sobre el fondo (conversación). Cada marca con su
 * relleno de `TEMA.presencia.forma`; «inactivo» es la luna y «añadido» el aro.
 */
const MINIMO_GRAFICO = 3;

const MARCAS_DE_PRESENCIA: [string, keyof PaletaDeModo][] = [
  ['en la sala y trabajando', 'presenciaActiva'],
  ['escribiendo', 'acento'],
  ['inactivo (luna)', 'presenciaInactiva'],
  ['añadido (aro)', 'texto3'],
  ['te necesita', 'textoAlerta'],
  ['en pausa', 'texto2'],
];

describe.each([
  ['claro', PALETA_CLARA],
  ['oscuro', PALETA_OSCURA],
] as const)('contraste de las marcas de presencia (3:1) · modo %s', (_modo, paleta) => {
  it.each(
    MARCAS_DE_PRESENCIA.flatMap(([estado, campo]) =>
      (['superficie', 'fondo'] as const).map(
        (fondo) => [`${estado} sobre ${fondo}`, paleta[campo], paleta[fondo]] as const,
      ),
    ),
  )('%s cumple el mínimo para gráficos', (_etiqueta, marca, fondo) => {
    expect(ratioDeContraste(marca, fondo)).toBeGreaterThanOrEqual(MINIMO_GRAFICO);
  });

  it('el símbolo dentro de «te necesita», «trabajando» y «en pausa» se distingue de su relleno', () => {
    for (const relleno of ['textoAlerta', 'presenciaActiva', 'texto2'] as const) {
      expect(ratioDeContraste(paleta.superficie, paleta[relleno])).toBeGreaterThanOrEqual(
        MINIMO_GRAFICO,
      );
    }
  });
});

describe('ratioDeContraste', () => {
  it('negro sobre blanco da el contraste máximo', () => {
    expect(ratioDeContraste('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
  });

  it('un color sobre sí mismo da el contraste mínimo', () => {
    expect(ratioDeContraste('#5B3FC4', '#5B3FC4')).toBeCloseTo(1, 5);
  });

  it('no depende del orden de los argumentos', () => {
    expect(ratioDeContraste('#221A30', '#F7F5FB')).toBeCloseTo(
      ratioDeContraste('#F7F5FB', '#221A30'),
      10,
    );
  });
});
