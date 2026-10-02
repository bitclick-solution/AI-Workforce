import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { AgenteDelInicio } from '../../../lib/inicio';
import {
  WidgetFicha,
  WidgetLoUltimo,
  WidgetTuEquipo,
  WidgetVencidoPorAntiguedad,
  haceCuanto,
} from './widgets';

const AGENTE_COBROS: AgenteDelInicio = {
  puestoId: 'p-cobros',
  nombre: 'Cobros',
  estado: 'activo',
  departamentoId: 'd1',
  departamento: 'Finanzas',
  salaId: 's1',
  origenPlantilla: true,
  tareaEnCurso: {
    tareaId: 't1',
    encargo: 'Revisa las facturas vencidas de hoy.',
    estado: 'en_curso',
    desde: new Date(Date.now() - 3 * 60_000).toISOString(),
  },
  ultimasCompletadas: [
    {
      tareaId: 't0',
      encargo: 'Nota de seguimiento de ayer.',
      estado: 'completada',
      desde: new Date(Date.now() - 60 * 60_000).toISOString(),
    },
  ],
};

const AGENTE_CONCILIACION: AgenteDelInicio = {
  puestoId: 'p-conciliacion',
  nombre: 'Conciliación',
  estado: 'en_prueba',
  departamentoId: 'd1',
  departamento: 'Finanzas',
  salaId: null,
  origenPlantilla: true,
  tareaEnCurso: {
    tareaId: 't2',
    encargo: 'Concilia la factura F-2026-0001.',
    estado: 'en_curso',
    desde: new Date(Date.now() - 30 * 60_000).toISOString(),
  },
  ultimasCompletadas: [],
};

describe('haceCuanto', () => {
  it('redondea a minutos, horas y días', () => {
    const ahora = Date.parse('2026-09-30T12:00:00.000Z');
    expect(haceCuanto('2026-09-30T11:59:30.000Z', ahora)).toBe('hace un momento');
    expect(haceCuanto('2026-09-30T11:55:00.000Z', ahora)).toBe('hace 5 min');
    expect(haceCuanto('2026-09-30T09:00:00.000Z', ahora)).toBe('hace 3 h');
    expect(haceCuanto('2026-09-27T12:00:00.000Z', ahora)).toBe('hace 3 d');
  });

  it('una fecha inválida no lanza', () => {
    expect(haceCuanto('no-es-una-fecha')).toBe('');
  });
});

describe('WidgetFicha', () => {
  it('sin agentes, el vacío', () => {
    const html = renderToStaticMarkup(<WidgetFicha agentes={[]} />);
    expect(html).toContain('Sin puestos todavía.');
  });

  it('cuenta los puestos activos sobre el total', () => {
    const html = renderToStaticMarkup(
      <WidgetFicha agentes={[AGENTE_COBROS, AGENTE_CONCILIACION]} />,
    );
    expect(html).toContain('Puestos activos');
    expect(html).toContain('>1<');
    expect(html).toContain('de 2');
  });
});

describe('WidgetTuEquipo', () => {
  it('sin agentes, el vacío', () => {
    const html = renderToStaticMarkup(<WidgetTuEquipo agentes={[]} />);
    expect(html).toContain('Todavía no hay ningún agente');
  });

  it('pinta el nombre, el estado de ciclo de vida, la tarea en curso y el sello de plantilla', () => {
    const html = renderToStaticMarkup(<WidgetTuEquipo agentes={[AGENTE_COBROS]} />);
    expect(html).toContain('Cobros');
    expect(html).toContain('Activo');
    expect(html).toContain('Revisa las facturas vencidas de hoy.');
    expect(html).toContain('Plantilla');
    expect(html).toContain('Ver la sala de Finanzas');
    expect(html).toContain('Página del equipo');
    expect(html).toContain('Página del agente');
  });

  it('sin sala del departamento, no hay enlace a ella', () => {
    const html = renderToStaticMarkup(<WidgetTuEquipo agentes={[AGENTE_CONCILIACION]} />);
    expect(html).not.toContain('Ver la sala de');
  });

  it('sin tarea en curso, lo dice', () => {
    const sinTarea: AgenteDelInicio = { ...AGENTE_COBROS, tareaEnCurso: null };
    const html = renderToStaticMarkup(<WidgetTuEquipo agentes={[sinTarea]} />);
    expect(html).toContain('Sin tarea en curso.');
  });
});

describe('WidgetVencidoPorAntiguedad', () => {
  it('sin tareas en curso, el vacío', () => {
    const html = renderToStaticMarkup(<WidgetVencidoPorAntiguedad agentes={[]} />);
    expect(html).toContain('Nada abierto ahora mismo.');
  });

  it('ordena por antigüedad, lo más viejo primero', () => {
    const html = renderToStaticMarkup(
      <WidgetVencidoPorAntiguedad agentes={[AGENTE_COBROS, AGENTE_CONCILIACION]} />,
    );
    const posicionConciliacion = html.indexOf('Concilia la factura');
    const posicionCobros = html.indexOf('Revisa las facturas');
    expect(posicionConciliacion).toBeGreaterThan(-1);
    expect(posicionConciliacion).toBeLessThan(posicionCobros);
  });
});

describe('WidgetLoUltimo', () => {
  it('sin tareas, el vacío', () => {
    const html = renderToStaticMarkup(<WidgetLoUltimo agentes={[]} />);
    expect(html).toContain('Todavía no hay ninguna tarea.');
  });

  it('mezcla en curso y completadas, lo más reciente primero', () => {
    const html = renderToStaticMarkup(<WidgetLoUltimo agentes={[AGENTE_COBROS]} />);
    const posicionEnCurso = html.indexOf('Revisa las facturas');
    const posicionCompletada = html.indexOf('Nota de seguimiento');
    expect(posicionEnCurso).toBeGreaterThan(-1);
    expect(posicionEnCurso).toBeLessThan(posicionCompletada);
  });
});

describe('enlaces al detalle de la tarea (criterio de hecho 1)', () => {
  const enlace = (id: string) => `href="/panel/inicio/tarea/${id}"`;

  it('«Tu equipo» enlaza la tarea en curso y las completadas', () => {
    const html = renderToStaticMarkup(<WidgetTuEquipo agentes={[AGENTE_COBROS]} />);
    expect(html).toContain(enlace('t1'));
    expect(html).toContain(enlace('t0'));
  });

  it('«Lo último» enlaza cada tarea, en curso o completada', () => {
    const html = renderToStaticMarkup(<WidgetLoUltimo agentes={[AGENTE_COBROS]} />);
    expect(html).toContain(enlace('t1'));
    expect(html).toContain(enlace('t0'));
  });

  it('«Vencido por antigüedad» enlaza la tarea abierta', () => {
    const html = renderToStaticMarkup(<WidgetVencidoPorAntiguedad agentes={[AGENTE_COBROS]} />);
    expect(html).toContain(enlace('t1'));
  });
});
