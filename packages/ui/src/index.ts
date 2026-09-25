/**
 * @aiw/ui
 *
 * Componentes de interfaz compartidos entre el panel y la sala.
 * Tipados, accesibles y con internacionalización desde el primer componente.
 * La identidad visual definitiva vive en `tema.ts` y está pendiente de decisión.
 */
export const PAQUETE = {
  nombre: '@aiw/ui',
  tipo: 'paquete',
  responsabilidad: 'Componentes de interfaz compartidos entre el panel y la sala.',
} as const;

export type Paquete = typeof PAQUETE;

export { cn } from './cn';
export { Estado } from './estado';
export type { EstadoProps } from './estado';

export { TEMA } from './tema';

export {
  crearTraductor,
  ProveedorDeIdioma,
  useIdioma,
  useTraduccion,
  IDIOMA_DE_REFERENCIA,
} from './i18n';
export type {
  ClaveDeTexto,
  Diccionario,
  Idioma,
  Parametros,
  ProveedorDeIdiomaProps,
  Traductor,
} from './i18n';

export { descomponerDuracion, formatearDuracion } from './duracion';
export type { DuracionDescompuesta } from './duracion';

export { Boton } from './boton';
export type { BotonProps, TonoDeBoton } from './boton';

export { Aviso } from './aviso';
export type { AvisoProps, TipoDeAviso } from './aviso';

export { Tarjeta } from './tarjeta';
export type { TarjetaProps } from './tarjeta';

export { Insignia } from './insignia';
export type { InsigniaProps, TonoDeInsignia } from './insignia';

export { Campo } from './campo';
export type { CampoProps } from './campo';

export { Porque } from './porque';
export type { PorqueProps } from './porque';
