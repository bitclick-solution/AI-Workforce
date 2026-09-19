/** Une clases CSS ignorando valores vacíos. */
export function cn(...clases: (string | false | null | undefined)[]): string {
  return clases
    .filter((clase): clase is string => typeof clase === 'string' && clase !== '')
    .join(' ');
}
