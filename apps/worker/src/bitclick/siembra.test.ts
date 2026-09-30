import { enrutadorDeGuiones, Enrutador } from '@aiw/models';
import { CATALOGO } from '@aiw/platform-agents';
import { describe, expect, it } from 'vitest';

import { LISTA_BLANCA_COBROS } from './constantes.js';
import { CORREO_JESUS_POR_DEFECTO, plantillaCobros } from './siembra.js';

describe('plantillaCobros', () => {
  it('lee la plantilla certificada del catálogo, sin tocarla', () => {
    const plantilla = plantillaCobros();
    expect(plantilla.id).toBe('finanzas.reclamacion-de-cobros');
    expect(plantilla.departamento).toBe('Finanzas');
    // Escritura en N1: lo exige el criterio de hecho 2. Si la plantilla certificada
    // cambiara este nivel, esta prueba lo dice antes que un correo real mal aprobado.
    expect(plantilla.niveles['escritura']).toBe('n1');
    expect(plantilla.herramientas.map((h) => h.nombre)).toEqual([...LISTA_BLANCA_COBROS]);
  });

  it('el correo de Jesús por defecto es un valor de repuesto, no el real', () => {
    // El real lo pone Jesús con BITCLICK_CORREO_JESUS en su .env; este valor no
    // viaja por el repositorio, que es público.
    expect(CORREO_JESUS_POR_DEFECTO).toBe('jefatura@bitclick.local');
  });
});

describe('plantillas certificadas de plataforma: enrutado por papel', () => {
  it('todas enrutan por papel, con respaldo y con el guion de prueba de sus ejecuciones deterministas', () => {
    for (const plantilla of CATALOGO.plantillas) {
      expect(plantilla.enrutadoModelo, plantilla.id).toMatchObject({
        papel: expect.stringMatching(/^(opus5|sonnet5|haiku45)$/),
        papelRespaldo: expect.stringMatching(/^(opus5|sonnet5|haiku45)$/),
        modeloDePrueba: expect.stringMatching(/^deterministico/),
      });
      expect(plantilla.enrutadoModelo).not.toHaveProperty('proveedor');
    }
  });

  it('se resuelven con el proveedor de prueba elegido (guion) y con Bedrock elegido (puerto), sin tocar la plantilla', () => {
    const bedrock = new Enrutador()
      .registrarPuerto('bedrock-ue', 'bedrock-eu', () => {
        throw new Error('no se llama al resolver');
      })
      .elegir({ principal: 'bedrock-ue' });
    for (const plantilla of CATALOGO.plantillas) {
      expect(enrutadorDeGuiones().resolverPaso(plantilla.enrutadoModelo).via, plantilla.id).toBe(
        'modelo',
      );
      expect(bedrock.resolverPaso(plantilla.enrutadoModelo).via, plantilla.id).toBe('puerto');
    }
  });

  it('Cobros decide con sonnet5 y Conciliación con opus5 (ADR-018)', () => {
    const papeles = Object.fromEntries(
      CATALOGO.plantillas.map((p) => [p.id, (p.enrutadoModelo as { papel: string }).papel]),
    );
    expect(papeles).toEqual({
      'finanzas.reclamacion-de-cobros': 'sonnet5',
      'finanzas.conciliacion-bancaria': 'opus5',
    });
  });
});
