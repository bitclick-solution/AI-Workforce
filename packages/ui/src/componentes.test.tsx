import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Aviso } from './aviso';
import { Boton } from './boton';
import { Campo } from './campo';
import { descomponerDuracion, formatearDuracion } from './duracion';
import { crearTraductor } from './i18n';
import { Insignia } from './insignia';
import { Porque } from './porque';
import { Tarjeta } from './tarjeta';

const t = crearTraductor('es');

describe('Boton', () => {
  it('es de tipo button salvo que se pida otra cosa', () => {
    expect(renderToStaticMarkup(<Boton>Contratar</Boton>)).toContain('type="button"');
    expect(renderToStaticMarkup(<Boton type="submit">Contratar</Boton>)).toContain('type="submit"');
  });

  it('marca aria-busy y deshabilita mientras carga', () => {
    const html = renderToStaticMarkup(<Boton cargando>Contratar</Boton>);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled');
    expect(html).toContain('Trabajando');
  });

  it('conserva el nombre accesible cuando el contenido visible no basta', () => {
    const html = renderToStaticMarkup(
      <Boton etiquetaAccesible="Cerrar el aviso" tono="secundario">
        ✕
      </Boton>,
    );
    expect(html).toContain('aria-label="Cerrar el aviso"');
  });
});

describe('Aviso', () => {
  it('interrumpe con alert y solo informa con status', () => {
    const error = renderToStaticMarkup(
      <Aviso tipo="error" titulo="El ERP no responde" accion={<Boton>Reintentar</Boton>} />,
    );
    expect(error).toContain('role="alert"');

    const persona = renderToStaticMarkup(
      <Aviso
        tipo="necesita-persona"
        titulo="El cliente disputa la factura"
        accion={<Boton>Abrirlo yo</Boton>}
      />,
    );
    expect(persona).toContain('role="alert"');

    const vacio = renderToStaticMarkup(
      <Aviso tipo="vacio" titulo="Sin agentes todavía" accion={<Boton>Contratar</Boton>} />,
    );
    expect(vacio).toContain('role="status"');
  });

  it('dice su tipo con palabras y no solo con el color', () => {
    const html = renderToStaticMarkup(
      <Aviso
        tipo="necesita-persona"
        titulo="Hace falta una decisión"
        accion={<Boton>Ver</Boton>}
      />,
    );
    expect(html).toContain('Necesita a una persona');
    expect(html).toContain('data-tipo="necesita-persona"');
  });
});

describe('Campo', () => {
  it('asocia la etiqueta, la ayuda y el error con el control', () => {
    const html = renderToStaticMarkup(
      <Campo
        id="nota"
        etiqueta="Nota de seguimiento"
        valor="Hola"
        onCambio={() => undefined}
        ayuda="Se anota en la factura."
        error="No puede quedar vacía."
        multilinea
      />,
    );
    expect(html).toContain('for="nota"');
    expect(html).toContain('id="nota"');
    expect(html).toContain('aria-describedby="nota-ayuda nota-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('id="nota-error"');
  });

  it('sin ayuda ni error no deja un aria-describedby vacío', () => {
    const html = renderToStaticMarkup(
      <Campo id="frase" etiqueta="Qué necesitas" valor="" onCambio={() => undefined} />,
    );
    expect(html).not.toContain('aria-describedby');
    expect(html).not.toContain('aria-invalid');
  });
});

describe('Insignia', () => {
  it('lleva el significado en el texto', () => {
    const html = renderToStaticMarkup(<Insignia etiqueta="Nivel" valor="N1 supervisado" />);
    expect(html).toContain('Nivel');
    expect(html).toContain('N1 supervisado');
  });
});

describe('Porque', () => {
  it('colapsa por defecto con el control accesible correcto', () => {
    const html = renderToStaticMarkup(
      <Porque id="motivo-1">Doce facturas vencidas de menos de 30 días.</Porque>,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="motivo-1-region"');
    expect(html).toContain('role="region"');
    expect(html).toContain('hidden');
  });

  it('se puede entregar abierto', () => {
    const html = renderToStaticMarkup(
      <Porque id="motivo-2" abiertoPorDefecto>
        Motivo
      </Porque>,
    );
    expect(html).toContain('aria-expanded="true"');
  });
});

describe('Tarjeta', () => {
  it('respeta el nivel de encabezado que se le pide', () => {
    expect(renderToStaticMarkup(<Tarjeta titulo="Propuesta" />)).toContain('<h2');
    expect(renderToStaticMarkup(<Tarjeta titulo="Propuesta" nivel={3} />)).toContain('<h3');
  });
});

describe('duración', () => {
  it('descompone en horas, minutos y segundos', () => {
    expect(descomponerDuracion(0)).toEqual({ horas: 0, minutos: 0, segundos: 0 });
    expect(descomponerDuracion(-5000)).toEqual({ horas: 0, minutos: 0, segundos: 0 });
    expect(descomponerDuracion(9 * 60_000 + 12_000)).toEqual({
      horas: 0,
      minutos: 9,
      segundos: 12,
    });
    expect(descomponerDuracion(3_600_000 + 4 * 60_000)).toEqual({
      horas: 1,
      minutos: 4,
      segundos: 0,
    });
  });

  it('se lee en palabras y omite las unidades que sobran', () => {
    expect(formatearDuracion(0, t)).toBe('0 s');
    expect(formatearDuracion(12_000, t)).toBe('12 s');
    expect(formatearDuracion(9 * 60_000 + 12_000, t)).toBe('9 min 12 s');
    expect(formatearDuracion(3_600_000 + 4 * 60_000, t)).toBe('1 h 4 min 0 s');
  });
});
