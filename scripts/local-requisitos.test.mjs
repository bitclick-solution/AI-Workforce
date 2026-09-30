// Pruebas de la lógica pura de local-requisitos.mjs (fallos 1 y 3): la versión de
// pnpm y si un puerto «ocupado» es en realidad un contenedor de nuestro propio
// Compose. No lanzan pnpm ni Docker de verdad: son funciones puras sobre datos ya
// resueltos, la parte de estas comprobaciones que sí se puede probar sin máquina.
import { describe, expect, it } from 'vitest';

import {
  evaluarVersionPnpm,
  procesoRegistradoEnPuerto,
  puertoDeNuestroCompose,
} from './local-requisitos.mjs';

describe('evaluarVersionPnpm', () => {
  it('pnpm por debajo de 10 es un error', () => {
    expect(evaluarVersionPnpm('9.12.1', undefined).error).toMatch(/pnpm 9\.12\.1 no vale/);
    expect(evaluarVersionPnpm('', undefined).error).toMatch(/versión desconocida/);
  });

  it('pnpm 10 o superior sin packageManager declarado no da ni error ni aviso', () => {
    expect(evaluarVersionPnpm('10.33.0', undefined)).toEqual({});
  });

  it('pnpm 10 o superior que coincide con packageManager no avisa', () => {
    expect(evaluarVersionPnpm('10.33.0', '10.33.0')).toEqual({});
  });

  it('pnpm 10 o superior que difiere de packageManager avisa, no aborta', () => {
    const { error, aviso } = evaluarVersionPnpm('10.40.0', '10.33.0');
    expect(error).toBeUndefined();
    expect(aviso).toMatch(/difiere del `packageManager`/);
  });
});

describe('puertoDeNuestroCompose', () => {
  const SERVICIOS = [
    {
      Name: 'aiw-dev-postgres-1',
      Publishers: [{ URL: '127.0.0.1', TargetPort: 5432, PublishedPort: 5432, Protocol: 'tcp' }],
    },
    { Name: 'aiw-dev-centrifugo-1', Ports: '127.0.0.1:8000->8000/tcp' },
  ];

  it('un puerto que publica nuestro propio Compose no es un conflicto (fallo 3)', () => {
    expect(puertoDeNuestroCompose('5432', SERVICIOS)).toBe(true);
    expect(puertoDeNuestroCompose(5432, SERVICIOS)).toBe(true);
  });

  it('reconoce el puerto también en el formato de resguardo `Ports`', () => {
    expect(puertoDeNuestroCompose('8000', SERVICIOS)).toBe(true);
  });

  it('un puerto que no publica nuestro Compose sigue siendo un conflicto', () => {
    expect(puertoDeNuestroCompose('5432', [])).toBe(false);
    expect(puertoDeNuestroCompose('3001', SERVICIOS)).toBe(false);
  });
});

describe('procesoRegistradoEnPuerto', () => {
  const PROCESOS = [
    { nombre: 'worker-sala', pid: 111, puerto: undefined },
    { nombre: 'api', pid: 222, puerto: '3002' },
    { nombre: 'web', pid: 333, puerto: '3000' },
  ];

  it('encuentra el proceso registrado con ese puerto (criterio 3: segundo seguimiento)', () => {
    expect(procesoRegistradoEnPuerto('3002', PROCESOS)).toEqual(PROCESOS[1]);
    expect(procesoRegistradoEnPuerto(3000, PROCESOS)).toEqual(PROCESOS[2]);
  });

  it('un puerto que no coincide con lo registrado (p. ej. cambió AIW_API_PUERTO) no es nuestro', () => {
    expect(procesoRegistradoEnPuerto('4000', PROCESOS)).toBeUndefined();
  });

  it('un proceso sin puerto propio (el worker) nunca coincide', () => {
    expect(procesoRegistradoEnPuerto(undefined, PROCESOS)).toBeUndefined();
  });
});
