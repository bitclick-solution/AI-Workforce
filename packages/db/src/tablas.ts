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
import { claveAcceso, cuenta, sesion, usuario, verificacion } from './identidad.js';
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

/**
 * Tablas de identidad del panel (rebanada «Acceso al panel»). Las lee el rol
 * `aiw_identidad` y no el de aplicación, porque el acceso ocurre antes de saber el
 * tenant. Van aparte de `TABLAS_CON_TENANT` a propósito: no se exportan con los datos
 * del cliente —llevan tokens de sesión— y solo `usuario` y `sesion` tienen
 * `tenant_id`; el resto cuelga de `usuario`.
 */
export const TABLAS_IDENTIDAD = [
  usuario,
  sesion,
  cuenta,
  verificacion,
  claveAcceso,
] as const satisfies readonly PgTable[];

export const NOMBRES_TABLAS_IDENTIDAD: readonly string[] = TABLAS_IDENTIDAD.map((t) =>
  getTableName(t),
);

/**
 * Orden de purga de la identidad de un tenant, de la hoja a la raíz. Va antes que
 * `ORDEN_PURGA` porque `usuario` y `sesion` referencian `persona` y `organizacion`.
 * `verificacion` no tiene tenant: caduca en minutos y no se purga por organización.
 */
export const ORDEN_PURGA_IDENTIDAD: readonly { tabla: string; porUsuario: boolean }[] = [
  { tabla: 'clave_acceso', porUsuario: true },
  { tabla: 'cuenta', porUsuario: true },
  { tabla: 'sesion', porUsuario: false },
  { tabla: 'usuario', porUsuario: false },
];

/** Tablas de infraestructura sin tenant y sin RLS: el rol de aplicación no las toca. */
export const TABLAS_INFRAESTRUCTURA = [migracionAplicada] as const satisfies readonly PgTable[];

/**
 * Tablas inmutables: se insertan y no se actualizan. Las actualizaciones son inserciones
 * con puntero a la versión activa (ADR-007, «lo que afecta a la auditoría no se actualiza»).
 *
 * Esta lista no es documentación: la migración inicial la recorre para poner un
 * disparador que rechaza cualquier `UPDATE`, incluso del dueño del esquema, y para
 * retirarle `UPDATE` y `DELETE` al rol de aplicación. Si añades una tabla aquí y no
 * allí, la prueba de esquema falla; si la añades allí y no aquí, también.
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

/**
 * El libro va aparte: ni se actualiza ni se borra nunca, y su disparador se crea con
 * la tabla. El resto de inmutables sí se borran al purgar un tenant, que es una
 * operación de plataforma, así que solo se les prohíbe el `UPDATE` a todo el mundo.
 */
export const NOMBRES_TABLAS_INMUTABLES_CON_DISPARADOR_PROPIO = ['entrada_auditoria'] as const;

/** Las inmutables cuyo disparador pone el bucle de la migración. */
export const NOMBRES_TABLAS_INMUTABLES_EN_BUCLE: readonly string[] =
  NOMBRES_TABLAS_INMUTABLES.filter(
    (nombre) => !NOMBRES_TABLAS_INMUTABLES_CON_DISPARADOR_PROPIO.includes(nombre as never),
  );

/** Tablas particionadas por mes. Su clave primaria incluye `creado_en`. */
export const NOMBRES_TABLAS_PARTICIONADAS = ['entrada_auditoria', 'mensaje', 'senal'] as const;

/**
 * Tablas del libro de auditoría y del contador. El esquema tipado vive en `@aiw/ledger`,
 * pero su DDL entra en la misma migración inicial porque es una sola base de datos.
 */
export const NOMBRES_TABLAS_LIBRO = ['entrada_auditoria', 'contador_consumo'] as const;

/**
 * Tablas del contador de tareas v0: los usos reales de modelo y las tarifas
 * versionadas que les ponen precio. Su esquema tipado vive en `@aiw/ledger`, igual
 * que el del libro, y su DDL en la migración `0001_contador_uso_de_modelos`.
 *
 * Van aparte de `NOMBRES_TABLAS_LIBRO` porque no las crea la migración inicial:
 * quien compruebe que existen tiene que mirar todas las migraciones, no solo la
 * primera.
 */
export const NOMBRES_TABLAS_CONTADOR = ['tarifa_modelo', 'uso_modelo'] as const;

/**
 * Las dos son inmutables: un consumo registrado y un precio aplicado no se editan,
 * se corrigen con una fila nueva. La migración `0001` les pone su propio disparador
 * y les retira `UPDATE` y `DELETE` al rol de aplicación, sin tocar el bucle de la
 * migración inicial.
 */
export const NOMBRES_TABLAS_CONTADOR_INMUTABLES = ['tarifa_modelo', 'uso_modelo'] as const;

/**
 * Tablas del aprendizaje que crea una migración posterior a la inicial: las versiones
 * que deja una promoción de departamento (`0011_promocion_version`). Es inmutable;
 * la migración le pone su propio disparador y le da solo `select` e `insert` al rol
 * de aplicación. Va aparte de `NOMBRES_TABLAS_INMUTABLES` porque no la crea el bucle
 * de la migración inicial.
 */
export const NOMBRES_TABLAS_PROMOCION = ['promocion_version'] as const;

export const NOMBRES_TABLAS_CON_TENANT: readonly string[] = TABLAS_CON_TENANT.map((t) =>
  getTableName(t),
);

export const NOMBRES_TABLAS_RAIZ: readonly string[] = TABLAS_RAIZ.map((t) => getTableName(t));

/** Todas las tablas del modelo, las cree la migración inicial o una posterior. */
export const NOMBRES_TABLAS: readonly string[] = [
  ...NOMBRES_TABLAS_RAIZ,
  ...NOMBRES_TABLAS_CON_TENANT,
  ...NOMBRES_TABLAS_LIBRO,
  ...NOMBRES_TABLAS_CONTADOR,
  ...NOMBRES_TABLAS_PROMOCION,
  ...NOMBRES_TABLAS_IDENTIDAD,
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
  // El uso de modelo referencia la sala (uso de plataforma), y tarea, paso y tarifa (uso de puesto): se vacía antes que todas.
  'uso_modelo',
  'intervencion',
  'mensaje',
  'sala_participante',
  'sala',
  // Las versiones de una promoción la referencian: se vacía antes.
  'promocion_version',
  'promocion',
  'leccion_senal',
  'leccion',
  'senal',
  'disparador',
  'decision_aprobacion',
  'aprobacion',
  'delegacion',
  'tarifa_modelo',
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
