/**
 * Sin credenciales en código, prompts ni registros, comprobado por prueba.
 *
 * Recorre el código fuente del paquete y rechaza cadenas de conexión con
 * contraseña y asignaciones de contraseña literales. `gitleaks` cubre la historia
 * completa en la CI; esto cubre lo que se escribe hoy.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));

const EXTENSIONES = ['.ts', '.sql', '.json', '.md'];

/** Cadena de conexión con contraseña incrustada. */
const CONEXION_CON_CONTRASENA = /(postgres(ql)?|mysql|redis|amqp):\/\/[^\s'"`]*:[^\s'"`@]+@/i;

/** Asignación de contraseña o clave con un valor literal que no sea vacío ni GENERAR. */
const CLAVE_LITERAL =
  /(password|contrasena|contraseña|secret|api[_-]?key|token)\s*[:=]\s*['"`](?!GENERAR|\s*$)[^'"`]{8,}['"`]/i;

function ficheros(directorio: string): string[] {
  const encontrados: string[] = [];
  for (const entrada of readdirSync(directorio)) {
    if (entrada === 'node_modules' || entrada === 'dist' || entrada === '.turbo') continue;
    const ruta = join(directorio, entrada);
    if (statSync(ruta).isDirectory()) {
      encontrados.push(...ficheros(ruta));
    } else if (EXTENSIONES.some((ext) => entrada.endsWith(ext))) {
      encontrados.push(ruta);
    }
  }
  return encontrados;
}

describe('sin secretos en el paquete', () => {
  const rutas = ficheros(RAIZ);

  it('encuentra el código del paquete', () => {
    expect(rutas.length).toBeGreaterThan(10);
  });

  it('ninguna cadena de conexión lleva contraseña', () => {
    const culpables = rutas.filter((ruta) => {
      const contenido = readFileSync(ruta, 'utf8');
      // La propia prueba contiene el patrón que busca.
      if (ruta.endsWith('secretos.test.ts')) return false;
      return CONEXION_CON_CONTRASENA.test(contenido);
    });
    expect(culpables, `Credenciales en: ${culpables.join(', ')}`).toEqual([]);
  });

  it('ninguna contraseña ni clave está escrita en el código', () => {
    const culpables = rutas.filter((ruta) => {
      if (ruta.endsWith('secretos.test.ts')) return false;
      return CLAVE_LITERAL.test(readFileSync(ruta, 'utf8'));
    });
    expect(culpables, `Claves literales en: ${culpables.join(', ')}`).toEqual([]);
  });

  it('la conexión llega del entorno, no del código', () => {
    const cli = readFileSync(join(RAIZ, 'src/cli.ts'), 'utf8');
    expect(cli).toContain("process.env['DATABASE_URL']");
  });
});
