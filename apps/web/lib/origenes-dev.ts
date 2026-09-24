/**
 * Orígenes que el servidor de desarrollo de Next acepta además de `localhost`.
 *
 * Por qué existe: en desarrollo, Next sirve la página a cualquier host pero
 * devuelve 403 en `/_next/static/**` si la petición llega desde un origen que no
 * ha autorizado. Abrir el prototipo desde el móvil por la IP del portátil
 * entrega el HTML y la hoja de estilos, pero **no el JavaScript**: la página se
 * ve bien, los enlaces navegan porque son HTML, y ningún botón responde porque
 * React nunca llega a hidratar. Es un fallo mudo y confuso, y justo la
 * aprobación móvil es el flujo que hay que probar en un teléfono de verdad.
 *
 * Esto solo afecta a `next dev`. En producción no hay bloqueo.
 */

export interface DireccionDeRed {
  family: string | number;
  address: string;
  internal: boolean;
}

export type InterfacesDeRed = Record<string, DireccionDeRed[] | undefined>;

function esIPv4Externa(direccion: DireccionDeRed): boolean {
  return !direccion.internal && (direccion.family === 'IPv4' || direccion.family === 4);
}

/**
 * Las IPv4 de red de esta máquina, más los nombres de `AIW_DEV_ORIGENES`
 * separados por comas (para túneles tipo ngrok o Tailscale).
 *
 * Solo hosts, sin protocolo ni puerto, que es lo que `allowedDevOrigins` espera.
 */
export function origenesDeDesarrollo(
  interfaces: InterfacesDeRed,
  extra?: string | undefined,
): string[] {
  const deLaMaquina = Object.values(interfaces)
    .flatMap((direcciones) => direcciones ?? [])
    .filter(esIPv4Externa)
    .map((direccion) => direccion.address);

  const declarados = (extra ?? '')
    .split(',')
    .map((origen) => origen.trim())
    .filter((origen) => origen !== '')
    // Tolera que alguien pegue la URL entera del túnel en vez del host.
    .map((origen) => origen.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, ''));

  return [...new Set([...deLaMaquina, ...declarados])].sort();
}
