import { describe, expect, it } from 'vitest';

import { ratioDeContraste } from './contraste';
import { PALETA_CLARA, PALETA_OSCURA, type PaletaDeModo } from './paleta';

const MINIMO_AA = 4.5;

/** Cada par de texto y fondo que el sistema usa de verdad, en ese sentido. */
function paresDeTextoYFondo(p: PaletaDeModo): [string, string, string][] {
  return [
    ['texto sobre fondo', p.texto, p.fondo],
    ['texto sobre superficie', p.texto, p.superficie],
    ['texto sobre superficie 2', p.texto, p.superficie2],
    ['texto 2 sobre fondo', p.texto2, p.fondo],
    ['texto 2 sobre superficie', p.texto2, p.superficie],
    ['texto 2 sobre superficie 2', p.texto2, p.superficie2],
    ['texto 3 sobre superficie', p.texto3, p.superficie],
    ['texto de alerta sobre alerta suave', p.textoAlerta, p.alertaSuave],
    ['sobre alerta sobre alerta', p.sobreAlerta, p.alerta],
    ['peligro sobre peligro suave', p.peligro, p.peligroSuave],
    ['sobre peligro sobre peligro', p.sobrePeligro, p.peligro],
    ['texto correcto sobre correcto suave', p.textoCorrecto, p.correctoSuave],
    ['sobre persona sobre persona', p.sobrePersona, p.persona],
    ['sobre acento sobre acento', p.sobreAcento, p.acento],
    ['acento sobre acento suave', p.acento, p.acentoSuave],
    ['sobre coral sobre coral', p.sobreCoral, p.coral],
    ['coral sobre coral suave', p.coral, p.coralSuave],
    ['sobre azul sobre azul', p.sobreAzul, p.azul],
    ['azul sobre azul suave', p.azul, p.azulSuave],
  ];
}

describe.each([
  ['claro', PALETA_CLARA],
  ['oscuro', PALETA_OSCURA],
] as const)('contraste AA (4,5:1) · modo %s', (_nombreDelModo, paleta) => {
  it.each(paresDeTextoYFondo(paleta))('%s cumple el mínimo de la AA', (_etiqueta, texto, fondo) => {
    expect(ratioDeContraste(texto, fondo)).toBeGreaterThanOrEqual(MINIMO_AA);
  });
});

describe('ratioDeContraste', () => {
  it('negro sobre blanco da el contraste máximo', () => {
    expect(ratioDeContraste('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
  });

  it('un color sobre sí mismo da el contraste mínimo', () => {
    expect(ratioDeContraste('#5B3FC4', '#5B3FC4')).toBeCloseTo(1, 5);
  });

  it('no depende del orden de los argumentos', () => {
    expect(ratioDeContraste('#221A30', '#F7F5FB')).toBeCloseTo(
      ratioDeContraste('#F7F5FB', '#221A30'),
      10,
    );
  });
});
