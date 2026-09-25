import { describe, expect, it } from 'vitest';

import { origenesDeDesarrollo, type InterfacesDeRed } from './origenes-dev';

const INTERFACES: InterfacesDeRed = {
  lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
  en0: [
    { family: 'IPv6', address: 'fe80::1', internal: false },
    { family: 'IPv4', address: '192.168.1.42', internal: false },
  ],
  docker0: [{ family: 4, address: '172.17.0.1', internal: false }],
  apagada: undefined,
};

describe('origenesDeDesarrollo', () => {
  it('recoge las IPv4 de red y descarta las internas y las IPv6', () => {
    expect(origenesDeDesarrollo(INTERFACES)).toEqual(['172.17.0.1', '192.168.1.42']);
  });

  it('acepta la familia como número, que es lo que devuelve Node moderno', () => {
    const soloNumerica: InterfacesDeRed = {
      en0: [{ family: 4, address: '10.0.0.5', internal: false }],
    };
    expect(origenesDeDesarrollo(soloNumerica)).toEqual(['10.0.0.5']);
  });

  it('sin interfaces de red no devuelve nada y no lanza', () => {
    expect(origenesDeDesarrollo({})).toEqual([]);
    expect(origenesDeDesarrollo({ lo: undefined })).toEqual([]);
  });

  it('añade los hosts declarados a mano, separados por comas', () => {
    expect(origenesDeDesarrollo({}, 'tunel.ngrok.app, portatil.local')).toEqual([
      'portatil.local',
      'tunel.ngrok.app',
    ]);
  });

  it('tolera que se pegue la URL entera del túnel en vez del host', () => {
    expect(origenesDeDesarrollo({}, 'https://abc123.ngrok-free.app/prototipo')).toEqual([
      'abc123.ngrok-free.app',
    ]);
  });

  it('ignora los huecos de una lista mal escrita', () => {
    expect(origenesDeDesarrollo({}, ' , ,uno.local, ')).toEqual(['uno.local']);
  });

  it('no repite un host que ya estaba entre las IPv4 de la máquina', () => {
    expect(origenesDeDesarrollo(INTERFACES, '192.168.1.42')).toEqual([
      '172.17.0.1',
      '192.168.1.42',
    ]);
  });

  it('sin variable de entorno se comporta igual que sin hosts declarados', () => {
    expect(origenesDeDesarrollo(INTERFACES, undefined)).toEqual(
      origenesDeDesarrollo(INTERFACES, ''),
    );
  });
});
