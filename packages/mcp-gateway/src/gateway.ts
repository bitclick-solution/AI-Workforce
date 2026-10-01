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
 *    módulo por el que el valor de un secreto pueda llegar al modelo. Una segunda
 *    credencial, la de confirmación (ADR-031), solo se entrega en una conexión
 *    efímera que abre una escritura ya aprobada y se cierra al terminar.
 * 4. **Auditoría.** Cada llamada, cada rechazo y cada descubrimiento pasan por
 *    `anotar`, que encadena el hash y suma al contador en la misma transacción.
 */
import { conTenant } from '@aiw/db';
import {
  decidirPaso,
  esReintentable,
  leerErrorDeHerramienta,
  type MotivoErrorHerramienta,
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
import type { ConexionMcp, HerramientaDescubierta, ResultadoHerramienta } from './herramientas.js';
import type { RegistroDeServidores } from './registro.js';
import type { ResolvedorDeSecretos, Secreto } from './secretos.js';

/**
 * Acciones del libro que escribe este módulo, en un solo sitio.
 *
 * Una entrada de auditoría se consulta filtrando por este texto dentro de seis
 * años: se añaden valores, no se renombran.
 */
/** Por qué una escritura aprobada no llegó a ejecutarse por falta de la credencial de confirmación. */
export const MOTIVO_SIN_CONFIRMACION = 'confirmacion_sin_credencial';

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

/**
 * Fallo de una herramienta, con el motivo del contrato si lo trae.
 *
 * `reintentable` es lo que el trabajador necesita para decidir si deja que Temporal
 * insista. Sin este dato, un `no_encontrada` se reintentaría cuatro veces con espera
 * creciente para acabar fallando igual, y el cliente esperaría medio minuto para
 * nada.
 */
export class HerramientaFallo extends Error {
  readonly herramienta: string;
  readonly motivo: MotivoErrorHerramienta | undefined;
  readonly reintentable: boolean;
  /** Código del contrato, si el conector lo mandó. Sirve para agrupar en auditoría. */
  readonly codigo: string | undefined;

  constructor(herramienta: string, detalle: string) {
    const error = leerErrorDeHerramienta(detalle);
    super(
      `La herramienta «${herramienta}» falló: ${error ? error.message : detalle}` +
        (error ? ` (${error.code}, motivo ${error.datos.motivo})` : ''),
    );
    this.name = 'HerramientaFallo';
    this.herramienta = herramienta;
    this.motivo = error?.datos.motivo;
    this.reintentable = esReintentable(error?.datos.motivo);
    this.codigo = error?.code;
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
  /**
   * Conexiones abiertas o abriéndose, por tenant y conector. Se guarda la promesa y
   * no el resultado: dos actividades del mismo proceso que piden el mismo conector a
   * la vez esperan a la misma apertura, en vez de abrir dos conexiones y dejar una
   * huérfana con su proceso hijo o su socket.
   */
  readonly #abiertas = new Map<string, Promise<ConexionAbierta>>();

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

    // ADR-031: la credencial de confirmación solo viaja con una escritura cuya
    // aprobación ya está decidida, y nunca por la conexión que sirve las lecturas.
    const conConfirmacion =
      herramienta.tipo === 'escritura' &&
      desbloqueada &&
      this.#registro.referenciaConfirmacion(herramienta.conector) !== undefined;

    const comienzo = Date.now();
    let resultado: ResultadoHerramienta;
    try {
      resultado = conConfirmacion
        ? await this.#llamarConConfirmacion(contexto, herramienta, abierta.autorizacion, peticion)
        : await abierta.conexion.llamar(herramienta.nombre, peticion.argumentos);
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
      ...(conConfirmacion ? { confirmacion: true } : {}),
      ...(conConfirmacion && !resultado.esError ? idDelResultado(resultado) : {}),
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
   * Ejecuta una escritura aprobada por una conexión efímera que lleva, además de la
   * credencial del agente, la de confirmación.
   *
   * Sin la credencial de confirmación resoluble, la escritura no se ejecuta: falla
   * como `no_autorizado` antes de abrir nada, y el conector no llega a crear un
   * borrador. La conexión se cierra siempre, y el valor del secreto no se guarda ni
   * se anota.
   */
  async #llamarConConfirmacion(
    contexto: ContextoDeLlamada,
    herramienta: HerramientaDescubierta,
    autorizacion: AutorizacionDePuesto,
    peticion: PeticionDeLlamada,
  ): Promise<ResultadoHerramienta> {
    const referencia = this.#registro.referenciaConfirmacion(herramienta.conector) ?? '';
    let confirmacion: Secreto | undefined;
    try {
      const resuelto = await this.#secretos.resolver(referencia);
      confirmacion = resuelto.vacio ? undefined : resuelto;
    } catch {
      confirmacion = undefined;
    }
    if (confirmacion === undefined) {
      await this.#anotarRechazo(
        contexto,
        herramienta.nombre,
        null,
        MOTIVO_SIN_CONFIRMACION,
        herramienta.conector,
      );
      throw new HerramientaFallo(
        herramienta.nombre,
        JSON.stringify({
          code: '-32003',
          message:
            'Falta la credencial de confirmación del conector: la escritura aprobada no se ejecuta.',
          datos: { motivo: 'no_autorizado' },
        }),
      );
    }

    const secreto =
      autorizacion.referenciaSecreto === null
        ? null
        : await this.#secretos.resolver(autorizacion.referenciaSecreto);
    const conexion = await this.#registro.abrir(autorizacion.conectorNombre, secreto, confirmacion);
    try {
      return await conexion.llamar(herramienta.nombre, peticion.argumentos);
    } finally {
      await conexion.cerrar().catch(() => undefined);
    }
  }

  /** Cierra todas las conexiones abiertas. Lo llama el trabajador al apagarse. */
  async cerrar(): Promise<void> {
    const abiertas = [...this.#abiertas.values()];
    this.#abiertas.clear();
    await Promise.all(
      abiertas.map(async (pendiente) => {
        try {
          const abierta = await pendiente;
          await abierta.conexion.cerrar();
        } catch {
          // Cerrar una conexión ya caída, o una que no llegó a abrirse, no es un
          // problema del que informar.
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

    // Se apunta la promesa antes de esperar nada: entre resolver el secreto, abrir
    // el conector y listar sus herramientas hay tres esperas, y una segunda llamada
    // que entrara por en medio abriría otra conexión. Si la apertura falla se olvida,
    // para que la siguiente llamada lo vuelva a intentar en vez de heredar el fallo.
    const apertura = this.#abrirYDescubrir(contexto, autorizacion);
    this.#abiertas.set(llave, apertura);
    apertura.catch(() => {
      if (this.#abiertas.get(llave) === apertura) this.#abiertas.delete(llave);
    });
    return apertura;
  }

  async #abrirYDescubrir(
    contexto: ContextoDeLlamada,
    autorizacion: AutorizacionDePuesto,
  ): Promise<ConexionAbierta> {
    // El secreto se resuelve aquí, se entrega a la fábrica del transporte y no se
    // guarda en ninguna parte de este objeto.
    const secreto =
      autorizacion.referenciaSecreto === null
        ? null
        : await this.#secretos.resolver(autorizacion.referenciaSecreto);

    const conexion = await this.#registro.abrir(autorizacion.conectorNombre, secreto);
    try {
      const herramientas = await conexion.listar();
      const abierta: ConexionAbierta = { conexion, herramientas, autorizacion };

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
    } catch (error) {
      // Una conexión que se abrió y no llegó a quedar registrada se cierra: si no,
      // el proceso hijo o el socket sobreviven sin que nadie los tenga.
      await conexion.cerrar().catch(() => undefined);
      throw error;
    }
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
      /** La escritura se ejecutó con la credencial de confirmación entregada. */
      confirmacion?: boolean | undefined;
      /** Identificador de lo creado, tal como lo devuelve el conector (p. ej. el borrador). */
      resultadoId?: string | undefined;
    },
  ): Promise<EntradaAnotada> {
    const referencias = [
      { tipo: 'conector', id: herramienta.conector },
      { tipo: 'clase_accion', id: herramienta.claseAccion },
    ];
    if (detalles.aprobacionId) {
      referencias.push({ tipo: 'aprobacion', id: detalles.aprobacionId });
    }
    // Ni el token ni su referencia: solo el hecho de la confirmación y lo que creó.
    if (detalles.confirmacion) referencias.push({ tipo: 'confirmacion', id: 'gateway' });
    if (detalles.resultadoId) referencias.push({ tipo: 'borrador', id: detalles.resultadoId });
    if (detalles.detalle) {
      const error = leerErrorDeHerramienta(detalles.detalle);
      if (error) {
        // Con el contrato cumplido, la entrada guarda código y motivo por separado:
        // así una consulta de auditoría puede contar cuántos fallos fueron temporales
        // sin leer mensajes a mano.
        referencias.push({ tipo: 'codigo_error', id: error.code });
        referencias.push({ tipo: 'motivo', id: error.datos.motivo });
        referencias.push({ tipo: 'error', id: recortar(error.message) });
      } else {
        referencias.push({ tipo: 'error', id: recortar(detalles.detalle) });
      }
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

/** `id` del resultado estructurado, si el conector lo devuelve como texto. */
function idDelResultado(resultado: ResultadoHerramienta): { resultadoId?: string } {
  const estructurado = resultado.estructurado;
  if (typeof estructurado === 'object' && estructurado !== null) {
    const id = (estructurado as { id?: unknown }).id;
    if (typeof id === 'string' && id.trim() !== '') return { resultadoId: recortar(id, 100) };
  }
  return {};
}

/** El libro no es el sitio para volcar la respuesta entera de un servidor. */
function recortar(texto: string, maximo = 200): string {
  return texto.length <= maximo ? texto : `${texto.slice(0, maximo - 1)}…`;
}
