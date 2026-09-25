/**
 * Cálculo del coste y validaciones del contador, sin base de datos.
 *
 * Lo que se prueba aquí es lo que decide cuánto paga un cliente: si el redondeo o
 * la elección de tarifa están mal, el error no lo ve nadie hasta la factura.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  RUTA_CATALOGO_EJEMPLO,
  esquemaCatalogoTarifas,
  tarifasDelCatalogo,
} from './contador-catalogo.js';
import {
  ACCION_TAREA_CONTADA,
  ACCION_TARIFA_REGISTRADA,
  ACCION_USO_MODELO,
  DESTINO_EVENTO_CONTADOR,
  TIPO_EVENTO_CONTADOR,
  TOKENS_POR_MILLON,
  calcularCosteEuros,
  registrarTareaRaiz,
  registrarUsoDeModelo,
  type Tarifa,
} from './contador.js';

const TARIFA: Tarifa = {
  id: '01929f00-0000-7000-8000-0000000000aa',
  proveedor: 'proveedor-de-prueba',
  modelo: 'modelo-de-prueba',
  eurosPorMillonEntrada: 3,
  eurosPorMillonSalida: 15,
  eurosPorMillonEntradaCache: 0.3,
  vigenteDesde: new Date('2026-09-01T00:00:00.000Z'),
};

const TENANT = '01929f00-0000-7000-8000-0000000000b1';
const TAREA = '01929f00-0000-7000-8000-0000000000b2';
const PUESTO = '01929f00-0000-7000-8000-0000000000b3';
const VERSION_PUESTO = '01929f00-0000-7000-8000-0000000000b4';

/**
 * Transacción que falla si alguien la toca. Las validaciones tienen que rechazar
 * antes de ir a la base: si no, una entrada mal formada gasta número de orden.
 */
const txQueNoSeToca = (() => {
  const fallar = () => {
    throw new Error('La validación dejó pasar la llamada hasta la base.');
  };
  return fallar as unknown as Parameters<typeof registrarTareaRaiz>[0];
})();

describe('calcularCosteEuros', () => {
  it('cobra entrada, salida y caché por millón de tokens', () => {
    // 1.000.000 de entrada a 3, 1.000.000 de salida a 15, 1.000.000 de caché a 0,3.
    expect(
      calcularCosteEuros(TARIFA, {
        entrada: TOKENS_POR_MILLON,
        salida: TOKENS_POR_MILLON,
        entradaCache: TOKENS_POR_MILLON,
      }),
    ).toBeCloseTo(18.3, 4);
  });

  it('un uso normal sale en céntimos y redondea a cuatro decimales', () => {
    // 12.345 de entrada y 2.468 de salida: 0,037035 + 0,03702 = 0,074055 €.
    expect(calcularCosteEuros(TARIFA, { entrada: 12_345, salida: 2_468 })).toBe(0.0741);
  });

  it('un uso diminuto puede costar cero: es lo que cabe en la columna', () => {
    expect(calcularCosteEuros(TARIFA, { entrada: 1, salida: 0 })).toBe(0);
  });

  it('sin tokens no hay coste', () => {
    expect(calcularCosteEuros(TARIFA, { entrada: 0, salida: 0 })).toBe(0);
  });

  it('una tarifa a cero no cobra, aunque haya millones de tokens', () => {
    const gratis: Tarifa = {
      ...TARIFA,
      eurosPorMillonEntrada: 0,
      eurosPorMillonSalida: 0,
      eurosPorMillonEntradaCache: 0,
    };
    expect(calcularCosteEuros(gratis, { entrada: 9_000_000, salida: 9_000_000 })).toBe(0);
  });

  it('rechaza tokens que no son enteros no negativos', () => {
    expect(() => calcularCosteEuros(TARIFA, { entrada: -1, salida: 0 })).toThrow(
      /tokens.entrada tiene que ser un entero no negativo/,
    );
    expect(() => calcularCosteEuros(TARIFA, { entrada: 1.5, salida: 0 })).toThrow(/tokens.entrada/);
    expect(() => calcularCosteEuros(TARIFA, { entrada: 0, salida: Number.NaN })).toThrow(
      /tokens.salida/,
    );
    expect(() => calcularCosteEuros(TARIFA, { entrada: 0, salida: 0, entradaCache: -5 })).toThrow(
      /tokens.entradaCache/,
    );
  });

  it('rechaza precios negativos: una tarifa no regala dinero', () => {
    expect(() =>
      calcularCosteEuros({ ...TARIFA, eurosPorMillonSalida: -1 }, { entrada: 0, salida: 10 }),
    ).toThrow(/eurosPorMillonSalida/);
  });

  it('no lleva ningún precio escrito dentro', () => {
    const fuente = readFileSync(new URL('./contador.ts', import.meta.url), 'utf8');
    const cuerpo = fuente.slice(fuente.indexOf('export function calcularCosteEuros'));
    expect(cuerpo).not.toMatch(/eurosPorMillon\w+\s*[:=]\s*\d/);
  });
});

describe('las acciones y el evento tienen nombre estable', () => {
  it('el libro y el panel se entienden por constantes, no por cadenas sueltas', () => {
    expect(ACCION_TAREA_CONTADA).toBe('tarea.contada');
    expect(ACCION_USO_MODELO).toBe('modelo.uso');
    expect(ACCION_TARIFA_REGISTRADA).toBe('tarifa.registrada');
    expect(TIPO_EVENTO_CONTADOR).toBe('contador.actualizado');
    expect(DESTINO_EVENTO_CONTADOR).toBe('panel');
  });
});

describe('validaciones antes de tocar la base', () => {
  it('registrarTareaRaiz exige UUID en tenant, tarea y puesto', async () => {
    await expect(
      registrarTareaRaiz(txQueNoSeToca, 'no-es-uuid', { tareaId: TAREA, puestoId: PUESTO }),
    ).rejects.toThrow(/tenantId no es un UUID/);
    await expect(
      registrarTareaRaiz(txQueNoSeToca, TENANT, { tareaId: 'tarea-3', puestoId: PUESTO }),
    ).rejects.toThrow(/tareaId no es un UUID/);
    await expect(
      registrarTareaRaiz(txQueNoSeToca, TENANT, { tareaId: TAREA, puestoId: 'puesto' }),
    ).rejects.toThrow(/puestoId no es un UUID/);
  });

  it('registrarUsoDeModelo exige proveedor, modelo y clave de idempotencia', async () => {
    const base = {
      tareaId: TAREA,
      puestoId: PUESTO,
      versionPuestoId: VERSION_PUESTO,
      proveedor: 'anthropic',
      modelo: 'claude-haiku-4-5',
      tokens: { entrada: 10, salida: 5 },
      claveIdempotencia: 'peticion-1',
    };
    await expect(
      registrarUsoDeModelo(txQueNoSeToca, TENANT, { ...base, proveedor: '   ' }),
    ).rejects.toThrow(/proveedor no puede estar vacío/);
    await expect(
      registrarUsoDeModelo(txQueNoSeToca, TENANT, { ...base, modelo: '' }),
    ).rejects.toThrow(/modelo no puede estar vacío/);
    await expect(
      registrarUsoDeModelo(txQueNoSeToca, TENANT, { ...base, claveIdempotencia: ' ' }),
    ).rejects.toThrow(/claveIdempotencia no puede estar vacío/);
    await expect(
      registrarUsoDeModelo(txQueNoSeToca, TENANT, { ...base, llamadas: 0 }),
    ).rejects.toThrow(/llamadas tiene que ser un entero positivo/);
    await expect(
      registrarUsoDeModelo(txQueNoSeToca, TENANT, {
        ...base,
        tokens: { entrada: -3, salida: 0 },
      }),
    ).rejects.toThrow(/tokens.entrada/);
    await expect(
      registrarUsoDeModelo(txQueNoSeToca, TENANT, { ...base, pasoId: 'paso-1' }),
    ).rejects.toThrow(/pasoId no es un UUID/);
  });
});

describe('catálogo de tarifas', () => {
  const catalogo: unknown = JSON.parse(readFileSync(RUTA_CATALOGO_EJEMPLO, 'utf8'));

  it('el catálogo de desarrollo valida y trae tarifas de más de un proveedor', () => {
    const tarifas = tarifasDelCatalogo(catalogo);
    expect(tarifas.length).toBeGreaterThan(2);
    expect(new Set(tarifas.map((t) => t.proveedor)).size).toBeGreaterThan(1);
    for (const tarifa of tarifas) {
      expect(tarifa.eurosPorMillonEntrada).toBeGreaterThanOrEqual(0);
      expect(tarifa.vigenteDesde.getTime()).not.toBeNaN();
      expect(tarifa.fuente.length).toBeGreaterThan(0);
    }
  });

  it('las filas reales de Bedrock UE llevan región, moneda de origen y tipo de cambio (decisión de Jesús, 2026-09-25)', () => {
    const tarifas = tarifasDelCatalogo(catalogo);
    const bedrock = tarifas.filter((t) => t.plataforma === 'bedrock-eu');
    expect(bedrock.length).toBeGreaterThanOrEqual(6);
    for (const tarifa of bedrock) {
      expect(tarifa.region).toBe('eu-central-1');
      expect(tarifa.monedaOrigen).toBe('usd');
      expect(tarifa.tipoCambioAEuros).toBeGreaterThan(0);
      expect(tarifa.precioOrigenPorMillonEntrada).toBeGreaterThan(0);
      expect(tarifa.eurosPorMillonEntradaCacheEscritura5m).toBeGreaterThan(0);
      expect(tarifa.eurosPorMillonEntradaCacheEscritura1h).toBeGreaterThan(0);
    }
    const provisionales = bedrock.filter((t) =>
      ['claude-opus-4-6', 'claude-sonnet-4-6'].includes(t.modelo),
    );
    expect(provisionales.length).toBe(2);
  });

  it('un catálogo con un precio negativo se rechaza entero', () => {
    const roto = {
      version: 1,
      tarifas: [
        {
          proveedor: 'anthropic',
          modelo: 'claude-haiku-4-5',
          eurosPorMillonEntrada: -1,
          eurosPorMillonSalida: 5,
          vigenteDesde: '2026-09-01T00:00:00.000Z',
          fuente: 'lista pública',
        },
      ],
    };
    expect(() => tarifasDelCatalogo(roto)).toThrow(/Catálogo de tarifas no válido/);
  });

  it('una fecha que no es fecha se rechaza', () => {
    const roto = {
      version: 1,
      tarifas: [
        {
          proveedor: 'mistral',
          modelo: 'mistral-small-latest',
          eurosPorMillonEntrada: 0.2,
          eurosPorMillonSalida: 0.6,
          vigenteDesde: 'el mes que viene',
          fuente: 'lista pública',
        },
      ],
    };
    expect(() => tarifasDelCatalogo(roto)).toThrow(/vigenteDesde no es una fecha ISO 8601/);
  });

  it('un catálogo vacío o de otra versión se rechaza', () => {
    expect(() => tarifasDelCatalogo({ version: 1, tarifas: [] })).toThrow(/no válido/);
    expect(() => tarifasDelCatalogo({ version: 2, tarifas: [] })).toThrow(/no válido/);
    expect(esquemaCatalogoTarifas.safeParse(catalogo).success).toBe(true);
  });

  it('el catálogo no lleva ninguna credencial', () => {
    const texto = readFileSync(RUTA_CATALOGO_EJEMPLO, 'utf8');
    // «tokens» aparece porque los precios son por millón de tokens; lo que no puede
    // aparecer es un campo de credencial ni un valor con pinta de clave.
    expect(texto).not.toMatch(/(api[_-]?key|secret|password|"token")/i);
    expect(texto).not.toMatch(/(sk|pk)-[a-z0-9]{8,}/i);
  });
});
