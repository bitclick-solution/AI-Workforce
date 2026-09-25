import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Indicador } from './indicador';

describe('Indicador', () => {
  it('muestra la etiqueta y el valor', () => {
    const html = renderToStaticMarkup(<Indicador etiqueta="Tareas del periodo" valor="42" />);
    expect(html).toContain('Tareas del periodo');
    expect(html).toContain('42');
  });

  it('colorea el valor según el tono', () => {
    const html = renderToStaticMarkup(<Indicador etiqueta="Vencidas" valor="3" tono="peligro" />);
    expect(html).toContain('text-peligro');
  });
});
