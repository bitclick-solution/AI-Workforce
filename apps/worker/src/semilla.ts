/**
 * Semilla de la demostración: organización, dos puestos, conector y tarifa.
 *
 * La especificación pide los puestos «sembrados por script, no por la sala»: la
 * sala y la contratación desde una frase son otra rebanada. Esto es un guion de
 * demostración, y por eso vive en la aplicación y no en el camino de producción.
 *
 * Los puestos los crea `sembrarFinanzas` de `@aiw/db/pruebas`, que es la misma
 * función que usan las pruebas del gateway: si la demostración y las pruebas
 * sembraran cada una lo suyo, aprobarlas las dos no demostraría lo mismo.
 */
import { conTenant } from '@aiw/db';
import { sembrarFinanzas, type FinanzasSembrado } from '@aiw/db/pruebas';
import {
  HERRAMIENTA_LISTAR,
  HERRAMIENTA_NOTA,
  NOMBRE_CONECTOR_DEMO,
  REFERENCIA_SECRETO_DEMO,
} from '@aiw/connector-demo';
import { registrarTarifa } from '@aiw/ledger';
import { MODELO_PRUEBA, MODELO_PRUEBA_CONCILIACION, PROVEEDOR_PRUEBA } from '@aiw/models';
import type postgres from 'postgres';

/**
 * Tarifa del proveedor de prueba.
 *
 * No es cero. Con precio cero el contador cuadraría siempre y la parada por
 * presupuesto nunca llegaría, así que la demostración no demostraría ni el coste ni
 * el corte. Con este precio, una tarea de cobros cuesta céntimos y la parada se
 * puede provocar bajando el presupuesto de la tarea.
 */
export const TARIFA_DE_PRUEBA = {
  proveedor: PROVEEDOR_PRUEBA,
  modelo: MODELO_PRUEBA,
  eurosPorMillonEntrada: 3,
  eurosPorMillonSalida: 15,
  eurosPorMillonEntradaCache: 0.3,
  fuente: 'Precio de referencia para la prueba técnica del stack, no un precio real',
};

export interface SemillaDeDemostracion extends FinanzasSembrado {
  /** Tarifa del modelo de Cobros. */
  tarifaId: string;
  /** Tarifa del modelo de Conciliación: sin ella, el uso del hijo no tiene precio. */
  tarifaConciliacionId: string;
}

export interface OpcionesSemilla {
  nombre: string;
  /** Presupuesto por tarea del puesto, en euros. */
  presupuestoEuros?: number | undefined;
  /** Desde cuándo vale la tarifa. Antes de ahora, o el uso no encuentra precio. */
  tarifaDesde?: Date | undefined;
}

export async function sembrarDemostracion(
  cliente: postgres.Sql,
  opciones: OpcionesSemilla,
): Promise<SemillaDeDemostracion> {
  const sembrado = await sembrarFinanzas(cliente, {
    nombre: opciones.nombre,
    conector: NOMBRE_CONECTOR_DEMO,
    referenciaSecreto: REFERENCIA_SECRETO_DEMO,
    listaBlanca: [HERRAMIENTA_LISTAR, HERRAMIENTA_NOTA],
    ...(opciones.presupuestoEuros === undefined
      ? {}
      : { presupuestoEuros: opciones.presupuestoEuros }),
  });

  // Un día antes: la tarifa aplicable es la de mayor vigencia que no sea posterior
  // al uso, y un uso con la misma marca que su tarifa es una carrera que no hace
  // falta correr.
  const vigenteDesde = opciones.tarifaDesde ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  // Cada puesto usa su modelo del proveedor de prueba, y cada modelo necesita su
  // tarifa: el mismo precio, porque los dos son el mismo proveedor de mentira. Se
  // registran una detrás de otra: cada registro anota en el libro, y dos anotaciones
  // a la vez en la misma transacción leen el mismo eslabón anterior y rompen la cadena.
  const [tarifa, tarifaConciliacion] = await conTenant(cliente, sembrado.tenantId, async (tx) => [
    await registrarTarifa(tx, sembrado.tenantId, { ...TARIFA_DE_PRUEBA, vigenteDesde }),
    await registrarTarifa(tx, sembrado.tenantId, {
      ...TARIFA_DE_PRUEBA,
      modelo: MODELO_PRUEBA_CONCILIACION,
      vigenteDesde,
    }),
  ]);

  return { ...sembrado, tarifaId: tarifa.id, tarifaConciliacionId: tarifaConciliacion.id };
}

export interface TareaSembrada {
  tareaId: string;
}

/** Crea la tarea raíz de la demostración con su presupuesto. */
export async function crearTareaRaiz(
  cliente: postgres.Sql,
  datos: {
    tenantId: string;
    puestoId: string;
    versionPuestoId: string;
    presupuestoEuros: number;
  },
): Promise<TareaSembrada> {
  const tareaId = await conTenant(cliente, datos.tenantId, async (tx) => {
    const [tarea] = await tx<{ id: string }[]>`
      insert into tarea (
        tenant_id, puesto_id, version_puesto_id, origen, estado, presupuesto_euros
      ) values (
        ${datos.tenantId}, ${datos.puestoId}, ${datos.versionPuestoId},
        'manual', 'pendiente', ${datos.presupuestoEuros}
      )
      returning id
    `;
    if (!tarea) throw new Error('La tarea raíz de la demostración no se insertó.');
    // Una tarea raíz apunta a sí misma: así el contador la reconoce como unidad de
    // consumo y las delegaciones tienen a dónde sumar.
    await tx`update tarea set tarea_raiz_id = ${tarea.id} where id = ${tarea.id}`;
    return tarea.id;
  });
  return { tareaId };
}
