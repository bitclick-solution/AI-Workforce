/**
 * Puerto de clasificación de la sala sobre el enrutador de `@aiw/models`.
 *
 * El moderador y el Director de la sala de un departamento dan un paso de modelo que
 * solo clasifica (docs/specs/sala-departamento-moderador-modelo.md). Este módulo
 * resuelve ese paso igual que lo hace `pasoModelo` para un puesto —el enrutador del
 * proceso, el proveedor que elija `AIW_PROVEEDOR_MODELOS`, la tarifa vigente del
 * tenant para ponerle precio— con tres diferencias que son la decisión 7:
 *
 * - No hay respaldo de otro proveedor: es el guardián de coste de sala, no la ruta
 *   de reintento de un puesto. Un fallo se propaga y quien llama cae en silencio.
 * - Sin tarifa para un proveedor real no se llama: una llamada que no se puede
 *   cobrar no se hace. El proveedor de prueba sin tarifa cuesta 0 a propósito (demo
 *   local y CI gratis); con tarifa registrada, la usa y el coste sale en el libro.
 * - No cuelga de ningún puesto ni tarea de negocio: el coste va al libro de la sala
 *   (`entrada_auditoria.coste_euros`) y no entra en el contador de tareas.
 */
import type { PapelModelo } from '@aiw/domain';
import { calcularCosteEuros, tarifaVigente } from '@aiw/ledger';
import {
  PROVEEDOR_DE_TARIFA,
  darPasoDeModelo,
  modeloDeTarifa,
  type TokensParaElContador,
} from '@aiw/models';
import type {
  PeticionDeClasificacion,
  PuertoDeClasificacion,
  RespuestaDeClasificacion,
} from '@aiw/rooms';
import { PLATAFORMAS_MODELO, type ClasePaso, type PlataformaModelo } from '@aiw/domain';

import { enTenant, type ContextoDeActividades } from './contexto.js';

const MAX_TOKENS_DE_SALIDA = 400;

export interface OpcionesDelClasificador {
  tenantId: string;
  /** Identifica la llamada en las trazas: el mensaje de la sala que la provoca. */
  mensajeId: string;
  papel: PapelModelo;
  clasePaso: ClasePaso;
  /** Guion del proveedor de prueba que contesta a este agente de plataforma. */
  modeloDePrueba: string;
}

function comoJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    // Texto que no es JSON: el esquema lo rechaza y el coste ya gastado se anota.
    return texto;
  }
}

async function costeDeLaLlamada(
  contexto: ContextoDeActividades,
  tenantId: string,
  proveedor: string,
  modelo: string,
  plataforma: string | undefined,
  tokens: TokensParaElContador,
  exigirTarifa: boolean,
): Promise<number> {
  const tarifa = await enTenant(contexto, tenantId, (tx) =>
    tarifaVigente(tx, tenantId, proveedor, modelo, new Date(), plataforma),
  );
  if (!tarifa) {
    if (exigirTarifa) throw new Error(`Sin tarifa vigente para ${proveedor}/${modelo}.`);
    return 0;
  }
  return calcularCosteEuros(tarifa, tokens);
}

export function crearClasificadorDeSala(
  contexto: ContextoDeActividades,
  opciones: OpcionesDelClasificador,
): PuertoDeClasificacion {
  return async <T>(peticion: PeticionDeClasificacion<T>): Promise<RespuestaDeClasificacion> => {
    const resuelto = contexto.enrutador.resolverPaso(
      { papel: opciones.papel, modeloDePrueba: opciones.modeloDePrueba },
      { sinRespaldoDeProveedor: true },
    );

    if (resuelto.via === 'modelo') {
      const dado = await darPasoDeModelo({
        modelo: resuelto.modelo,
        sistema: peticion.sistema,
        mensajes: [{ role: 'user', content: peticion.usuario }],
        herramientas: [],
        atributos: {
          tenantId: opciones.tenantId,
          puestoId: 'plataforma',
          versionPuestoId: 'plataforma',
          tareaId: opciones.mensajeId,
          proveedor: resuelto.proveedor,
          modelo: resuelto.modeloId,
        },
        trazas: contexto.trazas,
        nombreTraza: 'sala.clasificacion',
        maxTokensSalida: MAX_TOKENS_DE_SALIDA,
      });
      return {
        salida: comoJson(dado.texto),
        modelo: resuelto.modeloId,
        costeEuros: await costeDeLaLlamada(
          contexto,
          opciones.tenantId,
          resuelto.proveedor,
          resuelto.modeloId,
          undefined,
          dado.tokens,
          false,
        ),
      };
    }

    // Proveedor real: sin tarifa del principal no se llama (un reintento la pagaría otra vez).
    for (const esperada of resuelto.tarifasEsperadas) {
      await costeDeLaLlamada(
        contexto,
        opciones.tenantId,
        esperada.proveedor,
        esperada.modelo,
        esperada.plataforma,
        { entrada: 0, salida: 0, entradaCache: 0 },
        true,
      );
    }
    const { resultado, sirvio } = await resuelto.puerto.completar<T>({
      clasePaso: opciones.clasePaso,
      sistema: peticion.sistema,
      mensajes: [{ rol: 'user', contenido: peticion.usuario }],
      esquemaSalida: peticion.esquema,
      maxTokens: MAX_TOKENS_DE_SALIDA,
      cacheSistema: true,
    });
    if (resultado.tipo === 'rechazo') {
      throw new Error(`El clasificador del proveedor rechazó la petición (${String(resultado.categoria)}).`);
    }
    if (!(PLATAFORMAS_MODELO as readonly string[]).includes(sirvio.plataforma)) {
      throw new Error(`Plataforma de modelo desconocida: ${sirvio.plataforma}.`);
    }
    const tokens: TokensParaElContador = {
      entrada: resultado.tokens.entrada,
      salida: resultado.tokens.salida,
      entradaCache: resultado.tokens.entradaCache ?? 0,
    };
    return {
      salida: resultado.salida ?? comoJson(resultado.texto),
      modelo: sirvio.modeloId,
      costeEuros: await costeDeLaLlamada(
        contexto,
        opciones.tenantId,
        PROVEEDOR_DE_TARIFA,
        modeloDeTarifa(sirvio.papel, sirvio.plataforma as PlataformaModelo),
        sirvio.plataforma,
        tokens,
        true,
      ),
    };
  };
}
