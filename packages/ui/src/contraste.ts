interface CanalesRGB {
  r: number;
  g: number;
  b: number;
}

function aCanales(colorHex: string): CanalesRGB {
  const limpio = colorHex.replace('#', '');
  return {
    r: parseInt(limpio.slice(0, 2), 16),
    g: parseInt(limpio.slice(2, 4), 16),
    b: parseInt(limpio.slice(4, 6), 16),
  };
}

function canalLineal(canal: number): number {
  const c = canal / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminanciaRelativa({ r, g, b }: CanalesRGB): number {
  return 0.2126 * canalLineal(r) + 0.7152 * canalLineal(g) + 0.0722 * canalLineal(b);
}

/**
 * Contraste WCAG entre dos colores `#RRGGBB`. El orden de los argumentos no
 * importa: la fórmula usa siempre la luminancia clara entre la oscura.
 */
export function ratioDeContraste(colorA: string, colorB: string): number {
  const luminanciaA = luminanciaRelativa(aCanales(colorA));
  const luminanciaB = luminanciaRelativa(aCanales(colorB));
  const clara = Math.max(luminanciaA, luminanciaB);
  const oscura = Math.min(luminanciaA, luminanciaB);
  return (clara + 0.05) / (oscura + 0.05);
}
