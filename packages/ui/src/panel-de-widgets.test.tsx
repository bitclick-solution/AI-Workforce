import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  PanelDeWidgets,
  cambiarTamano,
  disposicionPorDefecto,
  mostrarWidget,
  moverWidget,
  normalizarDisposicion,
  ocultarWidget,
  type DisposicionDeWidget,
} from './panel-de-widgets';

const CATALOGO = ['saludo', 'contador', 'equipo'];

function disposicionDeMuestra(): DisposicionDeWidget[] {
  return disposicionPorDefecto(CATALOGO);
}

describe('disposicionPorDefecto', () => {
  it('crea una entrada visible y mediana por cada widget pedido', () => {
    expect(disposicionPorDefecto(['a', 'b'])).toEqual([
      { id: 'a', tamano: 'mediano', oculto: false },
      { id: 'b', tamano: 'mediano', oculto: false },
    ]);
  });
});

describe('normalizarDisposicion', () => {
  it('conserva el orden guardado y descarta lo que ya no está en el catálogo', () => {
    const guardada: DisposicionDeWidget[] = [
      { id: 'equipo', tamano: 'grande', oculto: false },
      { id: 'salió-del-catalogo', tamano: 'pequeno', oculto: false },
      { id: 'saludo', tamano: 'pequeno', oculto: true },
    ];
    expect(normalizarDisposicion(guardada, CATALOGO)).toEqual([
      { id: 'equipo', tamano: 'grande', oculto: false },
      { id: 'saludo', tamano: 'pequeno', oculto: true },
      { id: 'contador', tamano: 'mediano', oculto: false },
    ]);
  });

  it('descarta duplicados y usa mediano cuando el tamaño guardado no es válido', () => {
    const guardada = [
      { id: 'saludo', tamano: 'enorme' as unknown as DisposicionDeWidget['tamano'], oculto: false },
      { id: 'saludo', tamano: 'grande' as const, oculto: false },
    ];
    const normalizada = normalizarDisposicion(guardada, ['saludo']);
    expect(normalizada).toEqual([{ id: 'saludo', tamano: 'mediano', oculto: false }]);
  });
});

describe('moverWidget', () => {
  it('sube un widget un puesto', () => {
    const siguiente = moverWidget(disposicionDeMuestra(), 'equipo', 'arriba');
    expect(siguiente.map((e) => e.id)).toEqual(['saludo', 'equipo', 'contador']);
  });

  it('en el primero, subir no hace nada', () => {
    const original = disposicionDeMuestra();
    expect(moverWidget(original, 'saludo', 'arriba')).toEqual(original);
  });

  it('en el último, bajar no hace nada', () => {
    const original = disposicionDeMuestra();
    expect(moverWidget(original, 'equipo', 'abajo')).toEqual(original);
  });
});

describe('cambiarTamano', () => {
  it('agranda de mediano a grande', () => {
    const siguiente = cambiarTamano(disposicionDeMuestra(), 'saludo', 'agrandar');
    expect(siguiente.find((e) => e.id === 'saludo')?.tamano).toBe('grande');
  });

  it('no agranda más allá de grande', () => {
    const grande: DisposicionDeWidget[] = [{ id: 'saludo', tamano: 'grande', oculto: false }];
    expect(cambiarTamano(grande, 'saludo', 'agrandar')).toEqual(grande);
  });

  it('no achica más allá de pequeño', () => {
    const pequeno: DisposicionDeWidget[] = [{ id: 'saludo', tamano: 'pequeno', oculto: false }];
    expect(cambiarTamano(pequeno, 'saludo', 'achicar')).toEqual(pequeno);
  });
});

describe('ocultarWidget y mostrarWidget', () => {
  it('oculta y vuelve a mostrar sin tocar el resto', () => {
    const oculta = ocultarWidget(disposicionDeMuestra(), 'contador');
    expect(oculta.find((e) => e.id === 'contador')?.oculto).toBe(true);
    const mostrada = mostrarWidget(oculta, 'contador');
    expect(mostrada.find((e) => e.id === 'contador')?.oculto).toBe(false);
  });
});

describe('PanelDeWidgets', () => {
  const widgets = {
    saludo: { titulo: 'Hola', contenido: 'Encarga algo' },
    contador: { titulo: 'Contador', contenido: '3 tareas' },
  };

  it('pinta cada widget visible con su título y contenido', () => {
    const html = renderToStaticMarkup(
      <PanelDeWidgets
        disposicion={disposicionPorDefecto(['saludo', 'contador'])}
        widgets={widgets}
        onCambiarDisposicion={() => undefined}
      />,
    );
    expect(html).toContain('Hola');
    expect(html).toContain('Encarga algo');
    expect(html).toContain('Contador');
  });

  it('un widget oculto no se pinta en la rejilla y aparece en «Ocultos»', () => {
    const disposicion: DisposicionDeWidget[] = [
      { id: 'saludo', tamano: 'mediano', oculto: false },
      { id: 'contador', tamano: 'mediano', oculto: true },
    ];
    const html = renderToStaticMarkup(
      <PanelDeWidgets
        disposicion={disposicion}
        widgets={widgets}
        onCambiarDisposicion={() => undefined}
      />,
    );
    expect(html).not.toContain('3 tareas');
    expect(html).toContain('Mostrar «Contador»');
  });

  it('el primero no puede subir y el último no puede bajar', () => {
    const html = renderToStaticMarkup(
      <PanelDeWidgets
        disposicion={disposicionPorDefecto(['saludo', 'contador'])}
        widgets={widgets}
        onCambiarDisposicion={() => undefined}
      />,
    );
    expect(html).toContain('aria-label="Subir «Hola»"');
    expect(html).toContain('aria-label="Bajar «Contador»"');
  });
});
