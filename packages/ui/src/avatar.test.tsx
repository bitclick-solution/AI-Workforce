import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AvatarDeAgente, AvatarDePersona } from './avatar';

describe('AvatarDeAgente', () => {
  it('es su nombre accesible y lleva el color pastel pedido', () => {
    const html = renderToStaticMarkup(<AvatarDeAgente nombre="Cobros" color="menta" />);
    expect(html).toContain('aria-label="Cobros"');
    expect(html).toContain('role="img"');
    expect(html).toContain('bg-avatar-menta');
  });

  it('dibuja el emblema del puesto cuando se le pide', () => {
    const html = renderToStaticMarkup(<AvatarDeAgente nombre="Cobros" puesto="cobros" />);
    expect(html).toContain('€');
  });

  it('sin puesto no dibuja emblema', () => {
    const html = renderToStaticMarkup(<AvatarDeAgente nombre="Cobros" />);
    expect(html).not.toContain('€');
  });

  it('anuncia el estado con texto y no solo con el anillo', () => {
    const necesita = renderToStaticMarkup(<AvatarDeAgente nombre="Cobros" estado="te-necesita" />);
    expect(necesita).toContain('Te necesita');
    expect(necesita).toContain('ring-alerta');

    const trabajando = renderToStaticMarkup(<AvatarDeAgente nombre="Cobros" estado="trabajando" />);
    expect(trabajando).toContain('Trabajando');
    expect(trabajando).toContain('animate-girar');

    const espera = renderToStaticMarkup(<AvatarDeAgente nombre="Cobros" estado="en-espera" />);
    expect(espera).toContain('En espera');
    expect(espera).toContain('ring-inactivo');
  });
});

describe('AvatarDePersona', () => {
  it('muestra las iniciales calculadas del nombre', () => {
    const html = renderToStaticMarkup(<AvatarDePersona nombre="Jesús Ortega" />);
    expect(html).toContain('>JO<');
  });

  it('acepta iniciales explícitas', () => {
    const html = renderToStaticMarkup(<AvatarDePersona nombre="Jesús Ortega" iniciales="J" />);
    expect(html).toContain('>J<');
  });

  it('cae a una silueta cuando no hay nombre', () => {
    const html = renderToStaticMarkup(<AvatarDePersona nombre="" />);
    expect(html).toContain('<svg');
    expect(html).toContain('aria-label=""');
  });
});
