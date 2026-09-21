/**
 * Gateway MCP: la única puerta por la que un agente toca un sistema de fuera.
 *
 * Zona crítica. Cuatro cosas pasan aquí y en ningún otro sitio:
 *
 * 1. **Lista blanca.** El catálogo que ve el modelo son las herramientas que la
 *    autorización del puesto nombra, y nada más. Una llamada a algo que no está en
 *    la lista se rechaza y queda anotada como `rechazado`. El modelo no puede pedir
 *    lo que no ve, pero un modelo puede inventarse un nombre, y entonces el que
 *    dice no es esta capa y no un mensaje del sistema.
 * 2. **Política, otra vez.** El bucle ya decidió antes de llamar. El gateway vuelve
 *    a decidir con la política congelada de la versión de puesto y el estado actual
 *    del puesto, y solo deja pasar lo que sale `ejecutar` o lo que trae una
 *    aprobación. Es la misma puerta con dos cerraduras: el bucle es código que
 *    cambia cada semana y esta capa es la que no puede equivocarse.
 * 3. **Credenciales.** Se resuelven por `conector.referencia_secreto`, se meten en
 *    el transporte y no vuelven a salir. No hay parámetro, retorno ni traza de este
 *    módulo por el que el valor de un secreto pueda llegar al modelo.
 * 4. **Auditoría.** Cada llamada, cada rechazo y cada descubrimiento pasan por
 *    `anotar`, que encadena el hash y suma al contador en la misma transacción.
 */
import { conTenant } from '@aiw/db';
import {
  decidirPaso,
  type Nivel,
  type PresupuestoTarea,
  type TipoClaseAccion,
  type VeredictoPolitica,
} from '@aiw/domain';
import { anotar, type EntradaAnotada } from '@aiw/ledger';
import type postgres from 'postgres';

import {
  leerAutorizaciones,
  leerContextoDelPuesto,
  nivelesEfectivos,
  type AutorizacionDePuesto,
} from './autorizaciones.js';
import type { ConexionMcp, HerramientaDescubierta } from './herramientas.js';
import type { RegistroDeServidores } from './registro.js';
import type { ResolvedorDeSecretos } from './secretos.js';

/**
 * Acciones del libro que escribe este módulo, en un solo sitio.
 *
 * Una entrada de auditoría se consulta filtrando por este texto dentro de seis
 * años: se añaden valores, no se renombran.
 */
export const ACCIONES = {
  descubiertas: 'conector.herramientas_descubiertas',
  llamada: 'herramienta.llamada',
  rechazada: 'herramienta.rechazada',
  simulada: 'herramienta.simulada',
} as const;

export interface OpcionesGateway {
  cliente: postgres.Sql;
  registro: RegistroDeServidores;
  secretos: ResolvedorDeSecretos;
}

/** Quién llama, con qué versión y para qué tarea. Todo va a la entrada del libro. */
export interface ContextoDeLlamada {
  tenantId: string;
  puestoId: string;
  versionPuestoId: string;
  tareaId: string;
  pasoId?: string | null | undefined;
}

export interface CatalogoDePuesto {
  /** Lo que el modelo puede ver. Ya filtrado por la lista blanca. */
  herramientas: readonly HerramientaDescubierta[];
  /** Nivel efectivo por clase de acción: autorización con el techo de la política. */
  nivelesPorClase: Readonly<Record<string, Nivel>>;
  /** Estado del puesto leído ahora. El bucle lo necesita para decidir. */
  estadoPuesto: string;
  /** Nombres que la autorización lista pero el conector no sirve. Se avisa, no se falla. */
  noServidas: readonly string[];
}

export class HerramientaNoAutorizada extends Error {
  readonly herramienta: string;
  constructor(herramienta: string, permitidas: readonly string[]) {
    super(
      `La herramienta «${herramienta}» no está en la lista blanca de este puesto. ` +
        `Permitidas: ${permitidas.length === 0 ? 'ninguna' : permitidas.join(', ')}.`,
    );
    this.name = 'HerramientaNoAutorizada';
    this.herramienta = herramienta;
  }
}

export class PasoNoPermitido extends Error {
  readonly veredicto: VeredictoPolitica;
  constructor(herramienta: string, veredicto: VeredictoPolitica) {
    super(`La política no deja ejecutar «${herramienta}»: ${veredicto.motivo}`);
    this.name = 'PasoNoPermitido';
    this.veredicto = veredicto;
  }
}

export class HerramientaFallo extends Error {
  constructor(herramienta: string, detalle: string) {
    super(`La herramienta «${herramienta}» falló: ${detalle}`);
    this.name = 'HerramientaFallo';
  }
}

export interface PeticionDeLlamada {
  herramienta: string;
  argumentos: Record<string, unknown>;
  /** Presupuesto de la tarea. El gateway no gasta, pero no abre puerta sin dinero. */
  presupuesto: PresupuestoTarea;
  /**
   * Aprobación ya decidida que desbloquea un paso supervisado. Sin ella, un paso
   * que la política manda aprobar no pasa por aquí.
   */
  aprobacionId?: string | null | undefined;
  /** Coste estimado del paso, si se conoce. Entra en la comprobación de presupuesto. */
  costeEstimadoEuros?: number | undefined;
}

export interface LlamadaRegistrada {
  herramienta: string;
  conector: string;
  tipo: TipoClaseAccion;
  claseAccion: string;
  nivelAplicado: Nivel | null;
  texto: string;
  estructurado?: unknown;
  duracionMs: number;
  entrada: EntradaAnotada;
}

interface ConexionAbierta {
  conexion: ConexionMcp;
  herramientas: readonly HerramientaDescubierta[];
  autorizacion: AutorizacionDePuesto;
}

/**
 * Abre conexiones, descubre, filtra, decide, llama y anota.
 *
 * Una instancia por proceso de trabajador. Guarda las conexiones abiertas por
 * conector para no reabrir un proceso hijo en cada paso del bucle, y las cierra
 * todas con `cerrar()`. Las conexiones se cachean por tenant y conector: dos
 * tenants nunca comparten conexión, porque compartirla sería compartir credencial.
 */
export class Gateway {
  readonly #cliente: postgres.Sql;
  readonly #registro: RegistroDeServidores;
  readonly #secretos: ResolvedorDeSecretos;
  readonly #abiertas = new Map<string, ConexionAbierta>();

  constructor(opciones: OpcionesGateway) {
    this.#cliente = opciones.cliente;
    this.#registro = opciones.registro;
    this.#secretos = opciones.secretos;
  }

  /**
   * Catálogo del puesto: lo único que el bucle puede poner delante del modelo.
   *
   * Anota el descubrimiento la primera vez que abre cada conector y no en cada
   * paso: el libro registra hechos, y volver a leer una lista que no ha cambiado no
   * es un hecho que nadie vaya a auditar.
   */
  async herramientasPara(contexto: ContextoDeLlamada): Promise<CatalogoDePuesto> {
    const { autorizaciones, puesto } = await this.#leerPermisos(contexto);

    const herramientas: HerramientaDescubierta[] = [];
    const noServidas: string[] = [];

    for (const autorizacion of autorizaciones) {
      const abierta = await this.#abrir(contexto, autorizacion);
      const servidas = new Map(abierta.herramientas.map((h) => [h.nombre, h]));
      for (const nombre of autorizacion.listaBlanca) {
        const herramienta = servidas.get(nombre);
        if (herramienta) herramientas.push(herramienta);
        else noServidas.push(`${autorizacion.conectorNombre}/${nombre}`);
      }
    }

    return {
      herramientas,
      nivelesPorClase: nivelesEfectivos(autorizaciones, puesto.politica),
      estadoPuesto: puesto.estado,
      noServidas,
    };
  }

  /**
   * Llama a una herramienta. Rechaza y anota antes de tocar nada si no toca.
   *
   * El orden de las comprobaciones importa: primero la lista blanca —porque una
   * llamada a algo que el puesto no tiene autorizado no merece ni que se mire su
   * política— y después la política con el estado del puesto de ahora mismo.
   */
  async llamar(
    contexto: ContextoDeLlamada,
    peticion: PeticionDeLlamada,
  ): Promise<LlamadaRegistrada> {
    const { autorizaciones, puesto } = await this.#leerPermisos(contexto);
    const niveles = nivelesEfectivos(autorizaciones, puesto.politica);

    let encontrada: { herramienta: HerramientaDescubierta; abierta: ConexionAbierta } | undefined;
    const permitidas: string[] = [];

    for (const autorizacion of autorizaciones) {
      const abierta = await this.#abrir(contexto, autorizacion);
      const servidas = new Map(abierta.herramientas.map((h) => [h.nombre, h]));
      for (const nombre of autorizacion.listaBlanca) {
        if (!servidas.has(nombre)) continue;
        permitidas.push(nombre);
        if (nombre === peticion.herramienta) {
          const herramienta = servidas.get(nombre);
          if (herramienta) encontrada = { herramienta, abierta };
        }
      }
    }

    if (!encontrada) {
      await this.#anotarRechazo(contexto, peticion.herramienta, null, 'fuera_de_lista_blanca');
      throw new HerramientaNoAutorizada(peticion.herramienta, permitidas);
    }

    const { herramienta, abierta } = encontrada;
    const veredicto = decidirPaso(
      {
        claseAccion: herramienta.claseAccion,
        tipo: herramienta.tipo,
        ...(peticion.costeEstimadoEuros === undefined
          ? {}
          : { costeEstimadoEuros: peticion.costeEstimadoEuros }),
      },
      {
        estadoPuesto: puesto.estado as Parameters<typeof decidirPaso>[1]['estadoPuesto'],
        politica: { ...puesto.politica, niveles },
        presupuesto: peticion.presupuesto,
      },
    );

    const desbloqueada =
      veredicto.decision === 'pedir_aprobacion' &&
      veredicto.ejecutaTrasAprobacion &&
      typeof peticion.aprobacionId === 'string' &&
      peticion.aprobacionId.length > 0;

    if (veredicto.decision !== 'ejecutar' && !desbloqueada) {
      await this.#anotarRechazo(
        contexto,
        herramienta.nombre,
        veredicto.nivelAplicado,
        veredicto.decision,
        herramienta.conector,
      );
      throw new PasoNoPermitido(herramienta.nombre, veredicto);
    }

    const comienzo = Date.now();
    let resultado;
    try {
      resultado = await abierta.conexion.llamar(herramienta.nombre, peticion.argumentos);
    } catch (error) {
      const duracionMs = Date.now() - comienzo;
      await this.#anotarLlamada(contexto, herramienta, veredicto.nivelAplicado, {
        resultado: 'error',
        duracionMs,
        detalle: error instanceof Error ? error.message : String(error),
        ...(peticion.aprobacionId ? { aprobacionId: peticion.aprobacionId } : {}),
      });
      throw error;
    }
    const duracionMs = Date.now() - comienzo;

    const entrada = await this.#anotarLlamada(contexto, herramienta, veredicto.nivelAplicado, {
      resultado: resultado.esError ? 'error' : 'exito',
      duracionMs,
      ...(resultado.esError ? { detalle: resultado.texto } : {}),
      ...(peticion.aprobacionId ? { aprobacionId: peticion.aprobacionId } : {}),
    });

    // Un fallo del servidor viaja por MCP como resultado con `isError`. Si no se
    // convierte en excepción, la actividad de Temporal lo daría por bueno y no
    // reintentaría nada: el reintento con espera creciente empieza en esta línea.
    if (resultado.esError) throw new HerramientaFallo(herramienta.nombre, resultado.texto);

    return {
      herramienta: herramienta.nombre,
      conector: herramienta.conector,
      tipo: herramienta.tipo,
      claseAccion: herramienta.claseAccion,
      nivelAplicado: veredicto.nivelAplicado,
      texto: resultado.texto,
      ...(resultado.estructurado === undefined ? {} : { estructurado: resultado.estructurado }),
      duracionMs,
      entrada,
    };
  }

  /**
   * Anota una escritura que no se ejecuta porque el puesto está en prueba.
   *
   * El paso existe y se audita: lo que no existe es el efecto. `parcial` es el
   * resultado que el modelo de datos reserva para esto —la acción se intentó y no
   * llegó a completarse—, y el motivo lo dice la propia acción del libro.
   */
  async simular(
    contexto: ContextoDeLlamada,
    herramienta: HerramientaDescubierta,
    nivelAplicado: Nivel | null,
    motivo: string,
  ): Promise<EntradaAnotada> {
    return conTenant(this.#cliente, contexto.tenantId, (tx) =>
      anotar(tx, contexto.tenantId, {
        actorTipo: 'agente',
        puestoId: contexto.puestoId,
        versionPuestoId: contexto.versionPuestoId,
        tareaId: contexto.tareaId,
        pasoId: contexto.pasoId ?? null,
        accion: ACCIONES.simulada,
        herramienta: herramienta.nombre,
        datosReferenciados: [
          { tipo: 'conector', id: herramienta.conector },
          { tipo: 'clase_accion', id: herramienta.claseAccion },
          { tipo: 'motivo', id: motivo },
        ],
        resultado: 'parcial',
        ...(nivelAplicado ? { nivelAplicado } : {}),
      }),
    );
  }

  /** Cierra todas las conexiones abiertas. Lo llama el trabajador al apagarse. */
  async cerrar(): Promise<void> {
    const abiertas = [...this.#abiertas.values()];
    this.#abiertas.clear();
    await Promise.all(
      abiertas.map(async (abierta) => {
        try {
          await abierta.conexion.cerrar();
        } catch {
          // Cerrar una conexión ya caída no es un problema del que informar.
        }
      }),
    );
  }

  async #leerPermisos(contexto: ContextoDeLlamada) {
    return conTenant(this.#cliente, contexto.tenantId, async (tx) => ({
      autorizaciones: await leerAutorizaciones(tx, contexto.tenantId, contexto.puestoId),
      puesto: await leerContextoDelPuesto(
        tx,
        contexto.tenantId,
        contexto.puestoId,
        contexto.versionPuestoId,
      ),
    }));
  }

  async #abrir(
    contexto: ContextoDeLlamada,
    autorizacion: AutorizacionDePuesto,
  ): Promise<ConexionAbierta> {
    const llave = `${contexto.tenantId}/${autorizacion.conectorNombre}`;
    const ya = this.#abiertas.get(llave);
    if (ya) return ya;

    // El secreto se resuelve aquí, se entrega a la fábrica del transporte y no se
    // guarda en ninguna parte de este objeto.
    const secreto =
      autorizacion.referenciaSecreto === null
        ? null
        : await this.#secretos.resolver(autorizacion.referenciaSecreto);

    const conexion = await this.#registro.abrir(autorizacion.conectorNombre, secreto);
    const herramientas = await conexion.listar();
    const abierta: ConexionAbierta = { conexion, herramientas, autorizacion };
    this.#abiertas.set(llave, abierta);

    await conTenant(this.#cliente, contexto.tenantId, (tx) =>
      anotar(tx, contexto.tenantId, {
        actorTipo: 'plataforma',
        puestoId: contexto.puestoId,
        versionPuestoId: contexto.versionPuestoId,
        tareaId: contexto.tareaId,
        accion: ACCIONES.descubiertas,
        herramienta: autorizacion.conectorNombre,
        datosReferenciados: [
          { tipo: 'conector', id: autorizacion.conectorId },
          ...herramientas.map((h) => ({ tipo: 'herramienta', id: h.nombre })),
        ],
        resultado: 'exito',
      }),
    );

    return abierta;
  }

  async #anotarRechazo(
    contexto: ContextoDeLlamada,
    herramienta: string,
    nivelAplicado: Nivel | null,
    motivo: string,
    conector?: string,
  ): Promise<EntradaAnotada> {
    return conTenant(this.#cliente, contexto.tenantId, (tx) =>
      anotar(tx, contexto.tenantId, {
        actorTipo: 'agente',
        puestoId: contexto.puestoId,
        versionPuestoId: contexto.versionPuestoId,
        tareaId: contexto.tareaId,
        pasoId: contexto.pasoId ?? null,
        accion: ACCIONES.rechazada,
        herramienta,
        datosReferenciados: [
          { tipo: 'motivo', id: motivo },
          ...(conector ? [{ tipo: 'conector', id: conector }] : []),
        ],
        resultado: 'rechazado',
        ...(nivelAplicado ? { nivelAplicado } : {}),
      }),
    );
  }

  async #anotarLlamada(
    contexto: ContextoDeLlamada,
    herramienta: HerramientaDescubierta,
    nivelAplicado: Nivel | null,
    detalles: {
      resultado: 'exito' | 'error';
      duracionMs: number;
      detalle?: string | undefined;
      aprobacionId?: string | undefined;
    },
  ): Promise<EntradaAnotada> {
    const referencias = [
      { tipo: 'conector', id: herramienta.conector },
      { tipo: 'clase_accion', id: herramienta.claseAccion },
    ];
    if (detalles.aprobacionId) {
      referencias.push({ tipo: 'aprobacion', id: detalles.aprobacionId });
    }
    if (detalles.detalle) {
      referencias.push({ tipo: 'error', id: recortar(detalles.detalle) });
    }

    return conTenant(this.#cliente, contexto.tenantId, (tx) =>
      anotar(tx, contexto.tenantId, {
        actorTipo: 'agente',
        puestoId: contexto.puestoId,
        versionPuestoId: contexto.versionPuestoId,
        tareaId: contexto.tareaId,
        pasoId: contexto.pasoId ?? null,
        accion: ACCIONES.llamada,
        herramienta: herramienta.nombre,
        datosReferenciados: referencias,
        resultado: detalles.resultado,
        duracionMs: detalles.duracionMs,
        ...(nivelAplicado ? { nivelAplicado } : {}),
      }),
    );
  }
}

/** El libro no es el sitio para volcar la respuesta entera de un servidor. */
function recortar(texto: string, maximo = 200): string {
  return texto.length <= maximo ? texto : `${texto.slice(0, maximo - 1)}…`;
}
