/**
 * Memoria durable del borrador pendiente de cada clave de idempotencia.
 *
 * Si el proceso cae entre crear el borrador y confirmarlo, la reanudación necesita
 * saber qué borrador era para consultar `get_estado_borrador` en vez de crear un
 * segundo. Lo que se guarda no es secreto: la huella de los datos, el identificador
 * del borrador y el texto que dejaría en `observaciones` (el mismo que ya aprobó
 * una persona). Ningún token pasa por aquí.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface BorradorGuardado {
  readonly huella: string;
  readonly draftId: string;
  readonly clienteCodigo: string;
  /** Lo que el borrador deja en `observaciones`. */
  readonly observaciones: string;
  /** Solo la línea nueva: sirve para comprobar «el actual más la nota aprobada». */
  readonly linea: string;
  readonly creadoEn: string;
}

export interface AlmacenDeBorradores {
  leer(clave: string): Promise<BorradorGuardado | undefined>;
  guardar(clave: string, borrador: BorradorGuardado): Promise<void>;
  borrar(clave: string): Promise<void>;
}

export function almacenDeBorradoresEnMemoria(): AlmacenDeBorradores {
  const mapa = new Map<string, BorradorGuardado>();
  return {
    leer: (clave) => Promise.resolve(mapa.get(clave)),
    guardar: (clave, borrador) => {
      mapa.set(clave, borrador);
      return Promise.resolve();
    },
    borrar: (clave) => {
      mapa.delete(clave);
      return Promise.resolve();
    },
  };
}

function rutaDe(directorio: string, clave: string): string {
  // El nombre es el hash de la clave: una clave con `../` no sale del directorio.
  return join(directorio, `${createHash('sha256').update(clave).digest('hex')}.json`);
}

/** Un fichero por clave en un directorio propio del conector, escrito de forma atómica. */
export function almacenDeBorradoresEnFichero(directorio: string): AlmacenDeBorradores {
  return {
    async leer(clave) {
      try {
        return JSON.parse(await readFile(rutaDe(directorio, clave), 'utf8')) as BorradorGuardado;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    async guardar(clave, borrador) {
      await mkdir(directorio, { recursive: true });
      const destino = rutaDe(directorio, clave);
      await writeFile(`${destino}.tmp`, JSON.stringify(borrador), 'utf8');
      await rename(`${destino}.tmp`, destino);
    },
    async borrar(clave) {
      await rm(rutaDe(directorio, clave), { force: true });
    },
  };
}
