/**
 * El servicio de aprobación por correo: firma, envía, muestra, decide y señala.
 *
 * Todo lo que escribe pasa por `@aiw/ledger`, que es el único punto de escritura
 * del libro y el que garantiza que la decisión y su entrada quedan juntas. Este
 * módulo no habla SQL más allá de leer el correo del destinatario: lo suyo es el
 * canal, no la verdad.
 *
 * Orden de los pasos, y por qué es ese: la decisión se registra **antes** de
 * intentar la señal. Si la señal falla, la decisión sigue siendo la verdad y la
 * entrada de auditoría con `resultado: 'error'` dice exactamente qué reintentar. Al
 * contrario —señalar primero— un fallo al escribir dejaría un flujo que ya siguió
 * adelante con una decisión que no consta en ningún sitio.
 */
import { conTenant } from '@aiw/db';
import type {
  CargaSenalDecision,
  CorreoSaliente,
  PuertoDeCorreo,
  PuertoDeSenal,
} from '@aiw/domain';
import {
  anotarCorreoEnviado,
  anotarEnlaceAbierto,
  anotarEnlaceRechazado,
  anotarSenalEntregada,
  cargaDeSenal,
  leerAprobacion,
  registrarDecision,
  vencerAprobaciones,
  type AprobacionLeida,
  type DecisionRegistrada,
} from '@aiw/ledger';
import type postgres from 'postgres';

import { reintentar, textoDeError, type OpcionesReintento } from '../reintentos.js';

import type { ConfiguracionAprobacion } from './configuracion.js';
import { firmarEnlace, urlDelEnlace, verificarEnlace } from './firma.js';
import { componerCorreo } from './plantilla.js';
import { SENTIDOS_BOTON, type SentidoBoton } from './paginas.js';

/** La bandera de funcionalidad está apagada: no se envía nada y no se abre nada. */
export class ErrorBanderaApagada extends Error {
  constructor() {
    super(
      'La aprobación por correo está detrás de la bandera AIW_APROBACION_CORREO y ' +
        'está apagada. Enciéndela en el entorno para la demo.',
    );
    this.name = 'ErrorBanderaApagada';
  }
}

export interface DependenciasDelServicio {
  cliente: postgres.Sql;
  configuracion: ConfiguracionAprobacion;
  correo: PuertoDeCorreo;
  senal: PuertoDeSenal;
  /** Reloj inyectable: las pruebas de caducidad no pueden esperar tres días. */
  ahora?: (() => Date) | undefined;
  dormir?: ((ms: number) => Promise<void>) | undefined;
}

export interface SolicitudEnviada {
  token: string;
  url: string;
  correo: CorreoSaliente;
  proveedor: string;
  referencia: string;
  intentos: number;
  caducaEn: Date;
}

export type VistaDelEnlace =
  | { estado: 'mostrar'; aprobacion: AprobacionLeida; token: string }
  | { estado: 'no_valido' }
  | { estado: 'caducado'; venceEn: Date | null }
  | { estado: 'ya_decidida'; sentido: string | null };

export type ResultadoDelEnlace =
  | { estado: 'decidida'; sentido: 'aprobada' | 'rechazada'; senalEntregada: boolean }
  | { estado: 'no_valido' }
  | { estado: 'caducado'; venceEn: Date | null }
  | { estado: 'ya_decidida'; sentido: string | null };

export class ServicioDeAprobacion {
  readonly #cliente: postgres.Sql;
  readonly #configuracion: ConfiguracionAprobacion;
  readonly #correo: PuertoDeCorreo;
  readonly #senal: PuertoDeSenal;
  readonly #ahora: () => Date;
  readonly #dormir: ((ms: number) => Promise<void>) | undefined;

  constructor(dependencias: DependenciasDelServicio) {
    this.#cliente = dependencias.cliente;
    this.#configuracion = dependencias.configuracion;
    this.#correo = dependencias.correo;
    this.#senal = dependencias.senal;
    this.#ahora = dependencias.ahora ?? (() => new Date());
    this.#dormir = dependencias.dormir;
  }

  get configuracion(): ConfiguracionAprobacion {
    return this.#configuracion;
  }

  /**
   * Firma el enlace y manda el correo, con reintentos y una entrada por intento.
   *
   * La caducidad del enlace es la de la aprobación cuando la tiene, y si no, la
   * validez configurada. Nunca es más larga que `vence_en`: un enlace que sigue
   * sirviendo después de que la aprobación haya vencido es una puerta abierta.
   */
  async enviarSolicitud(
    tenantId: string,
    aprobacionId: string,
    opciones: { para?: string | undefined } = {},
  ): Promise<SolicitudEnviada> {
    this.#exigirBandera();
    const ahora = this.#ahora();
    const aprobacion = await this.#leer(tenantId, aprobacionId);
    if (!aprobacion) {
      throw new Error(`No hay ninguna aprobación ${aprobacionId} en este tenant.`);
    }
    if (aprobacion.decision) {
      throw new Error(`La aprobación ${aprobacionId} ya está decidida: no se pide dos veces.`);
    }

    const caducaEn = this.#caducidadDelEnlace(aprobacion, ahora);
    if (caducaEn.getTime() <= ahora.getTime()) {
      throw new Error(`La aprobación ${aprobacionId} ya venció: no se manda un enlace muerto.`);
    }

    const para = opciones.para ?? (await this.#correoDelDestinatario(tenantId, aprobacion));
    const token = firmarEnlace(
      this.#configuracion.claveDeFirma,
      { tenantId, aprobacionId: aprobacion.id, tareaId: aprobacion.tareaId },
      { caducaEn },
    );
    const url = urlDelEnlace(this.#configuracion.urlPublica, token);
    const mensaje = componerCorreo({
      para,
      remitente: this.#configuracion.correo.remitente,
      resumenLegible: aprobacion.resumenLegible,
      claseAccion: aprobacion.claseAccion,
      nivelExigido: aprobacion.nivelExigido,
      venceEn: aprobacion.venceEn,
      url,
    });

    const comienzo = Date.now();
    const { valor, intentos } = await reintentar(
      () => this.#correo.enviar(mensaje),
      this.#opcionesDeReintento(this.#configuracion.correo, async (error, intento) => {
        await anotarCorreoEnviado(this.#cliente, tenantId, {
          aprobacion,
          intento,
          proveedor: this.#configuracion.correo.proveedor,
          duracionMs: Date.now() - comienzo,
          error: textoDeError(error),
        });
      }),
    );
    await anotarCorreoEnviado(this.#cliente, tenantId, {
      aprobacion,
      intento: intentos,
      proveedor: valor.proveedor,
      duracionMs: Date.now() - comienzo,
      referencia: valor.id,
    });

    return {
      token,
      url,
      correo: mensaje,
      proveedor: valor.proveedor,
      referencia: valor.id,
      intentos,
      caducaEn,
    };
  }

  /**
   * Abre el enlace: comprueba el token, lee la aprobación y anota la apertura.
   *
   * Abrir no decide. Es lo que permite que un antivirus o una pasarela de correo
   * precarguen el enlace sin consecuencias.
   */
  async abrirEnlace(token: string): Promise<VistaDelEnlace> {
    this.#exigirBandera();
    const ahora = this.#ahora();
    const verificado = verificarEnlace(this.#configuracion.claveDeFirma, token, ahora);

    if (!verificado.valido) {
      if (verificado.motivo !== 'caducado' || !verificado.carga) return { estado: 'no_valido' };
      const carga = verificado.carga;
      const aprobacion = await this.#leer(carga.tenantId, carga.aprobacionId);
      await anotarEnlaceRechazado(this.#cliente, carga.tenantId, {
        aprobacionId: carga.aprobacionId,
        tareaId: carga.tareaId,
        origen: 'correo',
        herramienta: 'correo',
        motivo: 'vencida',
        aprobacion,
      });
      return { estado: 'caducado', venceEn: aprobacion?.venceEn ?? null };
    }

    const { carga } = verificado;
    const aprobacion = await this.#leer(carga.tenantId, carga.aprobacionId);
    if (!aprobacion) {
      await anotarEnlaceRechazado(this.#cliente, carga.tenantId, {
        aprobacionId: carga.aprobacionId,
        tareaId: carga.tareaId,
        origen: 'correo',
        herramienta: 'correo',
        motivo: 'no_encontrada',
      });
      return { estado: 'no_valido' };
    }
    if (aprobacion.decision) {
      await anotarEnlaceRechazado(this.#cliente, carga.tenantId, {
        aprobacionId: aprobacion.id,
        origen: 'correo',
        herramienta: 'correo',
        motivo: 'ya_decidida',
        aprobacion,
      });
      return { estado: 'ya_decidida', sentido: aprobacion.decision.sentido };
    }
    if (aprobacion.venceEn && aprobacion.venceEn.getTime() <= ahora.getTime()) {
      await anotarEnlaceRechazado(this.#cliente, carga.tenantId, {
        aprobacionId: aprobacion.id,
        origen: 'correo',
        herramienta: 'correo',
        motivo: 'vencida',
        aprobacion,
      });
      return { estado: 'caducado', venceEn: aprobacion.venceEn };
    }

    await anotarEnlaceAbierto(this.#cliente, carga.tenantId, aprobacion);
    return { estado: 'mostrar', aprobacion, token };
  }

  /** Decide: registra la decisión y entrega la señal al flujo de la tarea. */
  async decidir(token: string, boton: SentidoBoton): Promise<ResultadoDelEnlace> {
    this.#exigirBandera();
    const ahora = this.#ahora();
    const verificado = verificarEnlace(this.#configuracion.claveDeFirma, token, ahora);

    if (!verificado.valido) {
      if (verificado.motivo !== 'caducado' || !verificado.carga) return { estado: 'no_valido' };
      const carga = verificado.carga;
      const aprobacion = await this.#leer(carga.tenantId, carga.aprobacionId);
      await anotarEnlaceRechazado(this.#cliente, carga.tenantId, {
        aprobacionId: carga.aprobacionId,
        tareaId: carga.tareaId,
        origen: 'correo',
        herramienta: 'correo',
        motivo: 'vencida',
        aprobacion,
      });
      return { estado: 'caducado', venceEn: aprobacion?.venceEn ?? null };
    }

    const { carga } = verificado;
    const sentido = boton === SENTIDOS_BOTON.aprobar ? 'aprobada' : 'rechazada';
    const resultado = await registrarDecision(this.#cliente, carga.tenantId, {
      aprobacionId: carga.aprobacionId,
      tareaId: carga.tareaId,
      sentido,
      origen: 'correo',
      herramienta: 'correo',
      ahora,
    });

    if (resultado.estado === 'rechazada_por_enlace') {
      switch (resultado.motivo) {
        case 'no_encontrada':
          return { estado: 'no_valido' };
        case 'vencida':
          return { estado: 'caducado', venceEn: resultado.aprobacion?.venceEn ?? null };
        case 'ya_decidida':
          return { estado: 'ya_decidida', sentido: resultado.decisionPrevia?.sentido ?? null };
      }
    }

    const senalEntregada = await this.entregarSenal(
      carga.tenantId,
      resultado.aprobacion,
      resultado.decision,
      'correo',
    );
    return { estado: 'decidida', sentido, senalEntregada };
  }

  /**
   * Entrega la señal al flujo, con reintentos y una entrada por intento.
   *
   * Devuelve si llegó. No lanza: la decisión ya está escrita y no se deshace porque
   * Temporal esté caído. Lo que queda es la entrada con `resultado: 'error'`, que es
   * el trabajo pendiente escrito donde se puede consultar.
   */
  async entregarSenal(
    tenantId: string,
    aprobacion: AprobacionLeida,
    decision: DecisionRegistrada,
    origen: 'correo' | 'plataforma',
    motivo?: string | undefined,
  ): Promise<boolean> {
    const carga = cargaDeSenal(tenantId, aprobacion, decision, origen, motivo);
    const flujoId = aprobacion.flujoTemporalId;

    if (!flujoId) {
      // La tarea no tiene flujo: pasa con las tareas sembradas y con las que se
      // crean antes de arrancar el flujo. Se anota como error porque lo es, y con
      // el motivo dentro para que no haya que adivinarlo.
      await anotarSenalEntregada(this.#cliente, tenantId, {
        aprobacion,
        intento: 1,
        flujoId: '',
        nombreSenal: this.#configuracion.senal.nombre,
        duracionMs: 0,
        error: 'La tarea no tiene flujo_temporal_id: no hay a quién señalar.',
      });
      return false;
    }

    const destino = { flujoId, nombreSenal: this.#configuracion.senal.nombre };
    const comienzo = Date.now();
    try {
      const { intentos } = await reintentar(
        () => this.#senal.entregar(destino, carga),
        this.#opcionesDeReintento(this.#configuracion.senal, async (error, intento) => {
          await this.#anotarSenal(tenantId, aprobacion, destino, intento, comienzo, error);
        }),
      );
      await this.#anotarSenal(tenantId, aprobacion, destino, intentos, comienzo);
      return true;
    } catch {
      // Los intentos ya quedaron anotados uno por uno en `alFallar`.
      return false;
    }
  }

  /** Resuelve las vencidas sin decisión y señala cada una. Devuelve cuántas. */
  async vencer(tenantId: string, limite?: number): Promise<number> {
    const vencidas = await vencerAprobaciones(this.#cliente, tenantId, {
      ahora: this.#ahora(),
      ...(limite === undefined ? {} : { limite }),
    });
    for (const vencida of vencidas) {
      await this.entregarSenal(
        tenantId,
        vencida.aprobacion,
        vencida.decision,
        'plataforma',
        vencida.carga.motivo,
      );
    }
    return vencidas.length;
  }

  #exigirBandera(): void {
    if (!this.#configuracion.activa) throw new ErrorBanderaApagada();
  }

  async #leer(tenantId: string, aprobacionId: string): Promise<AprobacionLeida | null> {
    return conTenant(this.#cliente, tenantId, (tx) => leerAprobacion(tx, tenantId, aprobacionId));
  }

  #caducidadDelEnlace(aprobacion: AprobacionLeida, ahora: Date): Date {
    const porValidez = new Date(
      ahora.getTime() + this.#configuracion.validezHoras * 60 * 60 * 1000,
    );
    if (!aprobacion.venceEn) return porValidez;
    return aprobacion.venceEn.getTime() < porValidez.getTime() ? aprobacion.venceEn : porValidez;
  }

  async #correoDelDestinatario(tenantId: string, aprobacion: AprobacionLeida): Promise<string> {
    if (!aprobacion.personaId) {
      throw new Error(
        `La aprobación ${aprobacion.id} no tiene persona a la que pedirla: sin destinatario ` +
          'no hay correo que enviar.',
      );
    }
    const correo = await leerCorreoDePersona(this.#cliente, tenantId, aprobacion.personaId);
    if (!correo) {
      throw new Error(`La persona ${aprobacion.personaId} no tiene correo en este tenant.`);
    }
    return correo;
  }

  #opcionesDeReintento(
    politica: { intentos: number; retardoMs: number },
    alFallar: (error: unknown, intento: number) => Promise<void>,
  ): OpcionesReintento {
    return {
      intentos: politica.intentos,
      retardoMs: politica.retardoMs,
      alFallar: (error, intento) => alFallar(error, intento),
      ...(this.#dormir === undefined ? {} : { dormir: this.#dormir }),
    };
  }

  async #anotarSenal(
    tenantId: string,
    aprobacion: AprobacionLeida,
    destino: { flujoId: string; nombreSenal: string },
    intento: number,
    comienzo: number,
    error?: unknown,
  ): Promise<void> {
    await anotarSenalEntregada(this.#cliente, tenantId, {
      aprobacion,
      intento,
      flujoId: destino.flujoId,
      nombreSenal: destino.nombreSenal,
      duracionMs: Date.now() - comienzo,
      ...(error === undefined ? {} : { error: textoDeError(error) }),
    });
  }
}

/**
 * El correo de la persona a la que se le pide la aprobación.
 *
 * La consulta vive aquí y no en `@aiw/ledger` a propósito: el libro de auditoría no
 * tiene por qué leer datos personales, y elegir por qué canal se avisa a alguien es
 * cosa del canal. Las preferencias por persona y las suplencias llegan con
 * `@aiw/notifications`; aquí se usa el correo de la ficha.
 */
export async function leerCorreoDePersona(
  cliente: postgres.Sql,
  tenantId: string,
  personaId: string,
): Promise<string | null> {
  return conTenant(cliente, tenantId, async (tx) => {
    const [fila] = await tx<{ correo: string | null }[]>`
      select correo from persona where tenant_id = ${tenantId} and id = ${personaId}
    `;
    return fila?.correo ?? null;
  });
}

export type { CargaSenalDecision };
