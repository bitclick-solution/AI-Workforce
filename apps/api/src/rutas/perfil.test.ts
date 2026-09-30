import { describe, expect, it } from 'vitest';

import type { ResolutorDeSesion } from '../identidad/acceso';
import {
  atenderPerfil,
  type EntradaDeDisposicion,
  type PeticionPerfil,
  type PerfilDeLaVista,
  type PuertoPerfil,
} from './perfil';

const TENANT = '01a0d39e-98c3-7970-814a-0a98ad132311';
const PERSONA = '01a0d39e-98c3-7970-814a-0a98ad132312';

const sesiones: ResolutorDeSesion = (cabeceras) =>
  Promise.resolve(
    cabeceras['cookie'] === 'aiw.session_token=valida'
      ? {
          sesionId: '01a0d39e-98c3-7970-814a-0a98ad132399',
          usuarioId: '01a0d39e-98c3-7970-814a-0a98ad132398',
          tenantId: TENANT,
          personaId: PERSONA,
          nombre: 'Propietaria',
          correo: 'propietaria@ejemplo.local',
          caducaEn: new Date(Date.now() + 3_600_000),
        }
      : null,
  );

function atender(peticion: PeticionPerfil, puerto: PuertoPerfil | undefined) {
  return atenderPerfil(peticion, puerto, sesiones);
}

function peticion(parcial: Partial<PeticionPerfil> = {}): PeticionPerfil {
  return {
    metodo: 'GET',
    url: '/perfil',
    cabeceras: { cookie: 'aiw.session_token=valida' },
    ...parcial,
  };
}

function puertoFalso(
  mostrarPresenciaInicial = true,
  disposicionInicial: EntradaDeDisposicion[] = [],
) {
  let mostrarPresencia = mostrarPresenciaInicial;
  let disposicionPanel = disposicionInicial;
  const actualizaciones: { tenantId: string; personaId: string; mostrarPresencia: boolean }[] = [];
  const actualizacionesDisposicion: {
    tenantId: string;
    personaId: string;
    disposicionPanel: EntradaDeDisposicion[];
  }[] = [];
  const estado = (): PerfilDeLaVista => ({ mostrarPresencia, disposicionPanel });
  const puerto: PuertoPerfil = {
    leer: () => Promise.resolve(estado()),
    actualizarPresencia: (tenantId, personaId, valor) => {
      mostrarPresencia = valor;
      actualizaciones.push({ tenantId, personaId, mostrarPresencia: valor });
      return Promise.resolve(estado());
    },
    actualizarDisposicion: (tenantId, personaId, valor) => {
      disposicionPanel = valor;
      actualizacionesDisposicion.push({ tenantId, personaId, disposicionPanel: valor });
      return Promise.resolve(estado());
    },
  };
  return { puerto, actualizaciones, actualizacionesDisposicion };
}

describe('ruta del perfil', () => {
  it('una ruta que no es /perfil no es suya', async () => {
    expect(await atender(peticion({ url: '/otra' }), puertoFalso().puerto)).toBeUndefined();
  });

  it('sin puerto la ruta no existe', async () => {
    expect(await atender(peticion(), undefined)).toBeUndefined();
  });

  it('sin sesión, 401 y ninguna lectura', async () => {
    const { puerto } = puertoFalso();
    const respuesta = await atender(peticion({ cabeceras: {} }), puerto);
    expect(respuesta?.estado).toBe(401);
  });

  it('GET lee el ajuste, activado por defecto y sin disposición', async () => {
    const { puerto } = puertoFalso();
    const respuesta = await atender(peticion(), puerto);
    expect(respuesta?.estado).toBe(200);
    expect(respuesta?.cuerpo).toEqual({ mostrarPresencia: true, disposicionPanel: [] });
  });

  it('PATCH cambia el ajuste con la persona de la sesión, nunca de una cabecera', async () => {
    const { puerto, actualizaciones } = puertoFalso();
    const respuesta = await atender(
      peticion({
        metodo: 'PATCH',
        cuerpo: { mostrarPresencia: false },
        cabeceras: { cookie: 'aiw.session_token=valida', 'x-aiw-persona': 'otra' },
      }),
      puerto,
    );
    expect(respuesta?.estado).toBe(200);
    expect(respuesta?.cuerpo).toEqual({ mostrarPresencia: false, disposicionPanel: [] });
    expect(actualizaciones).toEqual([
      { tenantId: TENANT, personaId: PERSONA, mostrarPresencia: false },
    ]);
  });

  it('PATCH rechaza un cuerpo sin un booleano', async () => {
    const { puerto, actualizaciones } = puertoFalso();
    const respuesta = await atender(
      peticion({ metodo: 'PATCH', cuerpo: { mostrarPresencia: 'no' } }),
      puerto,
    );
    expect(respuesta?.estado).toBe(400);
    expect(actualizaciones).toEqual([]);
  });

  it('PATCH guarda la disposición del panel de widgets', async () => {
    const { puerto, actualizacionesDisposicion } = puertoFalso();
    const disposicion: EntradaDeDisposicion[] = [
      { id: 'saludo', tamano: 'grande', oculto: false },
      { id: 'contador', tamano: 'pequeno', oculto: true },
    ];
    const respuesta = await atender(
      peticion({ metodo: 'PATCH', cuerpo: { disposicionPanel: disposicion } }),
      puerto,
    );
    expect(respuesta?.estado).toBe(200);
    expect(respuesta?.cuerpo).toEqual({ mostrarPresencia: true, disposicionPanel: disposicion });
    expect(actualizacionesDisposicion).toEqual([
      { tenantId: TENANT, personaId: PERSONA, disposicionPanel: disposicion },
    ]);
  });

  it('PATCH cambia los dos ajustes a la vez si los dos llegan', async () => {
    const { puerto } = puertoFalso();
    const respuesta = await atender(
      peticion({
        metodo: 'PATCH',
        cuerpo: {
          mostrarPresencia: false,
          disposicionPanel: [{ id: 'equipo', tamano: 'mediano', oculto: false }],
        },
      }),
      puerto,
    );
    expect(respuesta?.cuerpo).toEqual({
      mostrarPresencia: false,
      disposicionPanel: [{ id: 'equipo', tamano: 'mediano', oculto: false }],
    });
  });

  it('PATCH rechaza una disposición con un tamaño fuera del catálogo', async () => {
    const { puerto, actualizacionesDisposicion } = puertoFalso();
    const respuesta = await atender(
      peticion({
        metodo: 'PATCH',
        cuerpo: { disposicionPanel: [{ id: 'saludo', tamano: 'enorme', oculto: false }] },
      }),
      puerto,
    );
    expect(respuesta?.estado).toBe(400);
    expect(actualizacionesDisposicion).toEqual([]);
  });

  it('PATCH sin ningún campo conocido responde 400', async () => {
    const { puerto } = puertoFalso();
    const respuesta = await atender(peticion({ metodo: 'PATCH', cuerpo: {} }), puerto);
    expect(respuesta?.estado).toBe(400);
  });

  it('otro método no permitido responde 405', async () => {
    const { puerto } = puertoFalso();
    const respuesta = await atender(peticion({ metodo: 'DELETE' }), puerto);
    expect(respuesta?.estado).toBe(405);
  });
});
