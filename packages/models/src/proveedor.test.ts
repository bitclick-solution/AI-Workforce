import { describe, expect, it } from 'vitest';

import {
  clienteDelProveedorDesdeEntorno,
  plataformaDelProveedor,
  proveedorPrincipalDesdeEntorno,
  proveedorRespaldoDesdeEntorno,
  puertoAnthropicPrincipalDesdeEntorno,
  puertoAnthropicRespaldoDesdeEntorno,
} from './proveedor.js';

describe('proveedor principal y de respaldo (ADR-023): cambiar de proveedor es cambiar una línea', () => {
  it('por defecto, el principal es vertex-ue y el respaldo bedrock-ue', () => {
    expect(proveedorPrincipalDesdeEntorno({})).toBe('vertex-ue');
    expect(proveedorRespaldoDesdeEntorno({})).toBe('bedrock-ue');
  });

  it('AIW_PROVEEDOR_MODELOS y AIW_PROVEEDOR_MODELOS_RESPALDO anulan el valor por defecto', () => {
    expect(proveedorPrincipalDesdeEntorno({ AIW_PROVEEDOR_MODELOS: 'bedrock-ue' })).toBe(
      'bedrock-ue',
    );
    expect(proveedorRespaldoDesdeEntorno({ AIW_PROVEEDOR_MODELOS_RESPALDO: 'vertex-ue' })).toBe(
      'vertex-ue',
    );
  });

  it('un valor vacío (variable de repositorio sin definir en la CI) cae al valor por defecto', () => {
    expect(proveedorPrincipalDesdeEntorno({ AIW_PROVEEDOR_MODELOS: '' })).toBe('vertex-ue');
  });

  it('un proveedor no reconocido lanza con el nombre exacto de la variable y los valores admitidos', () => {
    expect(() => proveedorPrincipalDesdeEntorno({ AIW_PROVEEDOR_MODELOS: 'openai' })).toThrow(
      /AIW_PROVEEDOR_MODELOS="openai"/,
    );
    expect(() =>
      proveedorRespaldoDesdeEntorno({ AIW_PROVEEDOR_MODELOS_RESPALDO: 'primera-parte' }),
    ).toThrow(/AIW_PROVEEDOR_MODELOS_RESPALDO="primera-parte"/);
  });

  it('mapea cada proveedor a su plataforma de identificadores.ts', () => {
    expect(plataformaDelProveedor('vertex-ue')).toBe('vertex-eu');
    expect(plataformaDelProveedor('bedrock-ue')).toBe('bedrock-eu');
  });

  it('el cliente del proveedor despacha a la fábrica correcta (falla con el nombre exacto de lo que falta)', () => {
    expect(() => clienteDelProveedorDesdeEntorno('vertex-ue', {})).toThrow(/AIW_VERTEX_REGION_UE/);
    expect(() => clienteDelProveedorDesdeEntorno('bedrock-ue', {})).toThrow(
      /AIW_BEDROCK_REGION_UE/,
    );
  });

  it('puertoAnthropicPrincipalDesdeEntorno y puertoAnthropicRespaldoDesdeEntorno despachan al proveedor correspondiente', () => {
    expect(() =>
      puertoAnthropicPrincipalDesdeEntorno('sonnet5', { esfuerzoPorClasePaso: {} }, {}),
    ).toThrow(/AIW_VERTEX_REGION_UE/);
    expect(() =>
      puertoAnthropicRespaldoDesdeEntorno('sonnet5', { esfuerzoPorClasePaso: {} }, {}),
    ).toThrow(/AIW_BEDROCK_REGION_UE/);
    expect(() =>
      puertoAnthropicPrincipalDesdeEntorno(
        'sonnet5',
        { esfuerzoPorClasePaso: {} },
        { AIW_PROVEEDOR_MODELOS: 'bedrock-ue' },
      ),
    ).toThrow(/AIW_BEDROCK_REGION_UE/);
  });
});
