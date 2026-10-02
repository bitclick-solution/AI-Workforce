/**
 * Actividad del supervisor de departamento v0: lee la delegación, decide con las
 * reglas de `@aiw/platform-agents` y publica el aviso en la sala del departamento.
 *
 * Es la única parte del supervisor con efectos, y sus efectos son dos: un mensaje en
 * la sala y su entrada en el libro. No llama a ninguna herramienta de un conector, no
 * escribe en ningún sistema externo y no toca el estado de la tarea ni de la
 * delegación (docs/specs/supervisor-de-departamento-finanzas.md, decisión 2). Publica
 * como actor de plataforma, sin puesto ni persona autora, y por eso no suma al
 * contador de tareas de ningún puesto.
 *
 * Una sola vez por delegación: el identificador del mensaje sale de la delegación, y
 * un segundo evento de la misma (el plazo vence y se aplica el respaldo) encuentra el
 * mensaje ya publicado y no escribe nada ni vuelve a anotar en el libro.
 */
import { anotar } from '@aiw/ledger';
import { supervisarDelegacion, type EventoDeDelegacion } from '@aiw/platform-agents';
import type { PoliticaRespaldo } from '@aiw/domain';

import { enTenant, type ContextoDeActividades } from './contexto.js';
import { asegurarSala, insertarMensaje } from './sala.js';

/** Nombre de acción del libro. Dominio y acción en pasado (ADR-014). */
export const ACCIONES_SUPERVISOR = {
  avisoPublicado: 'supervisor.aviso_publicado',
} as const;

export interface PeticionSupervisarDelegacion {
  tenantId: string;
  delegacionId: string;
  tipo: EventoDeDelegacion['tipo'];
  politicaRespaldo?: PoliticaRespaldo | undefined;
  entregado?: boolean | undefined;
}

export type ResultadoDeSupervision =
  | { publicado: true; mensajeId: string; salaId: string; motivo: string; yaEstaba: boolean }
  | {
      publicado: false;
      razon: 'apagado' | 'sin_aviso' | 'otro_departamento' | 'delegacion_desconocida';
    };

export function crearActividadesDeSupervisor(contexto: ContextoDeActividades) {
  return {
    async supervisarDelegacion(
      peticion: PeticionSupervisarDelegacion,
    ): Promise<ResultadoDeSupervision> {
      // Detrás de la bandera hasta la demo: apagado, ni lee ni escribe nada.
      if (!contexto.supervisorDeDepartamento) return { publicado: false, razon: 'apagado' };
      return enTenant(contexto, peticion.tenantId, async (tx) => {
        const [fila] = await tx<
          {
            encargo: string;
            origen_id: string;
            origen_nombre: string;
            destino_id: string;
            destino_nombre: string;
            departamento_id: string;
            departamento_nombre: string;
            mismo_departamento: boolean;
          }[]
        >`
          select d.encargo,
            po.id as origen_id, po.nombre as origen_nombre,
            pd.id as destino_id, pd.nombre as destino_nombre,
            dep.id as departamento_id, dep.nombre as departamento_nombre,
            (po.departamento_id = pd.departamento_id) as mismo_departamento
          from delegacion d
          join puesto po on po.tenant_id = d.tenant_id and po.id = d.puesto_origen_id
          join puesto pd on pd.tenant_id = d.tenant_id and pd.id = d.puesto_destino_id
          join departamento dep on dep.tenant_id = po.tenant_id and dep.id = po.departamento_id
          where d.tenant_id = ${peticion.tenantId} and d.id = ${peticion.delegacionId}
        `;
        if (!fila) return { publicado: false, razon: 'delegacion_desconocida' };
        // v0 supervisa las delegaciones dentro de un departamento; una que cruza de
        // departamento tiene otro dueño y otra sala (fuera de alcance de esta rebanada).
        if (!fila.mismo_departamento) return { publicado: false, razon: 'otro_departamento' };

        const mensaje = supervisarDelegacion({
          tipo: peticion.tipo,
          delegacionId: peticion.delegacionId,
          encargo: fila.encargo,
          origen: { id: fila.origen_id, nombre: fila.origen_nombre },
          destino: { id: fila.destino_id, nombre: fila.destino_nombre },
          politicaRespaldo: peticion.politicaRespaldo,
          entregado: peticion.entregado,
        });
        if (mensaje === null) return { publicado: false, razon: 'sin_aviso' };

        const { salaId } = await asegurarSala(tx, peticion.tenantId, {
          id: fila.departamento_id,
          nombre: fila.departamento_nombre,
        });
        const insertado = await insertarMensaje(contexto, tx, peticion.tenantId, {
          id: mensaje.mensajeId,
          salaId,
          cuerpo: mensaje.texto,
          adjuntos: [{ tipo: 'autor_plataforma', agente: 'supervisor_departamento' }],
        });
        if (!insertado.yaEstaba) {
          await anotar(tx, peticion.tenantId, {
            actorTipo: 'plataforma',
            accion: ACCIONES_SUPERVISOR.avisoPublicado,
            datosReferenciados: [
              { tipo: 'sala', id: salaId },
              { tipo: 'mensaje', id: mensaje.mensajeId },
              { tipo: 'delegacion', id: peticion.delegacionId },
              { tipo: 'motivo_supervision', id: mensaje.motivo },
            ],
            resultado: 'exito',
          });
        }
        return {
          publicado: true,
          mensajeId: mensaje.mensajeId,
          salaId,
          motivo: mensaje.motivo,
          yaEstaba: insertado.yaEstaba,
        };
      });
    },
  };
}
