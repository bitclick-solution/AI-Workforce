/**
 * Departamento de Finanzas con los dos puestos de la prueba técnica del stack.
 *
 * La especificación pide «dos puestos de Finanzas sembrados por script, no por la
 * sala»: Cobros activo con lectura N3 y escritura N1, y Conciliación en prueba. La
 * semilla vive aquí, en el paquete que es dueño del esquema, porque la usan el
 * gateway MCP en sus pruebas y el trabajador en su demostración, y un puesto mal
 * sembrado en dos sitios distintos es una prueba que no demuestra nada.
 *
 * No escribe en el libro de auditoría: eso solo lo hace `@aiw/ledger`. Sembrar una
 * organización no es una acción de un agente.
 */
import type postgres from 'postgres';

import { conTenant } from '../cliente.js';
import { uuidV7 } from '../identificadores.js';

/** Nombres estables: los usan las pruebas, la demostración y el caso dorado. */
export const NOMBRE_DEPARTAMENTO = 'Finanzas';
export const PUESTO_COBROS = 'Cobros';
export const PUESTO_CONCILIACION = 'Conciliación';

export interface OpcionesFinanzas {
  /** Nombre de la organización. Tiene que ser único en la base. */
  nombre: string;
  /** Nombre del conector que sirve las herramientas de cobros. */
  conector: string;
  /** Referencia del secreto del conector, p. ej. `env:DEMO_CONECTOR_SECRETO`. */
  referenciaSecreto: string;
  /** Herramientas autorizadas al puesto de Cobros. */
  listaBlanca: readonly string[];
  /** Presupuesto por tarea del puesto de Cobros, en euros. */
  presupuestoEuros?: number | undefined;
}

export interface FinanzasSembrado {
  tenantId: string;
  personaId: string;
  departamentoId: string;
  conectorId: string;
  cobros: PuestoSembrado;
  conciliacion: PuestoSembrado;
}

export interface PuestoSembrado {
  puestoId: string;
  versionPuestoId: string;
  autorizacionId: string;
}

function exigir<T>(valor: T | undefined, que: string): T {
  if (valor === undefined) throw new Error(`La semilla de Finanzas no creó ${que}.`);
  return valor;
}

/**
 * Siembra la organización completa y devuelve los identificadores.
 *
 * Los dos puestos comparten conector y lista blanca a propósito: la diferencia
 * entre ellos es el estado, y eso es justo lo que la prueba tiene que aislar. Si
 * Conciliación no simulase las escrituras por estar en prueba, la única explicación
 * posible sería el estado, porque todo lo demás es idéntico.
 */
export async function sembrarFinanzas(
  cliente: postgres.Sql,
  opciones: OpcionesFinanzas,
): Promise<FinanzasSembrado> {
  const tenantId = uuidV7();
  const presupuesto = opciones.presupuestoEuros ?? 2;

  return conTenant(cliente, tenantId, async (tx) => {
    await tx`
      insert into organizacion (id, nombre, plan, brand_voice)
      values (
        ${tenantId}, ${opciones.nombre}, 'business',
        '{"tono":"cercano y directo","tratamiento":"tu"}'::jsonb
      )
    `;

    const [persona] = await tx<{ id: string }[]>`
      insert into persona (tenant_id, nombre, correo)
      values (${tenantId}, 'Jesús', ${`jefatura+${tenantId}@aiworkforce.local`})
      returning id
    `;
    const personaId = exigir(persona?.id, 'la persona');

    const [departamento] = await tx<{ id: string }[]>`
      insert into departamento (tenant_id, nombre, supervisor_persona_id, estado, presupuesto_euros)
      values (${tenantId}, ${NOMBRE_DEPARTAMENTO}, ${personaId}, 'activo', 50)
      returning id
    `;
    const departamentoId = exigir(departamento?.id, 'el departamento');

    const [conector] = await tx<{ id: string }[]>`
      insert into conector (tenant_id, tipo, nombre, referencia_secreto, estado)
      values (${tenantId}, 'mcp', ${opciones.conector}, ${opciones.referenciaSecreto}, 'activo')
      returning id
    `;
    const conectorId = exigir(conector?.id, 'el conector');

    async function sembrarPuesto(
      nombre: string,
      estado: 'activo' | 'en_prueba',
      prompt: string,
    ): Promise<PuestoSembrado> {
      const politica = {
        niveles: { lectura: 'n3', escritura: 'n1' },
        presupuestoPorTareaEuros: presupuesto,
        guardiasEntrada: [],
        guardiasSalida: ['sin_secretos'],
        clasesProhibidas: [],
      };
      const [puesto] = await tx<{ id: string }[]>`
        insert into puesto (tenant_id, departamento_id, nombre, clase_riesgo, estado, enrutado_modelo)
        values (
          ${tenantId}, ${departamentoId}, ${nombre}, 'medio', ${estado},
          '{"proveedor":"prueba","modelo":"deterministico"}'::jsonb
        )
        returning id
      `;
      const puestoId = exigir(puesto?.id, `el puesto ${nombre}`);

      const [version] = await tx<{ id: string }[]>`
        insert into version_puesto (tenant_id, puesto_id, numero, prompt, politica)
        values (
          ${tenantId}, ${puestoId}, 1, ${prompt},
          ${JSON.stringify(politica)}::text::jsonb
        )
        returning id
      `;
      const versionPuestoId = exigir(version?.id, `la versión del puesto ${nombre}`);
      await tx`update puesto set version_activa_id = ${versionPuestoId} where id = ${puestoId}`;

      const [autorizacion] = await tx<{ id: string }[]>`
        insert into autorizacion_herramientas (
          tenant_id, puesto_id, conector_id, lista_blanca, niveles_por_clase,
          concedida_por_persona_id
        ) values (
          ${tenantId}, ${puestoId}, ${conectorId},
          ${JSON.stringify(opciones.listaBlanca)}::text::jsonb,
          '{"lectura":"n3","escritura":"n1"}'::jsonb,
          ${personaId}
        )
        returning id
      `;

      return {
        puestoId,
        versionPuestoId,
        autorizacionId: exigir(autorizacion?.id, `la autorización del puesto ${nombre}`),
      };
    }

    const cobros = await sembrarPuesto(
      PUESTO_COBROS,
      'activo',
      'Eres el agente de Cobros de Finanzas. Revisas las facturas vencidas y ' +
        'propones una nota de seguimiento por cada una, en el tono de la organización. ' +
        'No propones nada para una factura que no ha vencido.',
    );
    const conciliacion = await sembrarPuesto(
      PUESTO_CONCILIACION,
      'en_prueba',
      'Eres el agente de Conciliación de Finanzas. Cruzas una factura con el ' +
        'extracto bancario y propones el asiento. Estás en prueba: no escribes en ningún sistema.',
    );

    return { tenantId, personaId, departamentoId, conectorId, cobros, conciliacion };
  });
}
