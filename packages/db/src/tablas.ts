/**
 * Registro de tablas del modelo.
 *
 * Las pruebas de esquema, la purga y la exportación recorren este registro en vez de
 * una lista escrita a mano en cada sitio. Si añades una tabla y no la registras aquí,
 * la prueba de esquema falla.
 */
import { getTableName } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

import { leccion, leccionSenal, promocion, senal } from './aprendizaje.js';
import { autorizacionHerramientas, conector } from './conectores.js';
import {
  documentoCanonico,
  entidad,
  fragmentoConocimiento,
  memoria,
  relacion,
} from './conocimiento.js';
import {
  habilidad,
  habilidadVersionPuesto,
  departamento,
  puesto,
  versionPuesto,
} from './equipo.js';
import { eventoSalida, indicador, indicadorValor, notificacion } from './observacion.js';
import { propuestaOperacion } from './operaciones.js';
import {
  migracionAplicada,
  organizacion,
  organizacionParaguas,
  paqueteTareas,
  persona,
} from './organizacion.js';
import { intervencion, mensaje, sala, salaParticipante } from './salas.js';
import { aprobacion, decisionAprobacion, delegacion, disparador, paso, tarea } from './trabajo.js';

/** Tablas con `tenant_id` y política de RLS por tenant. */
export const TABLAS_CON_TENANT = [
  persona,
  paqueteTareas,
  departamento,
  puesto,
  versionPuesto,
  habilidad,
  habilidadVersionPuesto,
  tarea,
  paso,
  delegacion,
  aprobacion,
  decisionAprobacion,
  disparador,
  senal,
  leccion,
  leccionSenal,
  promocion,
  sala,
  salaParticipante,
  mensaje,
  intervencion,
  propuestaOperacion,
  conector,
  autorizacionHerramientas,
  documentoCanonico,
  fragmentoConocimiento,
  memoria,
  entidad,
  relacion,
  indicador,
  indicadorValor,
  notificacion,
  eventoSalida,
] as const satisfies readonly PgTable[];

/** Raíces de tenant: `organizacion.id` es el propio tenant y el paraguas cruza organizaciones. */
export const TABLAS_RAIZ = [
  organizacion,
  organizacionParaguas,
] as const satisfies readonly PgTable[];

/** Tablas de infraestructura sin tenant y sin RLS: el rol de aplicación no las toca. */
export const TABLAS_INFRAESTRUCTURA = [migracionAplicada] as const satisfies readonly PgTable[];

/**
 * Tablas inmutables: se insertan y no se actualizan. Las actualizaciones son inserciones
 * con puntero a la versión activa (ADR-007, «lo que afecta a la auditoría no se actualiza»).
 */
export const NOMBRES_TABLAS_INMUTABLES = [
  'version_puesto',
  'aprobacion',
  'decision_aprobacion',
  'leccion',
  'promocion',
  'paso',
  'senal',
  'mensaje',
  'entrada_auditoria',
] as const;

/** Tablas particionadas por mes. Su clave primaria incluye `creado_en`. */
export const NOMBRES_TABLAS_PARTICIONADAS = ['entrada_auditoria', 'mensaje', 'senal'] as const;

/**
 * Tablas del libro de auditoría y del contador. El esquema tipado vive en `@aiw/ledger`,
 * pero su DDL entra en la misma migración inicial porque es una sola base de datos.
 */
export const NOMBRES_TABLAS_LIBRO = ['entrada_auditoria', 'contador_consumo'] as const;

export const NOMBRES_TABLAS_CON_TENANT: readonly string[] = TABLAS_CON_TENANT.map((t) =>
  getTableName(t),
);

export const NOMBRES_TABLAS_RAIZ: readonly string[] = TABLAS_RAIZ.map((t) => getTableName(t));

/** Todas las tablas que crea la migración inicial, incluidas las del libro. */
export const NOMBRES_TABLAS: readonly string[] = [
  ...NOMBRES_TABLAS_RAIZ,
  ...NOMBRES_TABLAS_CON_TENANT,
  ...NOMBRES_TABLAS_LIBRO,
  ...TABLAS_INFRAESTRUCTURA.map((t) => getTableName(t)),
];

/**
 * Orden de purga: de la hoja a la raíz. Con borrado restringido en todas las claves
 * foráneas, purgar en otro orden falla, que es justo lo que se quiere.
 */
export const ORDEN_PURGA: readonly string[] = [
  'evento_salida',
  'notificacion',
  'indicador_valor',
  'indicador',
  'relacion',
  'entidad',
  'memoria',
  'fragmento_conocimiento',
  'documento_canonico',
  'autorizacion_herramientas',
  'conector',
  'propuesta_operacion',
  'intervencion',
  'mensaje',
  'sala_participante',
  'sala',
  'promocion',
  'leccion_senal',
  'leccion',
  'senal',
  'disparador',
  'decision_aprobacion',
  'aprobacion',
  'delegacion',
  'paso',
  'tarea',
  'habilidad_version_puesto',
  'habilidad',
  'version_puesto',
  'puesto',
  'departamento',
  'paquete_tareas',
  'persona',
  'contador_consumo',
  'organizacion',
];
