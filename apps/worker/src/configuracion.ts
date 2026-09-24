/**
 * Configuración del trabajador, leída del entorno y validada al arrancar.
 *
 * La bandera `AIW_PRUEBA_STACK` viene apagada. Con ella apagada el proceso no
 * conecta con Temporal, no abre conexión a la base y no registra ningún conector:
 * imprime qué le falta y termina con código cero. Eso no es cortesía, es un
 * requisito de la integración continua —el job «Imagen worker» arranca el
 * contenedor y espera que salga limpio— y la forma de desplegar esta rebanada en
 * staging sin que haga nada hasta la demostración.
 *
 * Aquí no hay ningún valor por defecto que sea un secreto. Lo que falta, falta.
 */

/** Bandera de funcionalidad de esta rebanada. `1` la enciende. */
export const BANDERA = 'AIW_PRUEBA_STACK';

export interface Configuracion {
  encendida: boolean;
  urlBaseDeDatos: string | undefined;
  temporal: { direccion: string; espacio: string; cola: string };
  /** Referencia del secreto del conector de demostración, solo informativa. */
  conectorDemoConfigurado: boolean;
}

/**
 * Bandera del aprendizaje v0 (docs/specs/aprendizaje-v0.md, decisión 9). Enciende el
 * arranque del flujo de aprendizaje desde la tarea, la demo y el CLI de promoción.
 * Apagada, una edición se anota como señal genérica del bucle y nada más.
 */
export const BANDERA_APRENDIZAJE = 'AIW_APRENDIZAJE_V0';

export function aprendizajeEncendido(
  entorno: Record<string, string | undefined> = process.env,
): boolean {
  return entorno[BANDERA_APRENDIZAJE] === '1';
}

/** Cola de tareas de Temporal. Una por rebanada mientras no haya enrutado por puesto. */
export const COLA_POR_DEFECTO = 'aiw-prueba-stack';

function texto(nombre: string, porDefecto: string): string {
  const valor = process.env[nombre];
  return valor === undefined || valor === '' ? porDefecto : valor;
}

export function leerConfiguracion(
  entorno: Record<string, string | undefined> = process.env,
): Configuracion {
  const url = entorno['DATABASE_URL'];
  return {
    encendida: entorno[BANDERA] === '1',
    urlBaseDeDatos: url === undefined || url === '' ? undefined : url,
    temporal: {
      direccion: texto('AIW_TEMPORAL_DIRECCION', 'localhost:7233'),
      espacio: texto('AIW_TEMPORAL_ESPACIO', 'default'),
      cola: texto('AIW_TEMPORAL_COLA', COLA_POR_DEFECTO),
    },
    conectorDemoConfigurado:
      entorno['DEMO_CONECTOR_SECRETO'] !== undefined && entorno['DEMO_CONECTOR_SECRETO'] !== '',
  };
}

/** Lo que le falta a esta configuración para poder arrancar de verdad. */
export function queFalta(configuracion: Configuracion): string[] {
  const falta: string[] = [];
  if (!configuracion.encendida) falta.push(`la bandera ${BANDERA}=1`);
  if (configuracion.urlBaseDeDatos === undefined) falta.push('DATABASE_URL');
  if (!configuracion.conectorDemoConfigurado) falta.push('DEMO_CONECTOR_SECRETO');
  return falta;
}
