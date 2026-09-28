/**
 * Paleta «Oficina cercana» (ADR-020). Única fuente de los valores hexadecimales
 * del sistema de diseño: `tema.css` los traduce a propiedades personalizadas de
 * Tailwind y no debe desincronizarse de este fichero.
 */
export interface PaletaDeModo {
  fondo: string;
  superficie: string;
  superficie2: string;
  linea: string;
  texto: string;
  texto2: string;
  texto3: string;
  alerta: string;
  textoAlerta: string;
  alertaSuave: string;
  sobreAlerta: string;
  peligro: string;
  sobrePeligro: string;
  peligroSuave: string;
  correctoSuave: string;
  textoCorrecto: string;
  persona: string;
  sobrePersona: string;
  inactivo: string;
  acento: string;
  acentoSuave: string;
  sobreAcento: string;
  coral: string;
  coralSuave: string;
  sobreCoral: string;
  azul: string;
  azulSuave: string;
  sobreAzul: string;
  /** Marca de presencia «en la sala», «trabajando»: gráfico, 3:1 sobre la superficie. */
  presenciaActiva: string;
  /** Luna de «inactivo»: gráfico, 3:1 sobre la superficie. */
  presenciaInactiva: string;
}

export const PALETA_CLARA: PaletaDeModo = {
  fondo: '#F7F5FB',
  superficie: '#FFFFFF',
  superficie2: '#F1EEF7',
  linea: '#E4E0EE',
  texto: '#221A30',
  texto2: '#5B5070',
  texto3: '#6E6485',
  alerta: '#E08A1E',
  textoAlerta: '#7A4300',
  alertaSuave: '#FFE2B8',
  sobreAlerta: '#1E1403',
  peligro: '#B42318',
  sobrePeligro: '#FFFFFF',
  peligroSuave: '#FBE3DF',
  correctoSuave: '#DDF3E8',
  textoCorrecto: '#17613D',
  persona: '#2A2238',
  sobrePersona: '#FFFFFF',
  inactivo: '#CFC8DC',
  acento: '#5B3FC4',
  acentoSuave: '#ECE7FC',
  sobreAcento: '#FFFFFF',
  coral: '#B8401F',
  coralSuave: '#FBE5DE',
  sobreCoral: '#FFFFFF',
  azul: '#2F62D1',
  azulSuave: '#E3ECFB',
  sobreAzul: '#FFFFFF',
  presenciaActiva: '#1F9D55',
  presenciaInactiva: '#5B7DB8',
};

export const PALETA_OSCURA: PaletaDeModo = {
  fondo: '#17131F',
  superficie: '#211B2C',
  superficie2: '#2A2338',
  linea: '#3A3148',
  texto: '#F2EDF8',
  texto2: '#BDB2CD',
  texto3: '#A397B6',
  alerta: '#F2A43A',
  textoAlerta: '#FFD49A',
  alertaSuave: '#3D2A12',
  sobreAlerta: '#1E1403',
  peligro: '#FF8A80',
  sobrePeligro: '#1A0A08',
  peligroSuave: '#3C1E19',
  correctoSuave: '#1F3A2F',
  textoCorrecto: '#9FE3BD',
  persona: '#E4DDF0',
  sobrePersona: '#1A1330',
  inactivo: '#4A4160',
  acento: '#B8A2FF',
  acentoSuave: '#2E2550',
  sobreAcento: '#1A1330',
  coral: '#FF9C85',
  coralSuave: '#44221A',
  sobreCoral: '#2A0E07',
  azul: '#9DB8FF',
  azulSuave: '#1F2B4D',
  sobreAzul: '#0E1733',
  presenciaActiva: '#4ACB84',
  presenciaInactiva: '#8FB0F0',
};

/** Fondos pastel de los avatares de agente. Fijos: no cambian con el modo. */
export const AVATARES_PASTEL = {
  melocoton: '#FBD3BC',
  menta: '#BFE8D0',
  cielo: '#CADFFA',
  lila: '#D9CFF7',
  limon: '#F2E3A0',
  rosa: '#F6CADB',
} as const;

export type ColorDeAvatar = keyof typeof AVATARES_PASTEL;

/** Tinta de la cara y del emblema del avatar de agente. Fija en los dos modos. */
export const TINTA_AVATAR = '#2A2238';
