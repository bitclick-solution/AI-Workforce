'use client';

import { Aviso, Boton, Tarjeta } from '@aiw/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  registrarPasskey as registrarLaPasskey,
  salir as cerrarSesion,
} from '../../../lib/cliente-acceso';
import { actualizarPresencia } from '../../../lib/cliente-perfil';

type Estado = 'quieto' | 'registrando' | 'registrada' | 'saliendo';

function horaDeCaducidad(iso: string): string {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime())
    ? ''
    : fecha.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Ajuste de presencia del perfil (ADR-026): interruptor mínimo propio de esta
 * página, sin ampliar `packages/ui` para una sola casilla.
 */
function InterruptorDePresencia({ mostrarPresenciaInicial }: { mostrarPresenciaInicial: boolean }) {
  const [activo, setActivo] = useState(mostrarPresenciaInicial);
  const [guardando, setGuardando] = useState(false);
  const [fallo, setFallo] = useState<string | undefined>();

  async function alternar() {
    const siguiente = !activo;
    setActivo(siguiente);
    setFallo(undefined);
    setGuardando(true);
    const { fallo: error } = await actualizarPresencia(siguiente);
    setGuardando(false);
    if (error) {
      setActivo(!siguiente);
      setFallo(error);
    }
  }

  return (
    <Tarjeta titulo="Presencia en las salas">
      <div className="flex items-center justify-between gap-4">
        <label htmlFor="mostrar-presencia" className="text-sm text-neutral-600">
          Mostrar mi presencia en las salas
        </label>
        <button
          id="mostrar-presencia"
          type="button"
          role="switch"
          aria-checked={activo}
          disabled={guardando}
          onClick={() => void alternar()}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
            activo ? 'bg-neutral-900' : 'bg-neutral-300'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              activo ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        Desactivado, apareces como desconectada para los demás en todas las salas.
      </p>
      {fallo ? (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {fallo}
        </p>
      ) : null}
    </Tarjeta>
  );
}

export function VistaDeCuenta({
  caducaEn,
  mostrarPresenciaInicial,
}: {
  caducaEn: string;
  mostrarPresenciaInicial: boolean;
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>('quieto');
  const [fallo, setFallo] = useState<string | undefined>();

  async function registrarPasskey() {
    setFallo(undefined);
    setEstado('registrando');
    const { fallo: error } = await registrarLaPasskey('Este dispositivo');
    if (error) {
      setFallo('No se registró la passkey. Puedes seguir entrando con el enlace por correo.');
      setEstado('quieto');
      return;
    }
    setEstado('registrada');
  }

  async function salir() {
    setEstado('saliendo');
    await cerrarSesion();
    router.push('/acceso');
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <Tarjeta titulo="Sesión">
        <p className="text-sm text-neutral-600">
          Tu sesión dura hasta el {horaDeCaducidad(caducaEn)}. Después tendrás que volver a entrar.
        </p>
      </Tarjeta>
      <InterruptorDePresencia mostrarPresenciaInicial={mostrarPresenciaInicial} />
      {fallo ? (
        <Aviso tipo="informacion" titulo="Sin passkey">
          {fallo}
        </Aviso>
      ) : null}
      {estado === 'registrada' ? (
        <Aviso tipo="informacion" titulo="Passkey registrada" data-testid="passkey-registrada">
          La próxima vez podrás entrar sin esperar el correo.
        </Aviso>
      ) : (
        <Boton
          tono="secundario"
          cargando={estado === 'registrando'}
          onClick={() => void registrarPasskey()}
        >
          Registrar una passkey en este dispositivo
        </Boton>
      )}
      <Boton tono="peligro" cargando={estado === 'saliendo'} onClick={() => void salir()}>
        Cerrar sesión
      </Boton>
    </div>
  );
}
