import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AvisoDeAprobacion } from './aviso-de-aprobacion';

describe('AvisoDeAprobacion', () => {
  it('siempre lleva un botón Aprobar y avisa con role alert', () => {
    const html = renderToStaticMarkup(
      <AvisoDeAprobacion titulo="Contratar a Cobros" alAprobar={() => undefined}>
        Un agente de conciliación en Finanzas.
      </AvisoDeAprobacion>,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Aprobar');
    expect(html).toContain('Un agente de conciliación en Finanzas.');
  });

  it('sin alRechazar no muestra el botón Rechazar', () => {
    const html = renderToStaticMarkup(
      <AvisoDeAprobacion titulo="Contratar a Cobros" alAprobar={() => undefined} />,
    );
    expect(html).not.toContain('Rechazar');
  });

  it('con alRechazar muestra los dos botones', () => {
    const html = renderToStaticMarkup(
      <AvisoDeAprobacion
        titulo="Contratar a Cobros"
        alAprobar={() => undefined}
        alRechazar={() => undefined}
      />,
    );
    expect(html).toContain('Aprobar');
    expect(html).toContain('Rechazar');
  });
});
