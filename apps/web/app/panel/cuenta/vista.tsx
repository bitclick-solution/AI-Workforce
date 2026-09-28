'use client';

import { Aviso, Boton, Tarjeta } from '@aiw/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  registrarPasskey as registrarLaPasskey,
  salir as cerrarSesion,
} from '../../../lib/cliente-acceso';

type Estado = 'quieto' | 'registrando' | 'registrada' | 'saliendo';

function horaDeCaducidad(iso: string): string {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime())
    ? ''
    : fecha.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
}

export function VistaDeCuenta({ caducaEn }: { caducaEn: string }) {
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
