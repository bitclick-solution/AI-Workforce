/**
 * Sala v1 contra PostgreSQL: la sala de un equipo se crea con el equipo, sus
 * participantes se sincronizan con el estado real de los puestos y cada alta y
 * cada baja deja su propia entrada en el libro. El reparto por Centrifugo se
 * prueba aparte, con un `buscarCentrifugo` falso: no hace falta el Compose para
 * comprobar que el trabajador llama al canal correcto.
 */
import { conTenant } from '@aiw/db';
import { HAY_BASE_DE_DATOS, MOTIVO_SALTO, URL_BASE_DE_DATOS } from '@aiw/db/pruebas';
import { resolvedorDeEntorno } from '@aiw/mcp-gateway';
import { TrazasEnMemoria } from '@aiw/models';
import { canalDeSala } from '@aiw/rooms';
import type { BuscadorCentrifugo } from '@aiw/rooms/centrifugo';
import { afterEach, describe, expect, it } from 'vitest';

import { crearActividades } from '../actividades/index.js';
import {
  crearContextoDeActividades,
  enrutadorDeDemostracion,
  registroConDemostracion,
  type ContextoDeActividades,
} from '../actividades/contexto.js';
import { sembrarSala, type SemillaDeSala } from '../semilla-sala.js';
import { ENTORNO_DE_PRUEBA, SECRETO_DE_PRUEBA } from './montaje.js';
import { contarEnElLibro } from './temporal.js';

const TITULO = HAY_BASE_DE_DATOS
  ? 'sala v1 · sala de equipo'
  : `sala v1 · sala de equipo — SALTADO. ${MOTIVO_SALTO}`;

interface Montaje {
  contexto: ContextoDeActividades;
  semilla: SemillaDeSala;
  llamadasCentrifugo: {
    url: string;
    cuerpo: { method: string; params: Record<string, unknown> };
  }[];
  cerrar: () => Promise<void>;
}

async function montar(nombre: string, opciones: { centrifugo?: boolean } = {}): Promise<Montaje> {
  const llamadasCentrifugo: Montaje['llamadasCentrifugo'] = [];
  const buscarCentrifugo: BuscadorCentrifugo = async (url, peticion) => {
    llamadasCentrifugo.push({ url, cuerpo: JSON.parse(peticion.body) });
    return new Response('{}', { status: 200 });
  };
  const contexto = crearContextoDeActividades({
    urlBaseDeDatos: URL_BASE_DE_DATOS ?? '',
    registro: registroConDemostracion({ credencialEsperada: SECRETO_DE_PRUEBA }),
    enrutador: enrutadorDeDemostracion(),
    secretos: resolvedorDeEntorno(ENTORNO_DE_PRUEBA),
    trazas: new TrazasEnMemoria(),
    ...(opciones.centrifugo === false
      ? {}
      : {
          centrifugo: {
            urlApi: 'http://centrifugo.local:8000',
            claveApi: 'clave-de-prueba',
            secretoHmac: 'secreto-de-prueba',
          },
          buscarCentrifugo,
        }),
  });
  const semilla = await sembrarSala(contexto.cliente, { nombre });
  return { contexto, semilla, llamadasCentrifugo, cerrar: contexto.cerrar };
}

describe.skipIf(!HAY_BASE_DE_DATOS)(TITULO, () => {
  const montajes: Montaje[] = [];
  afterEach(async () => {
    await Promise.all(montajes.splice(0).map((m) => m.cerrar()));
  });

  it('crea la sala del departamento con sus puestos activos y quien lo supervisa', async () => {
    const montaje = await montar('Sala equipo alta');
    montajes.push(montaje);
    const actividades = crearActividades(montaje.contexto);

    const resultado = await actividades.asegurarSalaDeEquipo({
      tenantId: montaje.semilla.tenantId,
      departamentoId: montaje.semilla.departamentoId,
    });
    expect(resultado.creada).toBe(true);
    expect(resultado.anadidos).toBe(2); // Cobros (puesto) y Jesús (supervisor).
    expect(resultado.quitados).toBe(0);

    const participantes = await conTenant(
      montaje.contexto.cliente,
      montaje.semilla.tenantId,
      (tx) => tx<{ persona_id: string | null; puesto_id: string | null }[]>`
        select persona_id, puesto_id from sala_participante
        where tenant_id = ${montaje.semilla.tenantId} and sala_id = ${resultado.salaId}
      `,
    );
    expect(participantes).toHaveLength(2);
    expect(participantes.map((p) => p.puesto_id ?? p.persona_id).sort()).toEqual(
      [montaje.semilla.cobros.puestoId, montaje.semilla.personaId].sort(),
    );

    const contar = (accion: string) =>
      contarEnElLibro(montaje.contexto.cliente, montaje.semilla.tenantId, { accion });
    expect(await contar('sala.miembro_anadido')).toBe(2);

    // Repetirla no duplica participantes ni vuelve a anotar.
    const otraVez = await actividades.asegurarSalaDeEquipo({
      tenantId: montaje.semilla.tenantId,
      departamentoId: montaje.semilla.departamentoId,
    });
    expect(otraVez).toEqual({ ...resultado, creada: false });
    expect(await contar('sala.miembro_anadido')).toBe(2);
  });

  it('si el puesto deja de estar activo, sale de la sala con su propia entrada en el libro', async () => {
    const montaje = await montar('Sala equipo baja');
    montajes.push(montaje);
    const actividades = crearActividades(montaje.contexto);
    const primera = await actividades.asegurarSalaDeEquipo({
      tenantId: montaje.semilla.tenantId,
      departamentoId: montaje.semilla.departamentoId,
    });

    await conTenant(
      montaje.contexto.cliente,
      montaje.semilla.tenantId,
      (tx) =>
        tx`update puesto set estado = 'pausado' where tenant_id = ${montaje.semilla.tenantId} and id = ${montaje.semilla.cobros.puestoId}`,
    );

    const segunda = await actividades.asegurarSalaDeEquipo({
      tenantId: montaje.semilla.tenantId,
      departamentoId: montaje.semilla.departamentoId,
    });
    expect(segunda.salaId).toBe(primera.salaId);
    expect(segunda.anadidos).toBe(0);
    expect(segunda.quitados).toBe(1);

    const sigue = await conTenant(
      montaje.contexto.cliente,
      montaje.semilla.tenantId,
      (tx) => tx<{ puesto_id: string }[]>`
        select puesto_id from sala_participante
        where tenant_id = ${montaje.semilla.tenantId} and sala_id = ${primera.salaId}
          and puesto_id = ${montaje.semilla.cobros.puestoId}
      `,
    );
    expect(sigue).toEqual([]);
    expect(
      await contarEnElLibro(montaje.contexto.cliente, montaje.semilla.tenantId, {
        accion: 'sala.miembro_quitado',
      }),
    ).toBe(1);
  });

  it('publicar un mensaje avisa a Centrifugo en el canal de esa sala, sin guardar nada', async () => {
    const montaje = await montar('Sala equipo centrifugo');
    montajes.push(montaje);
    const actividades = crearActividades(montaje.contexto);

    await actividades.publicarMensajeHumano({
      tenantId: montaje.semilla.tenantId,
      salaId: montaje.semilla.salaId,
      mensajeId: crypto.randomUUID(),
      personaId: montaje.semilla.personaId,
      texto: 'hola equipo',
    });

    // El aviso es `void`: puede llegar en el siguiente tick, así que se espera un poco.
    await new Promise((resolver) => setTimeout(resolver, 0));
    expect(montaje.llamadasCentrifugo).toHaveLength(1);
    const [llamada] = montaje.llamadasCentrifugo;
    expect(llamada?.cuerpo.method).toBe('publish');
    expect(llamada?.cuerpo.params['channel']).toBe(
      canalDeSala(montaje.semilla.tenantId, montaje.semilla.salaId),
    );
  });

  it('sin Centrifugo configurado, publicar un mensaje no falla y no llama a nadie', async () => {
    const montaje = await montar('Sala equipo sin centrifugo', { centrifugo: false });
    montajes.push(montaje);
    const actividades = crearActividades(montaje.contexto);

    await expect(
      actividades.publicarMensajeHumano({
        tenantId: montaje.semilla.tenantId,
        salaId: montaje.semilla.salaId,
        mensajeId: crypto.randomUUID(),
        personaId: montaje.semilla.personaId,
        texto: 'hola sin Centrifugo',
      }),
    ).resolves.toMatchObject({ yaEstaba: false });
    expect(montaje.llamadasCentrifugo).toEqual([]);
  });
});
