/**
 * Búsqueda de credenciales escritas en el código de un paquete.
 *
 * Vive aquí para que la usen los dos paquetes de la rebanada con la misma regla:
 * `@aiw/db` y `@aiw/ledger` la llaman con su propia raíz. `gitleaks` cubre la
 * historia completa en la CI; esto cubre lo que se escribe hoy, y falla en local
 * antes de llegar a la CI.
 *
 * `@aiw/domain` no puede usarla porque no depende de ningún paquete del monorepo,
 * que es su frontera; tampoco tiene cadenas de conexión que proteger.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const EXTENSIONES = ['.ts', '.sql', '.json', '.md'];

/** Cadena de conexión con contraseña incrustada. */
export const CONEXION_CON_CONTRASENA =
  /(postgres(ql)?|mysql|redis|amqp):\/\/[^\s'"`]*:[^\s'"`@]+@/i;

/** Asignación de contraseña o clave con un valor literal que no sea vacío ni GENERAR. */
export const CLAVE_LITERAL =
  /(password|contrasena|contraseña|secret|api[_-]?key|token)\s*[:=]\s*['"`](?!GENERAR|\s*$)[^'"`]{8,}['"`]/i;

/**
 * Los ficheros de esta comprobación contienen los patrones que busca, así que se
 * excluyen: si no, se denunciarían a sí mismos.
 */
function esLaPropiaComprobacion(ruta: string): boolean {
  return ruta.endsWith('secretos.ts') || ruta.endsWith('secretos.test.ts');
}

export function ficherosDelPaquete(directorio: string): string[] {
  const encontrados: string[] = [];
  for (const entrada of readdirSync(directorio)) {
    if (entrada === 'node_modules' || entrada === 'dist' || entrada === '.turbo') continue;
    const ruta = join(directorio, entrada);
    if (statSync(ruta).isDirectory()) {
      encontrados.push(...ficherosDelPaquete(ruta));
    } else if (EXTENSIONES.some((ext) => entrada.endsWith(ext))) {
      encontrados.push(ruta);
    }
  }
  return encontrados;
}

export interface HallazgosDeSecretos {
  ficheros: string[];
  conexionesConContrasena: string[];
  clavesLiterales: string[];
}

/** Recorre el paquete y devuelve qué ficheros llevan credenciales, si alguno. */
export function buscarSecretos(raiz: string): HallazgosDeSecretos {
  const ficheros = ficherosDelPaquete(raiz);
  const conexionesConContrasena: string[] = [];
  const clavesLiterales: string[] = [];

  for (const ruta of ficheros) {
    if (esLaPropiaComprobacion(ruta)) continue;
    const contenido = readFileSync(ruta, 'utf8');
    if (CONEXION_CON_CONTRASENA.test(contenido)) conexionesConContrasena.push(ruta);
    if (CLAVE_LITERAL.test(contenido)) clavesLiterales.push(ruta);
  }

  return { ficheros, conexionesConContrasena, clavesLiterales };
}
