/**
 * Semilla de una organización completa.
 *
 * Crea una fila en cada tabla del tenant para que las pruebas de aislamiento, de
 * purga y de exportación trabajen sobre un modelo lleno y no sobre un caso feliz
 * con tres tablas. No escribe en el libro de auditoría: eso solo lo hace `@aiw/ledger`.
 */
import type postgres from 'postgres';

import { DIMENSION_EMBEDDING } from '../db/columnas.js';
import { conTenant } from '../db/cliente.js';
import { uuidV7 } from '../db/identificadores.js';

export interface OrganizacionSembrada {
  tenantId: string;
  personaId: string;
  departamentoId: string;
  puestoId: string;
  versionPuestoId: string;
  segundaVersionPuestoId: string;
  tareaId: string;
  tareaHijaId: string;
  pasoId: string;
  aprobacionId: string;
  senalId: string;
  leccionId: string;
  salaId: string;
  mensajeId: string;
  conectorId: string;
  entidadOrigenId: string;
  entidadDestinoId: string;
  indicadorId: string;
}

function vectorDePrueba(semilla: number): string {
  return `[${Array.from({ length: DIMENSION_EMBEDDING }, (_, i) => ((i + semilla) % 10) / 10).join(',')}]`;
}

export async function sembrarOrganizacion(
  cliente: postgres.Sql,
  nombre: string,
): Promise<OrganizacionSembrada> {
  const tenantId = uuidV7();

  return conTenant(cliente, tenantId, async (tx) => {
    await tx`
      insert into organizacion (id, nombre, plan, brand_voice)
      values (${tenantId}, ${nombre}, 'business', '{"tono":"cercano"}'::jsonb)
    `;

    const [persona] = await tx<{ id: string }[]>`
      insert into persona (tenant_id, nombre, correo)
      values (${tenantId}, 'Jesús', ${`jefatura@${nombre}.local`})
      returning id
    `;
    const personaId = exigir(persona?.id, 'persona');

    await tx`
      insert into paquete_tareas (tenant_id, tareas_compradas, caduca_en)
      values (${tenantId}, 1000, now() + interval '1 year')
    `;

    const [departamento] = await tx<{ id: string }[]>`
      insert into departamento (tenant_id, nombre, supervisor_persona_id, estado)
      values (${tenantId}, 'Finanzas', ${personaId}, 'activo')
      returning id
    `;
    const departamentoId = exigir(departamento?.id, 'departamento');

    const [puesto] = await tx<{ id: string }[]>`
      insert into puesto (tenant_id, departamento_id, nombre, clase_riesgo, estado)
      values (${tenantId}, ${departamentoId}, 'Contable', 'medio', 'activo')
      returning id
    `;
    const puestoId = exigir(puesto?.id, 'puesto');

    const [version] = await tx<{ id: string }[]>`
      insert into version_puesto (tenant_id, puesto_id, numero, prompt, politica)
      values (${tenantId}, ${puestoId}, 1, 'Eres el contable.', '{"niveles":{"leer":"n3"}}'::jsonb)
      returning id
    `;
    const versionPuestoId = exigir(version?.id, 'version_puesto');

    const [segundaVersion] = await tx<{ id: string }[]>`
      insert into version_puesto (tenant_id, puesto_id, numero, prompt, politica)
      values (${tenantId}, ${puestoId}, 2, 'Eres el contable, con la lección aplicada.', '{"niveles":{"leer":"n3"}}'::jsonb)
      returning id
    `;
    const segundaVersionPuestoId = exigir(segundaVersion?.id, 'version_puesto 2');

    await tx`update puesto set version_activa_id = ${versionPuestoId} where id = ${puestoId}`;
    await tx`update departamento set supervisor_puesto_id = ${puestoId} where id = ${departamentoId}`;

    const [habilidad] = await tx<{ id: string }[]>`
      insert into habilidad (tenant_id, nombre, version, activa)
      values (${tenantId}, 'Conciliar banco', 1, true)
      returning id
    `;
    const habilidadId = exigir(habilidad?.id, 'habilidad');

    await tx`
      insert into habilidad_version_puesto (tenant_id, habilidad_id, version_puesto_id, version_habilidad_fijada)
      values (${tenantId}, ${habilidadId}, ${versionPuestoId}, 1)
    `;

    const [tarea] = await tx<{ id: string }[]>`
      insert into tarea (tenant_id, puesto_id, version_puesto_id, origen, estado, flujo_temporal_id)
      values (${tenantId}, ${puestoId}, ${versionPuestoId}, 'sala', 'en_curso', 'flujo-1')
      returning id
    `;
    const tareaId = exigir(tarea?.id, 'tarea');
    await tx`update tarea set tarea_raiz_id = ${tareaId} where id = ${tareaId}`;

    const [tareaHija] = await tx<{ id: string }[]>`
      insert into tarea (tenant_id, tarea_raiz_id, tarea_padre_id, puesto_id, version_puesto_id, origen, estado)
      values (${tenantId}, ${tareaId}, ${tareaId}, ${puestoId}, ${versionPuestoId}, 'delegacion', 'pendiente')
      returning id
    `;
    const tareaHijaId = exigir(tareaHija?.id, 'tarea hija');

    const [paso] = await tx<{ id: string }[]>`
      insert into paso (tenant_id, tarea_id, version_puesto_id, numero, tipo, herramienta)
      values (${tenantId}, ${tareaId}, ${versionPuestoId}, 1, 'herramienta', 'odoo.buscar_factura')
      returning id
    `;
    const pasoId = exigir(paso?.id, 'paso');

    await tx`
      insert into delegacion (
        tenant_id, tarea_origen_id, tarea_destino_id, puesto_origen_id, puesto_destino_id,
        encargo, plazo, presupuesto_euros, formato
      ) values (
        ${tenantId}, ${tareaId}, ${tareaHijaId}, ${puestoId}, ${puestoId},
        'Concilia el extracto de marzo', now() + interval '2 days', 0.5,
        '{"formato":"tabla","criteriosAceptacion":[]}'::jsonb
      )
    `;

    const [aprobacion] = await tx<{ id: string }[]>`
      insert into aprobacion (
        tenant_id, tarea_id, paso_id, persona_id, clase_accion, nivel_exigido,
        borrador_opaco, resumen_legible, decision
      ) values (
        ${tenantId}, ${tareaId}, ${pasoId}, ${personaId}, 'pago.emitir', 'n1',
        '{"tipo":"pago","carga":{"opaco":true}}'::jsonb,
        'Pagar 1.200 € a Suministros Pérez', 'pendiente'
      )
      returning id
    `;
    const aprobacionId = exigir(aprobacion?.id, 'aprobacion');

    await tx`
      insert into disparador (tenant_id, tipo, puesto_id, propietario_persona_id, nivel, activo)
      values (${tenantId}, 'programacion', ${puestoId}, ${personaId}, 'n1', true)
    `;

    const [senal] = await tx<{ id: string }[]>`
      insert into senal (tenant_id, puesto_id, tipo, origen, aprobacion_id, tarea_id, contenido)
      values (
        ${tenantId}, ${puestoId}, 'aprobacion', 'panel', ${aprobacionId}, ${tareaId},
        '{"resumen":"La persona editó el importe","detalle":{}}'::jsonb
      )
      returning id
    `;
    const senalId = exigir(senal?.id, 'senal');

    const [leccion] = await tx<{ id: string }[]>`
      insert into leccion (tenant_id, puesto_id, titulo, contenido, parametros, estado)
      values (
        ${tenantId}, ${puestoId}, 'Revisa el importe contra el albarán',
        '{"texto":"Compara siempre con el albarán"}'::jsonb,
        '{"clase":"memoria","destino":"puesto","valor":"albaran"}'::jsonb,
        'promocionada'
      )
      returning id
    `;
    const leccionId = exigir(leccion?.id, 'leccion');

    await tx`
      insert into leccion_senal (tenant_id, leccion_id, senal_id, senal_creado_en)
      values (${tenantId}, ${leccionId}, ${senalId}, (select creado_en from senal where id = ${senalId}))
    `;

    await tx`
      insert into promocion (tenant_id, leccion_id, version_puesto_resultante_id, decidida_por_persona_id, evidencia)
      values (${tenantId}, ${leccionId}, ${segundaVersionPuestoId}, ${personaId}, '{"evals":"pasa"}'::jsonb)
    `;

    const [sala] = await tx<{ id: string }[]>`
      insert into sala (tenant_id, departamento_id, ambito, nombre)
      values (${tenantId}, ${departamentoId}, 'departamento', 'Sala de Finanzas')
      returning id
    `;
    const salaId = exigir(sala?.id, 'sala');

    await tx`
      insert into sala_participante (tenant_id, sala_id, persona_id, rol)
      values (${tenantId}, ${salaId}, ${personaId}, 'humano')
    `;
    await tx`
      insert into sala_participante (tenant_id, sala_id, puesto_id, rol)
      values (${tenantId}, ${salaId}, ${puestoId}, 'agente')
    `;

    const [mensaje] = await tx<{ id: string; creado_en: Date }[]>`
      insert into mensaje (tenant_id, sala_id, autor_persona_id, cuerpo)
      values (${tenantId}, ${salaId}, ${personaId}, '¿Cómo va la conciliación?')
      returning id, creado_en
    `;
    const mensajeId = exigir(mensaje?.id, 'mensaje');

    await tx`
      insert into intervencion (tenant_id, sala_id, mensaje_id, mensaje_creado_en, tarea_id, moderador_puesto_id, motivo)
      values (${tenantId}, ${salaId}, ${mensajeId}, ${mensaje?.creado_en ?? new Date()}, ${tareaId}, ${puestoId}, 'pregunta directa al equipo')
    `;

    await tx`
      insert into propuesta_operacion (tenant_id, tipo, actor_tipo, actor_persona_id, resumen, nivel_exigido, estado)
      values (${tenantId}, 'contratar', 'persona', ${personaId}, 'Contratar un segundo contable', 'n0', 'pendiente')
    `;

    const [conector] = await tx<{ id: string }[]>`
      insert into conector (tenant_id, tipo, nombre, referencia_secreto, estado)
      values (${tenantId}, 'mcp', 'Odoo', 'secreto://odoo/tenant', 'activo')
      returning id
    `;
    const conectorId = exigir(conector?.id, 'conector');

    await tx`
      insert into autorizacion_herramientas (tenant_id, puesto_id, conector_id, lista_blanca, niveles_por_clase, concedida_por_persona_id)
      values (
        ${tenantId}, ${puestoId}, ${conectorId},
        '["odoo.buscar_factura"]'::jsonb, '{"leer":"n3","escribir":"n1"}'::jsonb, ${personaId}
      )
    `;

    await tx`
      insert into documento_canonico (tenant_id, titulo, contenido, propietario_persona_id, ambito)
      values (${tenantId}, 'Manual de facturación', 'Las facturas se revisan a dos ojos.', ${personaId}, 'organizacion')
    `;

    await tx`
      insert into fragmento_conocimiento (tenant_id, ambito, ambito_id, fuente, texto, embedding, frescura)
      values (${tenantId}, 'departamento', ${departamentoId}, 'odoo', 'Factura 2026-001 pendiente', ${vectorDePrueba(1)}::vector, now())
    `;

    await tx`
      insert into memoria (tenant_id, ambito, ambito_id, clave, contenido, embedding, caduca_en)
      values (${tenantId}, 'puesto', ${puestoId}, 'preferencia.albaran', 'Compara con el albarán', ${vectorDePrueba(2)}::vector, now() + interval '90 days')
    `;

    const [entidadOrigen] = await tx<{ id: string }[]>`
      insert into entidad (tenant_id, tipo, nombre, identificadores)
      values (${tenantId}, 'cliente', 'Suministros Pérez', '{"odoo":"res.partner/42"}'::jsonb)
      returning id
    `;
    const entidadOrigenId = exigir(entidadOrigen?.id, 'entidad origen');

    const [entidadDestino] = await tx<{ id: string }[]>`
      insert into entidad (tenant_id, tipo, nombre, identificadores)
      values (${tenantId}, 'producto', 'Tornillo M6', '{"factusol":"ART/7"}'::jsonb)
      returning id
    `;
    const entidadDestinoId = exigir(entidadDestino?.id, 'entidad destino');

    await tx`
      insert into relacion (tenant_id, origen_id, destino_id, tipo)
      values (${tenantId}, ${entidadOrigenId}, ${entidadDestinoId}, 'compra')
    `;

    const [indicador] = await tx<{ id: string }[]>`
      insert into indicador (tenant_id, clave, formula, fuentes, umbrales, ambito)
      values (${tenantId}, 'facturas.conciliadas', 'count(conciliadas)/count(total)', '["odoo"]'::jsonb, '{"aviso":0.8}'::jsonb, 'departamento')
      returning id
    `;
    const indicadorId = exigir(indicador?.id, 'indicador');

    await tx`
      insert into indicador_valor (tenant_id, indicador_id, periodo, valor)
      values (${tenantId}, ${indicadorId}, date_trunc('hour', now()), 0.92)
    `;

    await tx`
      insert into notificacion (tenant_id, destinatario_persona_id, canal, motivo, entidad_tipo, entidad_id, vence_en)
      values (${tenantId}, ${personaId}, 'whatsapp', 'Aprobación pendiente', 'aprobacion', ${aprobacionId}, now() + interval '1 day')
    `;

    await tx`
      insert into evento_salida (tenant_id, tipo, destino, carga)
      values (${tenantId}, 'aprobacion.creada', 'sala', '{"version":1,"datos":{}}'::jsonb)
    `;

    await tx`
      insert into contador_consumo (tenant_id, periodo, tareas, pasos, acciones, coste_euros)
      values (${tenantId}, date_trunc('month', now())::date, 2, 1, 0, 0)
    `;

    return {
      tenantId,
      personaId,
      departamentoId,
      puestoId,
      versionPuestoId,
      segundaVersionPuestoId,
      tareaId,
      tareaHijaId,
      pasoId,
      aprobacionId,
      senalId,
      leccionId,
      salaId,
      mensajeId,
      conectorId,
      entidadOrigenId,
      entidadDestinoId,
      indicadorId,
    };
  });
}

function exigir(valor: string | undefined, que: string): string {
  if (!valor) throw new Error(`La semilla no creó ${que}.`);
  return valor;
}
