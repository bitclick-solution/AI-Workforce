/**
 * Guiones del moderador y del Director de IA para el proveedor de prueba.
 *
 * Con `AIW_PROVEEDOR_MODELOS=prueba` (CI, evals de humo, demo local) el paso de
 * modelo de la sala de un departamento no llama a nadie: contesta un guion fijo, que
 * lee el mismo JSON que leería un modelo de verdad y devuelve el mismo esquema. Es
 * una tabla de paráfrasis conocidas, no comprensión: sirve para probar el camino
 * entero —prompt, esquema estricto, coste, libro— de forma reproducible y gratis.
 *
 * Los dos solo eligen identificadores de la lista que reciben, igual que el prompt
 * les exige; lo que no reconocen lo contestan con el silencio o «ninguno».
 */
import type { LanguageModelV4Prompt } from '@ai-sdk/provider';

import { darPasoDeModelo } from '../paso.js';
import { crearProveedorDePrueba, type Guion } from '../proveedor-prueba.js';
import { encargoDe } from './lectura.js';

export const MODELO_PRUEBA_MODERADOR = 'deterministico-moderador';
export const MODELO_PRUEBA_DIRECTOR = 'deterministico-director';

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

type Entrada = Partial<
  Record<'mensaje' | 'puestos' | 'frase' | 'plantillas' | 'departamentos', unknown>
>;

function leerJson(prompt: LanguageModelV4Prompt): Entrada {
  try {
    const leido: unknown = JSON.parse(encargoDe(prompt));
    return typeof leido === 'object' && leido !== null ? (leido as Entrada) : {};
  } catch {
    return {};
  }
}

type Elemento = Partial<
  Record<'puestoId' | 'nombre' | 'temas' | 'plantillaId' | 'departamentoId', unknown>
>;

function lista(valor: unknown): Elemento[] {
  return Array.isArray(valor) ? (valor as Elemento[]) : [];
}

/** Petición de dar de alta un puesto con otras palabras que las fijas del moderador. */
const PIDE_ALTA =
  /necesitamos que alguien|nos hace falta alguien|hace falta alguien|queremos que alguien|incorporar un|sumar un agente/;

/** Paráfrasis conocidas: patrón del mensaje → trozo del nombre o de los temas del puesto. */
const PISTAS_DE_PUESTO: readonly { patron: RegExp; puesto: RegExp }[] = [
  {
    patron: /nos deb(e|en)|no (nos )?(han|ha) pagado|sin pagar|impagad|quien no ha pagado/,
    puesto: /cobr|moros|vencid/,
  },
  {
    patron: /movimientos? del banco|cuadrar|casar (los )?pagos|pase de banco/,
    puesto: /concili|banc|extracto/,
  },
];

/** Moderador: elige entre los `puestoId` recibidos o marca que es una petición de organización. */
export const guionModerador: Guion = ({ prompt }) => {
  const entrada = leerJson(prompt);
  const mensaje = normalizar(typeof entrada.mensaje === 'string' ? entrada.mensaje : '');
  const puestos = lista(entrada.puestos);

  const respuesta = (puestoIds: string[], pideOperacion: boolean, motivo: string) => ({
    texto: JSON.stringify({ puestoIds, pideOperacion, motivo }),
    tokens: { entrada: 1000, salida: 100 },
  });

  if (PIDE_ALTA.test(mensaje)) {
    return respuesta(
      [],
      true,
      'La persona pide incorporar un puesto: es una operación de organización.',
    );
  }
  for (const { patron, puesto } of PISTAS_DE_PUESTO) {
    if (!patron.test(mensaje)) continue;
    const elegido = puestos.find((p) =>
      puesto.test(normalizar(`${String(p.nombre)} ${JSON.stringify(p.temas)}`)),
    );
    if (elegido !== undefined && typeof elegido.puestoId === 'string') {
      return respuesta(
        [elegido.puestoId],
        false,
        `El mensaje toca el trabajo de ${String(elegido.nombre)}.`,
      );
    }
  }
  return respuesta([], false, 'Ningún puesto de la sala cubre lo que pide el mensaje.');
};

/** Paráfrasis conocidas de una contratación: patrón de la frase → trozo del id o nombre de la plantilla. */
const PISTAS_DE_PLANTILLA: readonly { patron: RegExp; plantilla: RegExp }[] = [
  { patron: /movimientos? del banco|cuadre|cuadrar|casar (los )?pagos/, plantilla: /concili/ },
  { patron: /nos deb(e|en)|no han pagado|sin pagar|impagad|persiga/, plantilla: /cobros/ },
];

/** Director: elige una plantilla y un departamento de las listas recibidas, o «ninguno». */
export const guionDirector: Guion = ({ prompt }) => {
  const entrada = leerJson(prompt);
  const frase = normalizar(typeof entrada.frase === 'string' ? entrada.frase : '');
  const plantillas = lista(entrada.plantillas);
  const departamentos = lista(entrada.departamentos);

  const respuesta = (plantillaId: string, departamentoId: string | null, motivo: string) => ({
    texto: JSON.stringify({ plantillaId, departamentoId, motivo }),
    tokens: { entrada: 2000, salida: 100 },
  });

  for (const { patron, plantilla } of PISTAS_DE_PLANTILLA) {
    if (!patron.test(frase)) continue;
    const elegida = plantillas.find((p) => plantilla.test(normalizar(String(p.plantillaId))));
    if (elegida === undefined || typeof elegida.plantillaId !== 'string') continue;
    const nombrado = departamentos.find((d) => frase.includes(normalizar(String(d.nombre))));
    return respuesta(
      elegida.plantillaId,
      typeof nombrado?.departamentoId === 'string' ? nombrado.departamentoId : null,
      `La frase pide el trabajo de ${String(elegida.nombre)}.`,
    );
  }
  return respuesta('ninguno', null, 'Ninguna plantilla del catálogo hace lo que pide la frase.');
};

/**
 * Puerto de clasificación sobre el proveedor de prueba, sin base de datos ni tarifa:
 * lo que usan los evals de humo del moderador y del Director. Tiene la forma que el
 * trabajador instala para la sala (`PuertoDeClasificacion` de `@aiw/rooms`), que este
 * paquete no importa: se cumple por estructura. El coste es cero, como en la demo.
 */
export function clasificadorDePrueba(modeloId: string, guion: Guion) {
  const modelo = crearProveedorDePrueba({ guion, modeloId });
  return async (peticion: { sistema: string; usuario: string }) => {
    const dado = await darPasoDeModelo({
      modelo,
      sistema: peticion.sistema,
      mensajes: [{ role: 'user', content: peticion.usuario }],
      herramientas: [],
      atributos: {
        tenantId: 'evals',
        puestoId: 'plataforma',
        versionPuestoId: 'plataforma',
        tareaId: 'evals',
        proveedor: 'prueba',
        modelo: modeloId,
      },
    });
    let salida: unknown = dado.texto;
    try {
      salida = JSON.parse(dado.texto);
    } catch {
      // Texto que no es JSON: el esquema lo rechaza.
    }
    return { salida, costeEuros: 0, modelo: modeloId };
  };
}
