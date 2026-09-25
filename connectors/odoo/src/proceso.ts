/**
 * Arranque del proceso.
 *
 * Node entrega `process.argv[1]` como ruta del sistema de archivos e
 * `import.meta.url` como URL. Componer la URL a mano con `file://` funciona en
 * Linux y en macOS y falla en Windows, donde la ruta es `D:\\…` y la URL es
 * `file:///D:/…`: el guardia no coincide nunca y el módulo no ejecuta nada.
 * `pathToFileURL` hace la conversión en las tres plataformas.
 */
import { pathToFileURL } from 'node:url';

export function esProcesoPrincipal(urlDelModulo: string, argumentos = process.argv): boolean {
  const punto = argumentos[1];
  if (punto === undefined) {
    return false;
  }
  return urlDelModulo === pathToFileURL(punto).href;
}
