import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ProveedorDeIdioma } from './i18n';
import { LineaDeNiveles } from './linea-de-niveles';
import { MedidorDeCriterio } from './medidor-de-criterio';

describe('MedidorDeCriterio', () => {
  it('con dato dice el valor y si falta o se cumple, con palabras', () => {
    const falta = renderToStaticMarkup(
      <MedidorDeCriterio
        etiqueta="Acciones"
        valor="12 de 30"
        requerido="al menos 30"
        progreso={0.4}
        cumplido={false}
      />,
    );
    expect(falta).toContain('12 de 30');
    expect(falta).toContain('Pendiente');
    expect(falta).toContain('aria-valuenow="40"');
    expect(falta).toContain('role="meter"');

    const cumple = renderToStaticMarkup(
      <MedidorDeCriterio
        etiqueta="Acciones"
        valor="31 de 30"
        requerido="al menos 30"
        progreso={1.4}
        cumplido
      />,
    );
    expect(cumple).toContain('Cumplido');
    expect(cumple).toContain('aria-valuenow="100"');
  });

  it('sin dato lo dice en vez de enseñar un cero', () => {
    const html = renderToStaticMarkup(
      <MedidorDeCriterio
        etiqueta="Días sin incidentes"
        valor={null}
        requerido="al menos 30"
        progreso={null}
        cumplido={false}
      />,
    );
    expect(html).toContain('Sin datos todavía');
    expect(html).toContain('aria-valuetext="Sin datos todavía"');
  });

  it('se traduce con el proveedor de idioma', () => {
    const html = renderToStaticMarkup(
      <ProveedorDeIdioma idioma="en">
        <MedidorDeCriterio
          etiqueta="Actions"
          valor={null}
          requerido="at least 30"
          progreso={null}
          cumplido={false}
        />
      </ProveedorDeIdioma>,
    );
    expect(html).toContain('No data yet');
    expect(html).toContain('Pending');
  });
});

describe('LineaDeNiveles', () => {
  it('muestra el nivel inicial y cada cambio en orden, con su fecha', () => {
    const html = renderToStaticMarkup(
      <LineaDeNiveles
        inicial="Empezó en N1 · supervisado"
        cambios={[
          {
            id: 'a',
            titulo: 'De N1 a N2',
            cuando: 'hace 10 días',
            instante: '2026-09-22T10:00:00.000Z',
            children: 'Versión 3',
          },
        ]}
      />,
    );
    expect(html).toContain('Historial de niveles');
    expect(html.indexOf('Empezó en N1')).toBeLessThan(html.indexOf('De N1 a N2'));
    expect(html).toContain('hace 10 días');
    expect(html).toContain('dateTime="2026-09-22T10:00:00.000Z"');
    expect(html).toContain('Versión 3');
  });

  it('sin cambios enseña solo el nivel inicial', () => {
    const html = renderToStaticMarkup(<LineaDeNiveles inicial="Empezó en N0" cambios={[]} />);
    expect(html).toContain('Empezó en N0');
    expect((html.match(/<li/g) ?? []).length).toBe(1);
  });
});
