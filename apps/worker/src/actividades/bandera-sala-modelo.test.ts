import { describe, expect, it } from 'vitest';

import { BANDERA_SALA_MODELO, salaConModeloActiva } from './contexto.js';

describe('bandera AIW_SALA_MODELO', () => {
  it('solo «1» y «true» la activan, igual que el resto de banderas', () => {
    expect(BANDERA_SALA_MODELO).toBe('AIW_SALA_MODELO');
    for (const valor of ['1', 'true', ' 1 ', 'true ']) {
      expect(salaConModeloActiva({ [BANDERA_SALA_MODELO]: valor }), valor).toBe(true);
    }
  });

  it('apagada por defecto: sin variable, a 0 o con cualquier otro valor', () => {
    expect(salaConModeloActiva({})).toBe(false);
    for (const valor of ['0', '', 'false', 'TRUE', 'si', 'yes', '2']) {
      expect(salaConModeloActiva({ [BANDERA_SALA_MODELO]: valor }), valor).toBe(false);
    }
  });
});
