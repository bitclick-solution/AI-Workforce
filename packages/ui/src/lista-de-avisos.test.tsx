import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Aviso } from './aviso';
import { Boton } from './boton';
import { ListaDeAvisos } from './lista-de-avisos';

describe('ListaDeAvisos', () => {
  it('envuelve cada aviso en su propio elemento de lista', () => {
    const html = renderToStaticMarkup(
      <ListaDeAvisos titulo="Te necesitan">
        <Aviso tipo="necesita-persona" titulo="Factura disputada" accion={<Boton>Abrir</Boton>} />
        <Aviso tipo="necesita-persona" titulo="IBAN nuevo" accion={<Boton>Abrir</Boton>} />
      </ListaDeAvisos>,
    );
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Te necesitan"');
  });

  it('sin avisos muestra el mensaje vacío', () => {
    const html = renderToStaticMarkup(<ListaDeAvisos titulo="Te necesitan" />);
    expect(html).toContain('No hay avisos pendientes.');
    expect(html).not.toContain('<ol');
  });
});
