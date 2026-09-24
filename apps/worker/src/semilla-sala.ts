/**
 * Semilla de la sala v0: Finanzas con Cobros, la sala general y sus participantes.
 *
 * Conciliación no se siembra: en esta rebanada se contrata desde una frase. La
 * ficha de Cobros sale de su plantilla del catálogo —los temas con los que el
 * moderador le da la palabra—, igual que la de cualquier puesto contratado por el
 * Director. Es un guion de demostración y de pruebas, no un camino de producción.
 */
import { conTenant } from '@aiw/db';
import { sembrarFinanzas, type PuestoSembrado } from '@aiw/db/pruebas';
import {
  HERRAMIENTA_LISTAR,
  HERRAMIENTA_NOTA,
  NOMBRE_CONECTOR_DEMO,
  REFERENCIA_SECRETO_DEMO,
} from '@aiw/connector-demo';
import { CATALOGO } from '@aiw/platform-agents';
import { NOMBRE_SALA_GENERAL } from '@aiw/rooms';
import type postgres from 'postgres';

import { registrarTarifasDePrueba } from './semilla.js';

export const PLANTILLA_COBROS = 'finanzas.reclamacion-de-cobros';

export interface SemillaDeSala {
  tenantId: string;
  personaId: string;
  departamentoId: string;
  conectorId: string;
  cobros: PuestoSembrado;
  salaId: string;
}

export async function sembrarSala(
  cliente: postgres.Sql,
  opciones: { nombre: string; tarifaDesde?: Date | undefined },
): Promise<SemillaDeSala> {
  const sembrado = await sembrarFinanzas(cliente, {
    nombre: opciones.nombre,
    conector: NOMBRE_CONECTOR_DEMO,
    referenciaSecreto: REFERENCIA_SECRETO_DEMO,
    listaBlanca: [HERRAMIENTA_LISTAR, HERRAMIENTA_NOTA],
    soloCobros: true,
  });
  await registrarTarifasDePrueba(cliente, sembrado.tenantId, opciones.tarifaDesde);

  const plantilla = CATALOGO.plantillas.find((p) => p.id === PLANTILLA_COBROS);
  if (!plantilla) throw new Error(`El catálogo no tiene la plantilla ${PLANTILLA_COBROS}.`);

  const salaId = await conTenant(cliente, sembrado.tenantId, async (tx) => {
    const ficha = {
      ...plantilla.ficha,
      temas: plantilla.temas,
      plantilla: { id: plantilla.id, version: plantilla.version },
    };
    await tx`
      update puesto set ficha = ${JSON.stringify(ficha)}::text::jsonb
      where tenant_id = ${sembrado.tenantId} and id = ${sembrado.cobros.puestoId}
    `;
    const [sala] = await tx<{ id: string }[]>`
      insert into sala (tenant_id, ambito, nombre)
      values (${sembrado.tenantId}, 'organizacion', ${NOMBRE_SALA_GENERAL})
      returning id
    `;
    if (!sala) throw new Error('La sala general no se insertó.');
    await tx`
      insert into sala_participante (tenant_id, sala_id, persona_id, rol)
      values (${sembrado.tenantId}, ${sala.id}, ${sembrado.personaId}, 'humano')
    `;
    await tx`
      insert into sala_participante (tenant_id, sala_id, puesto_id, rol)
      values (${sembrado.tenantId}, ${sala.id}, ${sembrado.cobros.puestoId}, 'agente')
    `;
    return sala.id;
  });

  return { ...sembrado, salaId };
}
