import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TarjetaDeWidget } from './tarjeta-de-widget';

describe('TarjetaDeWidget', () => {
  it('muestra el título y el contenido', () => {
    const html = renderToStaticMarkup(
      <TarjetaDeWidget titulo="Coste del mes">120 €</TarjetaDeWidget>,
    );
    expect(html).toContain('Coste del mes');
    expect(html).toContain('120 €');
  });

  it('sin alQuitar no lleva botón de quitar', () => {
    const html = renderToStaticMarkup(<TarjetaDeWidget titulo="Coste del mes" />);
    expect(html).not.toContain('<button');
  });

  it('con alQuitar lleva un botón accesible con el nombre del widget', () => {
    const html = renderToStaticMarkup(
      <TarjetaDeWidget titulo="Coste del mes" alQuitar={() => undefined} />,
    );
    expect(html).toContain('<button');
    expect(html).toContain('aria-label="Quitar «Coste del mes» del panel"');
  });
});
