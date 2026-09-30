/**
 * Siembra de la organización persistente de Bitclick (ADR-024, criterio de hecho 2).
 *
 * A diferencia de `../semilla.ts` (una organización nueva en cada demostración),
 * esta siembra es idempotente y para una sola organización que sobrevive a
 * `pnpm local:parar` / `pnpm local:arrancar`: solo `pnpm local:a-cero` la borra.
 * La idempotencia no se comprueba buscando por nombre —la política de RLS de
 * `organizacion` exige conocer ya el `tenant_id` para leer su fila, por diseño
 * (packages/db/drizzle/0000_inicial.sql, `organizacion_tenant`)—, así que el
 * `tenant_id` se guarda una vez en `.aiw-local/` y las siguientes ejecuciones lo
 * leen de ahí (`./estado-local.ts`).
 *
 * El puesto de Cobros se crea desde la plantilla certificada
 * `finanzas.reclamacion-de-cobros` del catálogo de `@aiw/platform-agents`, tal
 * cual: ni su prompt, ni sus niveles, ni su enrutado de modelo se tocan aquí.
 *
 *   pnpm --filter @aiw/worker bitclick:sembrar
 */
import { readFileSync } from 'node:fs';

import { conTenant, uuidV7 } from '@aiw/db';
import type { PlataformaModelo } from '@aiw/domain';
import {
  RUTA_CATALOGO_EJEMPLO,
  registrarTarifa,
  tarifaVigente,
  tarifasDelCatalogo,
} from '@aiw/ledger';
import { CATALOGO, type Plantilla } from '@aiw/platform-agents';
import type postgres from 'postgres';

import {
  ID_PLANTILLA_COBROS,
  LISTA_BLANCA_COBROS,
  NOMBRE_CONECTOR_ODOO,
  NOMBRE_DEPARTAMENTO_FINANZAS,
  NOMBRE_ORGANIZACION_BITCLICK,
  REFERENCIA_SECRETO_ODOO,
} from './constantes.js';
import { type EstadoBitclick, guardarEstadoBitclick, leerEstadoBitclick } from './estado-local.js';

/**
 * Correo de Jesús por defecto: destino de los recordatorios de aprobación
 * (criterio de hecho 5). Un valor de repuesto, no el real: el real lo pone Jesús
 * con `BITCLICK_CORREO_JESUS` en su `.env` (`docs/runbooks/bitclick-cobros-odoo.md`),
 * y no viaja por el repositorio.
 */
export const CORREO_JESUS_POR_DEFECTO = 'jefatura@bitclick.local';

export class PlantillaNoEncontrada extends Error {
  constructor(id: string) {
    super(
      `La plantilla «${id}» no está en el catálogo de @aiw/platform-agents. ` +
        'Esta rebanada no toca el catálogo: si falta, es un cambio de otra rebanada.',
    );
    this.name = 'PlantillaNoEncontrada';
  }
}

/** La plantilla certificada de Cobros, tal cual está en el catálogo. */
export function plantillaCobros(): Plantilla {
  const plantilla = CATALOGO.plantillas.find((p) => p.id === ID_PLANTILLA_COBROS);
  if (!plantilla) throw new PlantillaNoEncontrada(ID_PLANTILLA_COBROS);
  return plantilla;
}

export interface OpcionesSiembraBitclick {
  /** Correo de Jesús. Por defecto, el de Bitclick. */
  correoJesus?: string | undefined;
}

export interface ResultadoSiembra extends EstadoBitclick {
  /** `false` cuando ya existía y esta ejecución solo la confirmó. */
  creada: boolean;
  /** Tarifas de Anthropic que esta ejecución dio de alta en el tenant (ninguna si ya estaban). */
  tarifasCargadas: number;
  /** `true` si esta ejecución cambió el enrutado de modelo del puesto de Cobros al de la plantilla. */
  enrutadoActualizado: boolean;
}

/** Plataformas de la UE en las que Bitclick puede usar los modelos de Anthropic (ADR-017, ADR-023). */
const PLATAFORMAS_DE_BITCLICK = [
  'bedrock-eu',
  'vertex-eu',
] as const satisfies readonly PlataformaModelo[];

/**
 * Da de alta en el tenant las tarifas de Anthropic del catálogo de desarrollo del
 * contador, solo las que falten. Sin ellas el contador no puede cobrar un paso de
 * modelo real y el trabajador se niega a llamar (`SinTarifa`). Una tarifa que ya
 * existe no se toca: los precios son dato del tenant y los cambia Operación, no una
 * siembra que se repite. Los importes son los de referencia del catálogo (ver su
 * nota); Operación los sustituye por los versionados reales.
 */
export async function cargarTarifasDeBitclick(
  cliente: postgres.Sql,
  tenantId: string,
): Promise<number> {
  const catalogo: unknown = JSON.parse(readFileSync(RUTA_CATALOGO_EJEMPLO, 'utf8'));
  const tarifas = tarifasDelCatalogo(catalogo).filter(
    (tarifa) =>
      tarifa.proveedor === 'anthropic' &&
      (PLATAFORMAS_DE_BITCLICK as readonly string[]).includes(tarifa.plataforma ?? ''),
  );
  let cargadas = 0;
  for (const tarifa of tarifas) {
    await conTenant(cliente, tenantId, async (tx) => {
      const existente = await tarifaVigente(
        tx,
        tenantId,
        tarifa.proveedor,
        tarifa.modelo,
        new Date(),
        tarifa.plataforma,
      );
      if (existente) return;
      await registrarTarifa(tx, tenantId, tarifa);
      cargadas += 1;
    });
  }
  return cargadas;
}

/**
 * Pone el enrutado de modelo del puesto de Cobros al de la plantilla certificada.
 * Un puesto sembrado antes de que las plantillas enrutaran por papel sigue apuntando
 * al proveedor de prueba, y con Bedrock elegido el trabajador se negaría a servirlo.
 */
async function ponerEnrutadoDeLaPlantilla(
  cliente: postgres.Sql,
  estado: EstadoBitclick,
  plantilla: Plantilla,
): Promise<boolean> {
  const filas = await conTenant(
    cliente,
    estado.tenantId,
    (tx) => tx<{ id: string }[]>`
      update puesto set enrutado_modelo = ${JSON.stringify(plantilla.enrutadoModelo)}::text::jsonb
      where tenant_id = ${estado.tenantId} and id = ${estado.puestoId}
        and enrutado_modelo is distinct from ${JSON.stringify(plantilla.enrutadoModelo)}::text::jsonb
      returning id
    `,
  );
  return filas.length > 0;
}

function exigir<T>(valor: T | undefined, que: string): T {
  if (valor === undefined) throw new Error(`La siembra de Bitclick no creó ${que}.`);
  return valor;
}

async function organizacionSigueViva(cliente: postgres.Sql, tenantId: string): Promise<boolean> {
  const filas = await conTenant(
    cliente,
    tenantId,
    (tx) => tx<{ id: string }[]>`select id from organizacion where id = ${tenantId}`,
  );
  return filas.length > 0;
}

async function crearOrganizacion(
  cliente: postgres.Sql,
  plantilla: Plantilla,
  correoJesus: string,
): Promise<EstadoBitclick> {
  const tenantId = uuidV7();

  return conTenant(cliente, tenantId, async (tx) => {
    await tx`
      insert into organizacion (id, nombre, plan, brand_voice)
      values (${tenantId}, ${NOMBRE_ORGANIZACION_BITCLICK}, 'business', '{"tono":"cercano"}'::jsonb)
    `;

    const [persona] = await tx<{ id: string }[]>`
      insert into persona (tenant_id, nombre, correo)
      values (${tenantId}, 'Jesús', ${correoJesus})
      returning id
    `;
    const personaId = exigir(persona?.id, 'la persona de Jesús');

    const [departamento] = await tx<{ id: string }[]>`
      insert into departamento (tenant_id, nombre, supervisor_persona_id, estado)
      values (${tenantId}, ${NOMBRE_DEPARTAMENTO_FINANZAS}, ${personaId}, 'activo')
      returning id
    `;
    const departamentoId = exigir(departamento?.id, 'el departamento de Finanzas');

    const [conector] = await tx<{ id: string }[]>`
      insert into conector (tenant_id, tipo, nombre, referencia_secreto, estado)
      values (${tenantId}, 'mcp', ${NOMBRE_CONECTOR_ODOO}, ${REFERENCIA_SECRETO_ODOO}, 'activo')
      returning id
    `;
    const conectorId = exigir(conector?.id, 'el conector de Odoo');

    const ficha = {
      ...plantilla.ficha,
      temas: plantilla.temas,
      plantilla: { id: plantilla.id, version: plantilla.version },
    };
    const [puesto] = await tx<{ id: string }[]>`
      insert into puesto (
        tenant_id, departamento_id, nombre, ficha, clase_riesgo, enrutado_modelo, estado
      ) values (
        ${tenantId}, ${departamentoId}, ${plantilla.nombre}, ${JSON.stringify(ficha)}::jsonb,
        ${plantilla.claseRiesgo}, ${JSON.stringify(plantilla.enrutadoModelo)}::jsonb, 'en_prueba'
      )
      returning id
    `;
    const puestoId = exigir(puesto?.id, 'el puesto de Cobros');

    const politica = {
      niveles: plantilla.niveles,
      presupuestoPorTareaEuros: plantilla.presupuestoPorTareaEuros,
      guardiasEntrada: [],
      guardiasSalida: plantilla.guardiasSalida,
      clasesProhibidas: [],
    };
    const [version] = await tx<{ id: string }[]>`
      insert into version_puesto (tenant_id, puesto_id, numero, prompt, politica)
      values (${tenantId}, ${puestoId}, 1, ${plantilla.prompt}, ${JSON.stringify(politica)}::jsonb)
      returning id
    `;
    const versionPuestoId = exigir(version?.id, 'la versión del puesto de Cobros');

    await tx`update puesto set version_activa_id = ${versionPuestoId} where id = ${puestoId}`;

    const [autorizacion] = await tx<{ id: string }[]>`
      insert into autorizacion_herramientas (
        tenant_id, puesto_id, conector_id, lista_blanca, niveles_por_clase, concedida_por_persona_id
      ) values (
        ${tenantId}, ${puestoId}, ${conectorId},
        ${JSON.stringify(LISTA_BLANCA_COBROS)}::jsonb, ${JSON.stringify(plantilla.niveles)}::jsonb,
        ${personaId}
      )
      returning id
    `;
    const autorizacionId = exigir(autorizacion?.id, 'la autorización de herramientas de Cobros');

    return {
      tenantId,
      personaId,
      departamentoId,
      puestoId,
      versionPuestoId,
      conectorId,
      autorizacionId,
      sembradoEn: new Date().toISOString(),
    };
  });
}

/**
 * Siembra la organización de Bitclick si no existe todavía, y confirma la que ya
 * hay si existe. Segura de repetir: la segunda ejecución no crea nada nuevo.
 */
export async function sembrarBitclick(
  cliente: postgres.Sql,
  opciones: OpcionesSiembraBitclick = {},
): Promise<ResultadoSiembra> {
  const existente = leerEstadoBitclick();
  if (existente && (await organizacionSigueViva(cliente, existente.tenantId))) {
    const enrutadoActualizado = await ponerEnrutadoDeLaPlantilla(
      cliente,
      existente,
      plantillaCobros(),
    );
    const tarifasCargadas = await cargarTarifasDeBitclick(cliente, existente.tenantId);
    return { ...existente, creada: false, tarifasCargadas, enrutadoActualizado };
  }

  const plantilla = plantillaCobros();
  const correoJesus = opciones.correoJesus ?? CORREO_JESUS_POR_DEFECTO;
  const estado = await crearOrganizacion(cliente, plantilla, correoJesus);
  guardarEstadoBitclick(estado);
  const tarifasCargadas = await cargarTarifasDeBitclick(cliente, estado.tenantId);
  return { ...estado, creada: true, tarifasCargadas, enrutadoActualizado: false };
}
