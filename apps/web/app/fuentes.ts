import { Bricolage_Grotesque, Figtree } from 'next/font/google';

/**
 * Tipografías «Oficina cercana» (ADR-020). `next/font` las descarga en el
 * momento de compilar y las sirve desde este dominio: por RGPD, nunca se
 * cargan desde los servidores de Google en tiempo de ejecución.
 */
export const bricolageGrotesque = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: 'variable',
  variable: '--fuente-titulos',
  display: 'swap',
});

export const figtree = Figtree({
  subsets: ['latin'],
  weight: 'variable',
  variable: '--fuente-texto',
  display: 'swap',
});
