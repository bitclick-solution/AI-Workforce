/**
 * El cuerpo de la petición llega a todos los manejadores, por el servidor entero.
 *
 * Regresión de «Encargar devuelve siempre 400 "Falta el encargo"»: cada manejador
 * leía el flujo de la petición por su cuenta, y el de la sala, primero en la cadena,
 * lo consumía en cualquier POST aunque la ruta no fuera suya. Estas pruebas no pasan
 * por `atenderInicio` suelto: arrancan `arrancarApi` con las tres rutas montadas
 * (sala, inicio y perfil) y mandan JSON real por HTTP.
 *
 * No necesitan PostgreSQL ni Temporal: los puertos son dobles que anotan lo que
 * reciben, y la conexión es un marcador que solo hace que las rutas se registren.
 */
import type { Conexion } from '@aiw/db';
import type { AprobacionLeida } from '@aiw/ledger';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ResolutorDeSesion } from '../identidad/acceso';
import type { PuertoInicio } from '../rutas/inicio';
import type { PuertoPerfil } from '../rutas/perfil';
import type { PuertoSala } from '../rutas/sala';
import { arrancarApi, type ApiEnMarcha } from '../servidor';

const TOKEN_SALA = 'token-de-sala-de-prueba';
const TENANT = '01900000-0000-7000-8000-000000000001';
const PERSONA = '01900000-0000-7000-8000-000000000002';
const SALA = '01900000-0000-7000-8000-000000000003';
const PUESTO = '01900000-0000-7000-8000-000000000004';
const APROBACION = '01900000-0000-7000-8000-000000000005';
const PROPUESTA = '01900000-0000-7000-8000-000000000006';

const sesion: ResolutorDeSesion = () =>
  Promise.resolve({
    sesionId: 's',
    usuarioId: 'u',
    tenantId: TENANT,
    personaId: PERSONA,
    nombre: 'Persona de prueba',
    correo: 'persona@prueba.invalid',
    caducaEn: new Date(Date.now() + 60_000),
  });

describe('cuerpo de la petición por el servidor entero', () => {
  let api: ApiEnMarcha;
  const recibido: Record<string, unknown> = {};

  const puertoSala = {
    personaActiva: () => Promise.resolve(true),
    salaGeneral: () => Promise.resolve(SALA),
    arrancarMensaje: (entrada: { texto: string }) => {
      recibido['mensaje'] = entrada.texto;
      return Promise.resolve();
    },
    propuestas: () => Promise.resolve([{ id: PROPUESTA, estado: 'pendiente' }]),
    decidirPropuesta: (_id: string, carga: { sentido: string }) => {
      recibido['propuesta'] = carga.sentido;
      return Promise.resolve();
    },
  } as unknown as PuertoSala;

  const puertoInicio = {
    puestoAdmiteEncargo: () => Promise.resolve(true),
    crearTareaDeEncargo: (_tenant: string, datos: { encargo: string }) => {
      recibido['encargo'] = datos.encargo;
      return Promise.resolve({ tareaId: 'tarea-1' });
    },
    aprobacionParaDecidir: () =>
      Promise.resolve({ personaId: PERSONA, decision: null } as unknown as AprobacionLeida),
    decidirAprobacion: (_tenant: string, datos: { sentido: string }) => {
      recibido['aviso'] = datos.sentido;
      return Promise.resolve({ decidida: true });
    },
  } as unknown as PuertoInicio;

  const puertoPerfil = {
    leer: () => Promise.resolve({ mostrarPresencia: true, disposicionPanel: [] }),
    actualizarPresencia: (_t: string, _p: string, mostrar: boolean) => {
      recibido['presencia'] = mostrar;
      return Promise.resolve({ mostrarPresencia: mostrar, disposicionPanel: [] });
    },
    actualizarDisposicion: (_t: string, _p: string, disposicion: unknown[]) => {
      recibido['disposicion'] = disposicion;
      return Promise.resolve({ mostrarPresencia: true, disposicionPanel: [] });
    },
  } as unknown as PuertoPerfil;

  beforeAll(async () => {
    api = await arrancarApi({
      entorno: {
        AIW_API_PUERTO: '0',
        AIW_SALA_V0: '1',
        AIW_SALA_TOKEN: TOKEN_SALA,
        AIW_INICIO_PANEL: '1',
      },
      // Marcador: solo hace que las rutas con base de datos se registren. Ningún
      // manejador de esta prueba lo usa, porque los puertos están inyectados.
      conexion: { cliente: {} } as unknown as Conexion,
      resolverSesion: sesion,
      puertoSala,
      puertoInicio,
      puertoPerfil,
    });
  });

  afterAll(async () => {
    await api.cerrar();
  });

  async function enviar(
    metodo: string,
    ruta: string,
    cuerpo: unknown,
  ): Promise<{ estado: number; cuerpo: Record<string, unknown> }> {
    const respuesta = await fetch(`http://127.0.0.1:${api.puerto}${ruta}`, {
      method: metodo,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN_SALA}` },
      body: JSON.stringify(cuerpo),
    });
    const texto = await respuesta.text();
    return {
      estado: respuesta.status,
      cuerpo: texto.length > 0 ? (JSON.parse(texto) as Record<string, unknown>) : {},
    };
  }

  it('«Encargar» del Inicio recibe la frase aunque la sala esté antes en la cadena', async () => {
    const r = await enviar('POST', '/inicio/encargar', {
      encargo: 'Reclama las facturas vencidas',
      puestoId: PUESTO,
    });
    expect(r).toEqual({ estado: 202, cuerpo: { tareaId: 'tarea-1' } });
    expect(recibido['encargo']).toBe('Reclama las facturas vencidas');
  });

  it('decidir una aprobación desde los avisos del Inicio recibe el sentido', async () => {
    const r = await enviar('POST', `/inicio/avisos/${APROBACION}/decidir`, { sentido: 'aprobada' });
    expect(r.estado).toBe(200);
    expect(recibido['aviso']).toBe('aprobada');
  });

  it('un mensaje de la sala recibe el texto', async () => {
    const r = await enviar('POST', '/sala/mensajes', { texto: 'Hola, equipo' });
    expect(r.estado).toBe(202);
    expect(recibido['mensaje']).toBe('Hola, equipo');
  });

  it('decidir una propuesta de la sala recibe el sentido', async () => {
    const r = await enviar('POST', `/sala/propuestas/${PROPUESTA}/decision`, {
      sentido: 'rechazada',
    });
    expect(r.estado).toBe(202);
    expect(recibido['propuesta']).toBe('rechazada');
  });

  it('el perfil recibe el PATCH de presencia y el de disposición', async () => {
    expect((await enviar('PATCH', '/perfil', { mostrarPresencia: false })).estado).toBe(200);
    expect(recibido['presencia']).toBe(false);

    const disposicion = [{ id: 'saludo', tamano: 'grande', oculto: false }];
    expect((await enviar('PATCH', '/perfil', { disposicionPanel: disposicion })).estado).toBe(200);
    expect(recibido['disposicion']).toEqual(disposicion);
  });

  it('un encargo realmente vacío sigue dando 400', async () => {
    const r = await enviar('POST', '/inicio/encargar', { encargo: '  ', puestoId: PUESTO });
    expect(r).toEqual({ estado: 400, cuerpo: { error: 'Falta el encargo.' } });
  });

  it('un cuerpo que no es JSON se trata como vacío en todas las rutas', async () => {
    const respuesta = await fetch(`http://127.0.0.1:${api.puerto}/inicio/encargar`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN_SALA}` },
      body: '{no es json',
    });
    expect(respuesta.status).toBe(400);
  });
});
