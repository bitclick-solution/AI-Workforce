import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Boton } from './boton';
import { crearTraductor, ProveedorDeIdioma } from './i18n';

describe('crearTraductor', () => {
  it('devuelve la cadena del idioma pedido', () => {
    expect(crearTraductor('es')('ui.aviso.error')).toBe('Algo ha fallado');
    expect(crearTraductor('en')('ui.aviso.error')).toBe('Something went wrong');
  });

  it('cae al castellano cuando al idioma le falta la clave', () => {
    expect(crearTraductor('en')('ui.duracion.minutos', { valor: 3 })).toBe('3 min');
  });

  it('sustituye los parámetros y deja intacto lo que no recibe', () => {
    expect(crearTraductor('es')('ui.duracion.segundos', { valor: 12 })).toBe('12 s');
    expect(crearTraductor('es')('ui.duracion.segundos')).toBe('{valor} s');
  });
});

describe('ProveedorDeIdioma', () => {
  it('cambia el texto de los componentes que cuelgan de él', () => {
    const conIngles = renderToStaticMarkup(
      <ProveedorDeIdioma idioma="en">
        <Boton cargando>Aprobar</Boton>
      </ProveedorDeIdioma>,
    );
    expect(conIngles).toContain('Working');

    const porDefecto = renderToStaticMarkup(
      <ProveedorDeIdioma>
        <Boton cargando>Aprobar</Boton>
      </ProveedorDeIdioma>,
    );
    expect(porDefecto).toContain('Trabajando');
  });
});
