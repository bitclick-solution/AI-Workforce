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
