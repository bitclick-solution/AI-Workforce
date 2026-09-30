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

export { AvatarDeAgente, AvatarDePersona } from './avatar';
export type {
  AvatarDeAgenteProps,
  AvatarDePersonaProps,
  ColorDeAvatar,
  EstadoDeAvatar,
  GestoDeAgente,
  PuestoConEmblema,
  TamanoDeAvatar,
} from './avatar';

export { TarjetaDeWidget } from './tarjeta-de-widget';
export type { TarjetaDeWidgetProps } from './tarjeta-de-widget';

export { Indicador } from './indicador';
export type { IndicadorProps, TonoDeIndicador } from './indicador';

export { ListaDeAvisos } from './lista-de-avisos';
export type { ListaDeAvisosProps } from './lista-de-avisos';

export { AvisoDeAprobacion } from './aviso-de-aprobacion';
export type { AvisoDeAprobacionProps } from './aviso-de-aprobacion';

export { AVATARES_PASTEL, PALETA_CLARA, PALETA_OSCURA, TINTA_AVATAR } from './paleta';
export type { PaletaDeModo } from './paleta';

export { ratioDeContraste } from './contraste';

export {
  AvatarConPresencia,
  ESTADOS_DE_PRESENCIA,
  ESTADOS_SOLO_DE_AGENTE,
  EtiquetaIA,
  MarcaDePresencia,
  estadoParaTipo,
  textoDePresencia,
} from './presencia';
export type {
  AvatarConPresenciaProps,
  EstadoDePresencia,
  MarcaDePresenciaProps,
  TamanoDeMarca,
  TipoDeMiembro,
} from './presencia';

export {
  FILTROS_DE_MIEMBROS,
  FilaDeMiembro,
  PanelDeMiembros,
  filtrarMiembros,
  filtroDeEstado,
  lineaDeEstado,
} from './miembros';
export type {
  FilaDeMiembroProps,
  FiltroDeMiembros,
  MiembroVisible,
  PanelDeMiembrosProps,
} from './miembros';

export { NavegacionDeSalas, textoDeContadores } from './navegacion-de-salas';
export type { NavegacionDeSalasProps, SalaNavegable } from './navegacion-de-salas';

export { IndicadorDeEscritura, textoDeEscritura } from './indicador-de-escritura';
export type { IndicadorDeEscrituraProps } from './indicador-de-escritura';

export { FilaDePresencia } from './fila-de-presencia';
export type { FilaDePresenciaProps } from './fila-de-presencia';

export { HojaMovil } from './hoja-movil';
export type { HojaMovilProps } from './hoja-movil';

export { TarjetaDePropuesta } from './tarjeta-de-propuesta';
export type { DatoDePropuesta, TarjetaDePropuestaProps } from './tarjeta-de-propuesta';

export {
  PanelDeWidgets,
  cambiarTamano,
  disposicionPorDefecto,
  mostrarWidget,
  moverWidget,
  normalizarDisposicion,
  ocultarWidget,
} from './panel-de-widgets';
export type {
  DefinicionDeWidget,
  DisposicionDeWidget,
  PanelDeWidgetsProps,
  TamanoDeWidget,
} from './panel-de-widgets';
