/**
 * El correo y las páginas: escapado, sin borrador y sin token donde no toca.
 *
 * El resumen legible lo escribe un agente con datos de un ERP. Aquí se comprueba
 * que sale escapado en las dos salidas y que el borrador opaco no aparece en
 * ninguna, que es la frontera del ADR-001 puesta a prueba.
 */
import { describe, expect, it } from 'vitest';

import { escaparHtml } from '../html.js';
import { CorreoEnMemoria } from '../correo/memoria.js';

import { asuntoDelCorreo, componerCorreo, formatearMomento } from './plantilla.js';
import {
  paginaCaducada,
  paginaDecidida,
  paginaDeDecision,
  paginaEnlaceNoValido,
  paginaYaDecidida,
} from './paginas.js';

const INYECCION = '<script>alert("pago")</script> & "citado" \'suelto\'';
const URL_ENLACE = 'https://aiw.example/aprobaciones/v1.carga.firma';
const VENCE = new Date(Date.UTC(2026, 8, 21, 9, 30));

function datos(resumen = 'Pagar 1.200 € a Suministros Pérez') {
  return {
    para: 'jefatura@example.com',
    remitente: 'agentes@aiworkforce.local',
    resumenLegible: resumen,
    claseAccion: 'pago.emitir',
    nivelExigido: 'n1',
    venceEn: VENCE,
    url: URL_ENLACE,
  };
}

describe('escaparHtml', () => {
  it('escapa los cinco caracteres que rompen el HTML', () => {
    expect(escaparHtml('<a href="x">&\'</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('no toca el texto que no lleva nada especial', () => {
    expect(escaparHtml('Pagar 1.200 € a Suministros Pérez')).toBe(
      'Pagar 1.200 € a Suministros Pérez',
    );
  });
});

describe('correo de solicitud', () => {
  it('lleva el resumen legible y el enlace en las dos versiones del cuerpo', () => {
    const correo = componerCorreo(datos());
    expect(correo.texto).toContain('Pagar 1.200 € a Suministros Pérez');
    expect(correo.texto).toContain(URL_ENLACE);
    expect(correo.html).toContain('Pagar 1.200 € a Suministros Pérez');
    expect(correo.html).toContain(`href="${URL_ENLACE}"`);
    expect(correo.de).toBe('agentes@aiworkforce.local');
    expect(correo.para).toBe('jefatura@example.com');
  });

  it('escapa el resumen en el HTML: el agente no dicta el marcado', () => {
    const correo = componerCorreo(datos(INYECCION));
    expect(correo.html).not.toContain('<script>');
    expect(correo.html).toContain('&lt;script&gt;');
    // En el cuerpo de texto plano no hay marcado que romper, así que va tal cual.
    expect(correo.texto).toContain('<script>');
  });

  it('lleva un solo enlace: los enlaces que deciden se aprueban solos', () => {
    const correo = componerCorreo(datos());
    expect(correo.html.match(/href=/g)).toHaveLength(1);
    expect(correo.texto).not.toMatch(/aprobar|rechazar/i);
  });

  it('dice la clase de acción, el nivel y hasta cuándo se puede decidir', () => {
    const correo = componerCorreo(datos());
    expect(correo.texto).toContain('pago.emitir');
    expect(correo.texto).toContain('n1');
    expect(correo.texto).toContain(formatearMomento(VENCE));
  });

  it('sin vencimiento no promete una fecha que no hay', () => {
    const correo = componerCorreo({ ...datos(), venceEn: null });
    expect(correo.texto).toContain('plazo del enlace');
  });

  it('el asunto es una línea y se recorta', () => {
    const largo = 'a'.repeat(200);
    expect(asuntoDelCorreo(datos(`${largo}\nsegunda línea`))).not.toContain('\n');
    expect(asuntoDelCorreo(datos('primera\rsegunda'))).not.toContain('\r');
    expect(asuntoDelCorreo(datos('primera\r\nsegunda'))).toMatch(/primera$/);
    expect(asuntoDelCorreo(datos(largo)).length).toBeLessThan(130);
  });

  it('el asunto lleva la organización cuando se conoce', () => {
    expect(asuntoDelCorreo({ ...datos(), organizacion: 'Bitclick' })).toContain('[Bitclick]');
  });
});

describe('páginas del enlace', () => {
  const pagina = paginaDeDecision({
    resumenLegible: INYECCION,
    claseAccion: 'pago.emitir',
    nivelExigido: 'n1',
    venceEn: VENCE,
    accion: '/aprobaciones/v1.carga.firma',
  });

  it('muestra el resumen escapado y los dos botones', () => {
    expect(pagina).not.toContain('<script>alert');
    expect(pagina).toContain('&lt;script&gt;');
    expect(pagina).toContain('value="aprobar"');
    expect(pagina).toContain('value="rechazar"');
  });

  it('decide por POST, nunca al abrir el enlace', () => {
    expect(pagina).toContain('method="post"');
    expect(pagina).toContain('action="/aprobaciones/v1.carga.firma"');
  });

  it('no lleva JavaScript ni recursos externos', () => {
    expect(pagina).not.toContain('<script');
    expect(pagina).not.toContain('http://');
    expect(pagina).not.toMatch(/src=/);
  });

  it('la página de resultado no repite el token', () => {
    for (const html of [
      paginaDecidida('aprobada'),
      paginaDecidida('rechazada'),
      paginaYaDecidida('aprobada'),
      paginaCaducada(VENCE),
      paginaEnlaceNoValido(),
    ]) {
      expect(html).not.toContain('v1.carga.firma');
      expect(html).not.toContain('aprobaciones/');
    }
  });

  it('la página del enlace no válido no dice si la aprobación existe', () => {
    const html = paginaEnlaceNoValido();
    expect(html).not.toMatch(/tenant|aprobaci[oó]n \d|no existe la aprobaci/i);
    expect(html).toContain('Enlace no válido');
  });

  it('la página de «ya se usó» dice el sentido que quedó, y solo eso', () => {
    expect(paginaYaDecidida('rechazada')).toContain('rechazada');
    expect(paginaYaDecidida(null)).not.toContain('La decisión registrada');
  });

  it('el resultado distingue aprobar de rechazar', () => {
    expect(paginaDecidida('aprobada')).toContain('continúa');
    expect(paginaDecidida('rechazada')).toContain('se detiene');
  });
});

describe('correo en memoria', () => {
  it('captura lo enviado y numera cada envío', async () => {
    const correo = new CorreoEnMemoria();
    const primero = await correo.enviar(componerCorreo(datos()));
    const segundo = await correo.enviar(componerCorreo(datos('Otra cosa')));

    expect(primero.proveedor).toBe('memoria');
    expect(primero.id).not.toBe(segundo.id);
    expect(correo.enviados).toHaveLength(2);
    expect(correo.ultimo?.asunto).toContain('Otra cosa');

    correo.vaciar();
    expect(correo.enviados).toHaveLength(0);
    expect(correo.ultimo).toBeUndefined();
  });
});
