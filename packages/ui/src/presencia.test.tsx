import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FilaDePresencia } from './fila-de-presencia';
import { HojaMovil } from './hoja-movil';
import { crearTraductor, ProveedorDeIdioma } from './i18n';
import { IndicadorDeEscritura, textoDeEscritura } from './indicador-de-escritura';
import {
  FilaDeMiembro,
  filtrarMiembros,
  filtroDeEstado,
  lineaDeEstado,
  PanelDeMiembros,
  type MiembroVisible,
} from './miembros';
import { NavegacionDeSalas, textoDeContadores } from './navegacion-de-salas';
import {
  AvatarConPresencia,
  ESTADOS_DE_PRESENCIA,
  ESTADOS_SOLO_DE_AGENTE,
  EtiquetaIA,
  estadoParaTipo,
  MarcaDePresencia,
  textoDePresencia,
} from './presencia';
import { TarjetaDePropuesta } from './tarjeta-de-propuesta';

function en<T>(lista: readonly T[], indice: number): T {
  const valor = lista[indice];
  if (valor === undefined) throw new Error(`Falta el elemento ${indice}`);
  return valor;
}

const t = crearTraductor('es');

const MIEMBROS: MiembroVisible[] = [
  { id: 'p1', tipo: 'persona', nombre: 'Lucía Ferrán', estado: 'en-la-sala', contexto: 'Gerente' },
  { id: 'p2', tipo: 'persona', nombre: 'Tomás Rivel', estado: 'inactivo', detalle: '15 min' },
  { id: 'p3', tipo: 'persona', nombre: 'Asesoría Olmo', estado: 'anadido' },
  { id: 'a1', tipo: 'agente', nombre: 'Cobros', estado: 'te-necesita' },
  { id: 'a2', tipo: 'agente', nombre: 'Conciliación', estado: 'trabajando' },
  { id: 'a3', tipo: 'agente', nombre: 'Previsión', estado: 'en-pausa' },
  { id: 'a4', tipo: 'agente', nombre: 'Moderador', estado: 'escribiendo' },
];

describe('MarcaDePresencia', () => {
  it('cada estado tiene su forma y la marca no se lee sola', () => {
    const formas = new Set<string>();
    for (const estado of ESTADOS_DE_PRESENCIA) {
      const html = renderToStaticMarkup(<MarcaDePresencia estado={estado} />);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain(`data-forma="${estado}"`);
      formas.add(html.replace(`data-forma="${estado}"`, ''));
    }
    // Siete estados, siete marcas distintas: no solo cambia el color.
    expect(formas.size).toBe(ESTADOS_DE_PRESENCIA.length);
  });

  it('lleva símbolo propio en inactivo, trabajando, te necesita, escribiendo y en pausa', () => {
    expect(renderToStaticMarkup(<MarcaDePresencia estado="inactivo" />)).toContain('<svg');
    expect(renderToStaticMarkup(<MarcaDePresencia estado="trabajando" />)).toContain('<path');
    expect(renderToStaticMarkup(<MarcaDePresencia estado="te-necesita" />)).toContain('<circle');
    expect(
      renderToStaticMarkup(<MarcaDePresencia estado="escribiendo" />).match(/animate-teclear/g),
    ).toHaveLength(3);
    expect(
      renderToStaticMarkup(<MarcaDePresencia estado="en-pausa" />).match(/h-\[7px\]/g),
    ).toHaveLength(2);
  });
});

describe('estados y textos', () => {
  it('todos los estados tienen texto en castellano y en inglés', () => {
    const en = crearTraductor('en');
    for (const estado of ESTADOS_DE_PRESENCIA) {
      expect(textoDePresencia(t, estado)).not.toContain('ui.');
      expect(textoDePresencia(en, estado)).not.toContain('ui.');
    }
    expect(textoDePresencia(t, 'anadido')).toBe('Añadido');
    expect(textoDePresencia(t, 'te-necesita')).toBe('Te necesita');
  });

  it('una persona nunca se pinta con un estado solo de agente', () => {
    for (const estado of ESTADOS_SOLO_DE_AGENTE) {
      expect(estadoParaTipo(estado, 'persona')).toBe('en-la-sala');
      expect(estadoParaTipo(estado, 'agente')).toBe(estado);
    }
    expect(estadoParaTipo('inactivo', 'persona')).toBe('inactivo');
  });
});

describe('AvatarConPresencia', () => {
  it('el nombre accesible junta nombre y estado', () => {
    const html = renderToStaticMarkup(
      <AvatarConPresencia tipo="agente" nombre="Cobros" estado="te-necesita" />,
    );
    expect(html).toContain('aria-label="Cobros, Te necesita"');
    expect(html).toContain('data-estado="te-necesita"');
    expect(html).toContain('ring-alerta');
  });

  it('trabajando lleva el anillo discontinuo y añadido atenúa el avatar', () => {
    expect(
      renderToStaticMarkup(
        <AvatarConPresencia tipo="agente" nombre="Conciliación" estado="trabajando" />,
      ),
    ).toContain('border-dashed');
    expect(
      renderToStaticMarkup(
        <AvatarConPresencia tipo="persona" nombre="Asesoría Olmo" estado="anadido" />,
      ),
    ).toContain('opacity-50');
  });

  it('una persona «trabajando» se corrige a «en la sala»', () => {
    const html = renderToStaticMarkup(
      <AvatarConPresencia tipo="persona" nombre="Lucía Ferrán" estado="trabajando" />,
    );
    expect(html).toContain('aria-label="Lucía Ferrán, En la sala"');
  });
});

describe('EtiquetaIA', () => {
  it('se ve «IA» y se lee «Agente de IA»', () => {
    const html = renderToStaticMarkup(<EtiquetaIA />);
    expect(html).toContain('>IA<');
    expect(html).toContain('Agente de IA');
    const ingles = renderToStaticMarkup(
      <ProveedorDeIdioma idioma="en">
        <EtiquetaIA />
      </ProveedorDeIdioma>,
    );
    expect(ingles).toContain('>AI<');
  });
});

describe('FilaDeMiembro', () => {
  it('muestra el estado en texto, con contexto y detalle', () => {
    const html = renderToStaticMarkup(<FilaDeMiembro miembro={en(MIEMBROS, 1)} />);
    expect(html).toContain('Tomás Rivel');
    expect(html).toContain('Inactivo · 15 min');
    expect(html).toContain('min-h-11');
  });

  it('los agentes llevan la etiqueta IA y el avatar no se lee dos veces', () => {
    const html = renderToStaticMarkup(<FilaDeMiembro miembro={en(MIEMBROS, 3)} />);
    expect(html).toContain('Agente de IA');
    expect(html).toContain('Te necesita');
    expect(html).toMatch(/<span aria-hidden="true" class="inline-flex"><span role="img"/);
  });

  it('redacta la línea de estado sin huecos', () => {
    expect(lineaDeEstado('En la sala', 'Gerente', undefined)).toBe('Gerente · En la sala');
    expect(lineaDeEstado('Añadido', undefined, 'desde ayer')).toBe('Añadido · desde ayer');
  });
});

describe('filtros de miembros', () => {
  it('en pausa cuenta como inactivo y los estados activos como en la sala', () => {
    expect(filtroDeEstado('en-pausa')).toBe('inactivos');
    expect(filtroDeEstado('inactivo')).toBe('inactivos');
    expect(filtroDeEstado('anadido')).toBe('anadidos');
    for (const estado of ['en-la-sala', 'escribiendo', 'trabajando', 'te-necesita'] as const) {
      expect(filtroDeEstado(estado)).toBe('sala');
    }
  });

  it('filtra sin perder a nadie entre los tres grupos', () => {
    const sala = filtrarMiembros(MIEMBROS, 'sala');
    const inactivos = filtrarMiembros(MIEMBROS, 'inactivos');
    const anadidos = filtrarMiembros(MIEMBROS, 'anadidos');
    expect(sala.map((m) => m.id)).toEqual(['p1', 'a1', 'a2', 'a4']);
    expect(inactivos.map((m) => m.id)).toEqual(['p2', 'a3']);
    expect(anadidos.map((m) => m.id)).toEqual(['p3']);
    expect(sala.length + inactivos.length + anadidos.length).toBe(MIEMBROS.length);
    expect(filtrarMiembros(MIEMBROS, 'todos')).toHaveLength(MIEMBROS.length);
  });
});

describe('PanelDeMiembros', () => {
  it('agrupa en personas y agentes con sus cuentas y los filtros pulsables', () => {
    const html = renderToStaticMarkup(<PanelDeMiembros miembros={MIEMBROS} />);
    expect(html).toContain('Miembros · 7');
    expect(html).toContain('Personas · 3');
    expect(html).toContain('Agentes · 4');
    expect(html).toContain('aria-label="Filtrar miembros"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(3);
  });

  it('en el móvil agrupa por estado y sin filtros', () => {
    const html = renderToStaticMarkup(
      <PanelDeMiembros miembros={MIEMBROS} agrupar="estado" conFiltros={false} sinTitulo />,
    );
    expect(html).toContain('En la sala · 4');
    expect(html).toContain('Inactivos · 2');
    expect(html).toContain('Añadidos · 1');
    expect(html).not.toContain('aria-pressed');
  });

  it('explica el vacío con texto', () => {
    const html = renderToStaticMarkup(
      <PanelDeMiembros miembros={MIEMBROS} filtroInicial="anadidos" />,
    );
    expect(html).toContain('Asesoría Olmo');
    const vacio = renderToStaticMarkup(<PanelDeMiembros miembros={[]} />);
    expect(vacio).toContain('Nadie en este filtro');
  });
});

describe('NavegacionDeSalas', () => {
  const salas = [
    { id: 'general', nombre: 'general', sinLeer: 0, menciones: 0 },
    { id: 'finanzas', nombre: 'finanzas', sinLeer: 3, menciones: 0 },
    { id: 'ventas', nombre: 'ventas-y-atencion', sinLeer: 5, menciones: 2 },
  ];

  it('marca la sala actual y lee los contadores en texto', () => {
    const html = renderToStaticMarkup(
      <NavegacionDeSalas
        salas={salas}
        actual="finanzas"
        hrefDe={(id) => `/panel/sala?sala=${id}`}
      />,
    );
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/panel/sala?sala=ventas"');
    expect(html).toContain('2 menciones, 5 mensajes sin leer');
    expect(html).toContain('3 mensajes sin leer');
    expect(html).toContain('>Salas<');
  });

  it('redacta singulares y vacío', () => {
    expect(textoDeContadores(t, { id: 'x', nombre: 'x', sinLeer: 1, menciones: 1 })).toBe(
      '1 mención, 1 mensaje sin leer',
    );
    expect(textoDeContadores(t, { id: 'x', nombre: 'x', sinLeer: 0, menciones: 0 })).toBe('');
    expect(renderToStaticMarkup(<NavegacionDeSalas salas={[]} hrefDe={() => '#'} />)).toContain(
      'Todavía no hay salas.',
    );
  });
});

describe('IndicadorDeEscritura', () => {
  it('redacta uno, dos y varios', () => {
    expect(textoDeEscritura(t, [])).toBe('');
    expect(textoDeEscritura(t, ['Cobros'])).toBe('Cobros está escribiendo…');
    expect(textoDeEscritura(t, ['Cobros', 'Conciliación'])).toBe(
      'Cobros y Conciliación están escribiendo…',
    );
    expect(textoDeEscritura(t, ['A', 'B', 'C'])).toBe('Varios miembros están escribiendo…');
  });

  it('la región aria-live existe aunque nadie escriba', () => {
    const vacio = renderToStaticMarkup(<IndicadorDeEscritura nombres={[]} />);
    expect(vacio).toContain('aria-live="polite"');
    expect(vacio).not.toContain('escribiendo');
    const lleno = renderToStaticMarkup(<IndicadorDeEscritura nombres={['Cobros']} />);
    expect(lleno).toContain('Cobros está escribiendo…');
  });
});

describe('FilaDePresencia', () => {
  it('es un único botón con nombre accesible y resumen en texto', () => {
    const html = renderToStaticMarkup(
      <FilaDePresencia
        miembros={MIEMBROS}
        resumen="4 en la sala · 2 inactivos · 1 añadido"
        etiqueta="Ver miembros: 4 en la sala · 2 inactivos · 1 añadido"
        alAbrir={() => undefined}
        maximo={3}
      />,
    );
    expect(html).toContain('aria-label="Ver miembros: 4 en la sala');
    expect(html).toContain('min-h-11');
    expect(html.match(/role="img"/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe('HojaMovil', () => {
  it('cerrada no pinta nada; abierta es un diálogo modal con botón Cerrar', () => {
    expect(
      renderToStaticMarkup(
        <HojaMovil abierta={false} titulo="Miembros" alCerrar={() => undefined}>
          x
        </HojaMovil>,
      ),
    ).toBe('');
    const html = renderToStaticMarkup(
      <HojaMovil abierta titulo="Miembros" alCerrar={() => undefined} lado="izquierda">
        contenido
      </HojaMovil>,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Cerrar"');
    expect(html).toContain('h-11 w-11');
  });
});

describe('TarjetaDePropuesta', () => {
  const datos = [
    { etiqueta: 'Coste', valor: 'Unos 50 € al mes' },
    { etiqueta: 'Se deshace', valor: 'Despidiéndolo desde Equipo' },
  ];

  it('muestra los datos como lista de definiciones y las acciones', () => {
    const html = renderToStaticMarkup(
      <TarjetaDePropuesta
        titulo="Contratar Previsión"
        datos={datos}
        acciones={<button>Ok</button>}
      />,
    );
    expect(html).toContain('aria-label="Propuesta: Contratar Previsión"');
    expect(html).toContain('<dt');
    expect(html).toContain('Unos 50 € al mes');
    expect(html).toContain('<button>Ok</button>');
  });

  it('resuelta sustituye las acciones por un estado', () => {
    const html = renderToStaticMarkup(
      <TarjetaDePropuesta
        titulo="Contratar Previsión"
        datos={datos}
        acciones={<button>Ok</button>}
        resuelta="Contratada."
      />,
    );
    expect(html).toContain('role="status"');
    expect(html).not.toContain('<button>Ok</button>');
  });
});
