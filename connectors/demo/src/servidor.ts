/**
 * Servidor MCP de demostración: las dos herramientas de cobros sobre datos falsos.
 *
 * Es un servidor MCP de verdad, no un doble: habla el protocolo con el SDK oficial
 * y el gateway lo consume con un cliente MCP normal. Eso es deliberado. La prueba
 * técnica tiene que decir si MCP sostiene la frontera de herramientas, y un doble
 * de pruebas que devuelve objetos en memoria no responde a esa pregunta.
 *
 * Cumple el mismo contrato que «Conector Odoo v0», que se construye en paralelo
 * sobre la instancia real: los nombres, los esquemas de entrada, la forma de la
 * salida y los motivos de error son los que están escritos en el README. Cambiar
 * uno aquí sin cambiarlo allí rompe la promesa de que el plano de control es
 * agnóstico del ERP (ADR-001), que es justo lo que se está demostrando.
 *
 * Tres cosas más que este servidor hace a propósito:
 *
 * 1. Clasifica sus herramientas con `annotations.readOnlyHint`, que es lo que lee
 *    el gateway para saber si un paso es lectura o escritura. La clasificación la
 *    declara el servidor y la aplica la plataforma; el modelo no vota.
 * 2. Exige la credencial al construirse, no en los argumentos de cada llamada. Al
 *    servirse por entrada estándar, la credencial llega como variable de entorno
 *    que el gateway inyecta al lanzar el proceso, así que no hay ninguna ruta por
 *    la que pueda acabar en un mensaje al modelo.
 * 3. Falla las primeras llamadas si se lo pides, con motivo `temporal`. Sin un
 *    fallo inyectable y reintentable no hay forma de probar que la actividad
 *    reintenta con espera creciente.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  CUENTAS_CONTRAPARTIDA_DEMO,
  EntradaLeerExtractoBancario,
  EntradaProponerAsientoDiferencia,
  buscarApunte,
  buscarDocumento,
  extractoDemo,
  type AsientoGuardado,
} from './conciliacion.js';
import { HOY_DEMO, buscarFactura, facturasVencidas } from './datos.js';
import { errorDeHerramienta } from './errores.js';

export const NOMBRE_CONECTOR_DEMO = 'demo-cobros';

/** Nombre de la variable de entorno donde vive el secreto del conector. */
export const VARIABLE_SECRETO_DEMO = 'DEMO_CONECTOR_SECRETO';

/** Referencia del secreto tal como se guarda en `conector.referencia_secreto`. */
export const REFERENCIA_SECRETO_DEMO = `env:${VARIABLE_SECRETO_DEMO}`;

export const HERRAMIENTA_LISTAR = 'listar_facturas_vencidas';
export const HERRAMIENTA_NOTA = 'crear_nota_seguimiento';
export const HERRAMIENTA_EXTRACTO = 'leer_extracto_bancario';
export const HERRAMIENTA_ASIENTO = 'proponer_asiento_diferencia';

/** Tipos de anotación que acepta el contrato. */
export const TIPOS_DE_NOTA = ['nota', 'actividad'] as const;

export type TipoDeNota = (typeof TIPOS_DE_NOTA)[number];

/** Límites del contrato, en un solo sitio porque los dos conectores los comparten. */
export const LIMITES = {
  limiteMinimo: 1,
  limiteMaximo: 200,
  limitePorDefecto: 50,
  diasVencidaMinimoPorDefecto: 1,
  textoMinimo: 1,
  textoMaximo: 2000,
} as const;

/** Fecha en `YYYY-MM-DD`. El contrato no admite horas en estos campos. */
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Los rangos van en la descripción y se comprueban en el manejador, no en el
 * esquema.
 *
 * Con el rango en el esquema, el SDK rechaza la llamada él mismo y devuelve un
 * error del protocolo (-32602) que no lleva `datos.motivo`. El contrato dice que
 * los cuatro motivos son la única forma de fallar, y un error que no lo trae obliga
 * a la plataforma a adivinar si conviene reintentar. Así que el tipo lo valida el
 * esquema —eso sí lo entiende el modelo— y el rango lo valida el conector, que es
 * quien puede contestar en el formato acordado.
 */
const entradaListar = {
  dias_vencida_minimo: z
    .number()
    .int()
    .optional()
    .describe('Mínimo de días vencida, entero mayor o igual que 0. Por defecto 1.'),
  limite: z
    .number()
    .int()
    .optional()
    .describe(
      `Cuántas facturas devolver como máximo, entre ${LIMITES.limiteMinimo} y ` +
        `${LIMITES.limiteMaximo}. Por defecto ${LIMITES.limitePorDefecto}.`,
    ),
};

const entradaNota = {
  factura_id: z.string().min(1).describe('Identificador de la factura, por ejemplo inv-0001.'),
  texto: z
    .string()
    .describe(
      `Texto de la nota, entre ${LIMITES.textoMinimo} y ${LIMITES.textoMaximo} ` +
        'caracteres, sin HTML, en el tono de la organización.',
    ),
  tipo: z
    .enum(TIPOS_DE_NOTA)
    .optional()
    .describe('«nota» solo registra; «actividad» crea una tarea con fecha límite.'),
  fecha_limite: z
    .string()
    .optional()
    .describe('Fecha límite de la actividad en YYYY-MM-DD. Solo válida con tipo «actividad».'),
  clave_idempotencia: z
    .string()
    .min(1)
    .optional()
    .describe('Con la misma clave se devuelve la misma nota sin crear otra.'),
};

/**
 * Las entradas de conciliación se declaran con el tipo y sin obligatoriedad ni
 * rango, por la misma razón que las de cobros: un argumento que falta o que se
 * sale de rango tiene que salir como `invalido` con `datos.motivo`, y no como un
 * error del protocolo. Quien valida es el esquema Zod del contrato
 * (`conciliacion.ts`); aquí solo se anuncia lo que acepta cada herramienta.
 */
const entradaExtracto = {
  cuenta_id: z.string().optional().describe('Identificador de la cuenta bancaria.'),
  desde: z.string().optional().describe('Fecha de inicio, inclusiva, en YYYY-MM-DD.'),
  hasta: z
    .string()
    .optional()
    .describe('Fecha de fin, inclusiva, en YYYY-MM-DD. No anterior a desde.'),
  solo_sin_casar: z
    .boolean()
    .optional()
    .describe('Por defecto true: solo los apuntes que aún no están casados.'),
  limite: z.number().optional().describe('Máximo de apuntes, entre 1 y 200. Por defecto 50.'),
};

const entradaAsiento = {
  apunte_id: z.string().optional().describe('Obligatorio. Identificador del apunte bancario.'),
  documento_id: z.string().optional().describe('Obligatorio. Factura o documento con el que casa.'),
  importe_diferencia: z
    .number()
    .optional()
    .describe('Obligatorio. Dos decimales, distinto de cero. Positivo: el banco recibió más.'),
  cuenta_contrapartida: z
    .string()
    .optional()
    .describe('Obligatorio. Código de la cuenta contable donde se lleva la diferencia.'),
  motivo: z.string().optional().describe('Obligatorio. De 1 a 500 caracteres, sin HTML.'),
  clave_idempotencia: z
    .string()
    .optional()
    .describe('Con la misma clave se devuelve el mismo borrador sin crear otro.'),
};

export interface OpcionesServidorDemo {
  /**
   * Credencial que trae la conexión. El servidor la compara con la que espera y
   * rechaza construirse si no cuadra: un conector mal configurado falla al
   * arrancar, no a mitad de una tarea.
   */
  credencial: string;
  /** Credencial válida. Sin valor, la del entorno; sin entorno, no se comprueba. */
  credencialEsperada?: string | undefined;
  /** Cuántas llamadas fallan con motivo `temporal` antes de empezar a responder. */
  fallosIniciales?: number | undefined;
  /** Fecha con la que se calculan los vencimientos. Fija para que la CI no cambie. */
  hoy?: string | undefined;
}

/** Nota guardada, tal como la devuelve el contrato. */
export interface NotaGuardada {
  id: string;
  factura_id: string;
  tipo: TipoDeNota;
  creado_en: string;
  texto: string;
  fecha_limite?: string | undefined;
}

export interface ServidorDemo {
  servidor: McpServer;
  /** Asientos en borrador escritos por `proponer_asiento_diferencia`. Nunca contabilizados. */
  readonly asientos: readonly AsientoGuardado[];
  /** Notas escritas por `crear_nota_seguimiento`. Es el efecto que se aprueba. */
  readonly notas: readonly NotaGuardada[];
  /** Cuántas veces se ha llamado a cada herramienta, incluidos los fallos. */
  readonly llamadas: ReadonlyMap<string, number>;
  /**
   * Invalida la credencial con la conexión abierta. Desde ese momento las dos
   * herramientas devuelven `no_autorizado`: es lo que hace un sistema de gestión
   * cuando alguien revoca la clave de API mientras el conector sigue conectado.
   */
  revocarCredencial(): void;
}

export class CredencialDemoNoValida extends Error {
  constructor() {
    // El mensaje no incluye ni la credencial recibida ni la esperada: un error que
    // filtra el secreto es peor que el error que describe.
    super(
      'El conector de demostración rechaza la credencial: revisa ' +
        `${VARIABLE_SECRETO_DEMO} en el entorno del proceso del conector.`,
    );
    this.name = 'CredencialDemoNoValida';
  }
}

/** Quita los argumentos que el SDK entrega como `undefined`: el esquema estricto no los acepta. */
function sinIndefinidos(argumentos: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(argumentos).filter(([, valor]) => valor !== undefined));
}

function detalle(error: { issues: readonly { message: string }[] }): string {
  return error.issues
    .map((problema) => problema.message)
    .join(' ')
    .slice(0, 300);
}

function salidaDeAsiento(asiento: AsientoGuardado) {
  return {
    id: asiento.id,
    apunte_id: asiento.apunte_id,
    estado: asiento.estado,
    creado_en: asiento.creado_en,
  };
}

/** Texto JSON de una respuesta correcta. El contrato devuelve JSON, no prosa. */
function respuesta(carga: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(carga) }] };
}

/**
 * Monta el servidor. No lo conecta: el transporte lo elige quien lo usa —en
 * memoria para las pruebas y el gateway, por entrada y salida estándar o por HTTP
 * para el Compose de desarrollo—.
 */
export function crearServidorDemo(opciones: OpcionesServidorDemo): ServidorDemo {
  const esperada = opciones.credencialEsperada ?? process.env[VARIABLE_SECRETO_DEMO];
  if (esperada !== undefined && esperada !== '' && opciones.credencial !== esperada) {
    throw new CredencialDemoNoValida();
  }

  const hoy = opciones.hoy ?? HOY_DEMO;
  const notas: NotaGuardada[] = [];
  /** Notas por clave de idempotencia. Con la misma clave se devuelve la misma nota. */
  const porClave = new Map<string, NotaGuardada>();
  const asientos: AsientoGuardado[] = [];
  /** Asientos por clave de idempotencia, con la huella de los datos que los crearon. */
  const asientosPorClave = new Map<string, { huella: string; asiento: AsientoGuardado }>();
  const llamadas = new Map<string, number>();
  let fallosPendientes = opciones.fallosIniciales ?? 0;
  let credencialRevocada = false;

  /**
   * Cuenta la llamada y devuelve el error que toque: `no_autorizado` si la
   * credencial se revocó, `temporal` mientras queden fallos inyectados. Nada, si
   * toca responder.
   */
  function fallarSiToca(herramienta: string) {
    llamadas.set(herramienta, (llamadas.get(herramienta) ?? 0) + 1);
    if (credencialRevocada) {
      return errorDeHerramienta(
        'no_autorizado',
        'La credencial del conector ya no vale: la han revocado en el sistema de ' +
          'gestión. Hace falta una nueva; insistir no ayuda.',
      );
    }
    if (fallosPendientes <= 0) return undefined;
    fallosPendientes -= 1;
    return errorDeHerramienta(
      'temporal',
      `El sistema de gestión no responde ahora mismo; vuelve a intentarlo. ` +
        `(fallo inyectado, quedan ${fallosPendientes})`,
    );
  }

  const servidor = new McpServer(
    { name: NOMBRE_CONECTOR_DEMO, version: '0.1.0' },
    {
      instructions:
        'Cartera de cobros de demostración con datos falsos. Mismo contrato de ' +
        'herramientas que el conector de Odoo.',
    },
  );

  servidor.registerTool(
    HERRAMIENTA_LISTAR,
    {
      title: 'Listar facturas vencidas',
      description:
        'Devuelve las facturas de venta cuya fecha de vencimiento ya pasó, de más a ' +
        'menos días vencida, con cliente, importe pendiente y días de retraso. ' +
        'Nunca devuelve facturas que no estén vencidas.',
      inputSchema: entradaListar,
      // Lo que el gateway lee para clasificar el paso como lectura.
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      _meta: { 'aiw.clase': 'lectura' },
    },
    ({ dias_vencida_minimo, limite }) => {
      const fallo = fallarSiToca(HERRAMIENTA_LISTAR);
      if (fallo) return fallo;

      if (dias_vencida_minimo !== undefined && dias_vencida_minimo < 0) {
        return errorDeHerramienta(
          'invalido',
          'dias_vencida_minimo tiene que ser un entero mayor o igual que 0.',
        );
      }
      if (
        limite !== undefined &&
        (limite < LIMITES.limiteMinimo || limite > LIMITES.limiteMaximo)
      ) {
        return errorDeHerramienta(
          'invalido',
          `limite tiene que estar entre ${LIMITES.limiteMinimo} y ${LIMITES.limiteMaximo}.`,
        );
      }

      const facturas = facturasVencidas({
        ...(dias_vencida_minimo === undefined ? {} : { diasVencidaMinimo: dias_vencida_minimo }),
        ...(limite === undefined ? {} : { limite }),
        aFecha: hoy,
      });
      return respuesta({ facturas, total: facturas.length });
    },
  );

  servidor.registerTool(
    HERRAMIENTA_NOTA,
    {
      title: 'Crear nota de seguimiento',
      description:
        'Escribe una nota de seguimiento de cobro en la factura indicada. ' +
        'Modifica el sistema de gestión.',
      inputSchema: entradaNota,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: { 'aiw.clase': 'escritura' },
    },
    ({ factura_id, texto, tipo, fecha_limite, clave_idempotencia }) => {
      const fallo = fallarSiToca(HERRAMIENTA_NOTA);
      if (fallo) return fallo;

      // La idempotencia va por delante de todo lo demás: con la misma clave, la
      // misma nota, incluso si el resto de los argumentos llegan distintos. Es lo
      // que hace seguro reintentar una escritura.
      if (clave_idempotencia !== undefined) {
        const ya = porClave.get(clave_idempotencia);
        if (ya) {
          return respuesta({
            id: ya.id,
            factura_id: ya.factura_id,
            tipo: ya.tipo,
            creado_en: ya.creado_en,
          });
        }
      }

      if (texto.length < LIMITES.textoMinimo || texto.length > LIMITES.textoMaximo) {
        return errorDeHerramienta(
          'invalido',
          `El texto tiene que medir entre ${LIMITES.textoMinimo} y ${LIMITES.textoMaximo} caracteres.`,
        );
      }
      if (fecha_limite !== undefined && !FECHA_ISO.test(fecha_limite)) {
        return errorDeHerramienta('invalido', 'La fecha límite va en formato YYYY-MM-DD.');
      }

      const claseDeNota: TipoDeNota = tipo ?? 'nota';
      if (claseDeNota === 'nota' && fecha_limite !== undefined) {
        return errorDeHerramienta(
          'invalido',
          'La fecha límite solo vale con tipo «actividad»: una nota no vence.',
        );
      }
      if (/<[a-z][\s\S]*>/i.test(texto)) {
        return errorDeHerramienta('invalido', 'El texto de la nota no admite HTML.');
      }

      const factura = buscarFactura(factura_id);
      if (!factura) {
        return errorDeHerramienta('no_encontrada', `No existe la factura ${factura_id}.`);
      }

      const nota: NotaGuardada = {
        id: `nota-${String(notas.length + 1).padStart(4, '0')}`,
        factura_id: factura.id,
        tipo: claseDeNota,
        // Fecha fija derivada del día de la cartera: la CI no puede depender del reloj.
        creado_en: `${hoy}T09:00:00.000Z`,
        texto,
        ...(fecha_limite === undefined ? {} : { fecha_limite }),
      };
      notas.push(nota);
      if (clave_idempotencia !== undefined) porClave.set(clave_idempotencia, nota);

      return respuesta({
        id: nota.id,
        factura_id: nota.factura_id,
        tipo: nota.tipo,
        creado_en: nota.creado_en,
      });
    },
  );

  servidor.registerTool(
    HERRAMIENTA_EXTRACTO,
    {
      title: 'Leer extracto bancario',
      description:
        'Devuelve los apuntes del extracto bancario, del más antiguo al más reciente, ' +
        'por defecto solo los que aún no están casados.',
      inputSchema: entradaExtracto,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      _meta: { 'aiw.clase': 'lectura' },
    },
    (argumentos) => {
      const fallo = fallarSiToca(HERRAMIENTA_EXTRACTO);
      if (fallo) return fallo;
      const entrada = EntradaLeerExtractoBancario.safeParse(sinIndefinidos(argumentos));
      if (!entrada.success) return errorDeHerramienta('invalido', detalle(entrada.error));
      const apuntes = extractoDemo(entrada.data);
      return respuesta({ apuntes, total: apuntes.length });
    },
  );

  servidor.registerTool(
    HERRAMIENTA_ASIENTO,
    {
      title: 'Proponer asiento de diferencia',
      description:
        'Crea el borrador de un asiento por la diferencia entre un apunte bancario y su ' +
        'documento. Nunca lo contabiliza: lo publica una persona en el sistema de gestión.',
      inputSchema: entradaAsiento,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: { 'aiw.clase': 'escritura' },
    },
    (argumentos) => {
      const fallo = fallarSiToca(HERRAMIENTA_ASIENTO);
      if (fallo) return fallo;
      const entrada = EntradaProponerAsientoDiferencia.safeParse(sinIndefinidos(argumentos));
      if (!entrada.success) return errorDeHerramienta('invalido', detalle(entrada.error));
      const datos = entrada.data;
      const huella = JSON.stringify([
        datos.apunte_id,
        datos.documento_id,
        datos.importe_diferencia,
        datos.cuenta_contrapartida,
        datos.motivo,
      ]);

      if (datos.clave_idempotencia !== undefined) {
        const ya = asientosPorClave.get(datos.clave_idempotencia);
        if (ya) {
          if (ya.huella !== huella) {
            return errorDeHerramienta(
              'invalido',
              `La clave de idempotencia «${datos.clave_idempotencia}» ya se usó para otro asiento.`,
            );
          }
          return respuesta(salidaDeAsiento(ya.asiento));
        }
      }

      if (!buscarApunte(datos.apunte_id)) {
        return errorDeHerramienta('no_encontrada', `No existe el apunte ${datos.apunte_id}.`);
      }
      if (!buscarDocumento(datos.documento_id)) {
        return errorDeHerramienta('no_encontrada', `No existe el documento ${datos.documento_id}.`);
      }
      if (!CUENTAS_CONTRAPARTIDA_DEMO.includes(datos.cuenta_contrapartida)) {
        return errorDeHerramienta(
          'no_encontrada',
          `No existe la cuenta ${datos.cuenta_contrapartida}.`,
        );
      }

      const asiento: AsientoGuardado = {
        id: `asi-${String(asientos.length + 1).padStart(4, '0')}`,
        apunte_id: datos.apunte_id,
        documento_id: datos.documento_id,
        importe_diferencia: datos.importe_diferencia,
        cuenta_contrapartida: datos.cuenta_contrapartida,
        motivo: datos.motivo,
        // Siempre borrador: la demo no tiene ruta que lo contabilice.
        estado: 'borrador',
        creado_en: `${hoy}T09:00:00.000Z`,
      };
      asientos.push(asiento);
      if (datos.clave_idempotencia !== undefined) {
        asientosPorClave.set(datos.clave_idempotencia, { huella, asiento });
      }
      return respuesta(salidaDeAsiento(asiento));
    },
  );

  return {
    servidor,
    asientos,
    notas,
    llamadas,
    revocarCredencial() {
      credencialRevocada = true;
    },
  };
}
