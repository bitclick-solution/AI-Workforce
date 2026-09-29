'use client';

import { Aviso, Boton, Campo } from '@aiw/ui';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import {
  DESTINO_TRAS_ENTRAR,
  entrarConPasskey as entrarConLaPasskey,
  mensajeDeError,
  pedirEnlace as pedirElEnlace,
} from '../../lib/cliente-acceso';

type Estado = 'quieto' | 'enviando' | 'enviado' | 'passkey';

export function VistaDeAcceso({ error }: { error?: string | undefined }) {
  const router = useRouter();
  const [correo, setCorreo] = useState('');
  const [estado, setEstado] = useState<Estado>('quieto');
  const [fallo, setFallo] = useState<string | undefined>(mensajeDeError(error));

  async function pedirEnlace(evento: FormEvent) {
    evento.preventDefault();
    setFallo(undefined);
    setEstado('enviando');
    const { fallo: errorDelEnvio } = await pedirElEnlace(correo.trim());
    if (errorDelEnvio) {
      setFallo('No se pudo pedir el enlace. Vuelve a intentarlo en un momento.');
      setEstado('quieto');
      return;
    }
    setEstado('enviado');
  }

  async function entrarConPasskey() {
    setFallo(undefined);
    setEstado('passkey');
    const { fallo: errorDePasskey } = await entrarConLaPasskey();
    if (errorDePasskey) {
      setFallo('La passkey no sirvió. Prueba con el enlace por correo.');
      setEstado('quieto');
      return;
    }
    router.push(DESTINO_TRAS_ENTRAR);
  }

  if (estado === 'enviado') {
    return (
      <Aviso tipo="informacion" titulo="Mira tu correo" data-testid="acceso-enviado">
        Si {correo.trim()} tiene acceso, te hemos enviado un enlace para entrar. Sirve una vez y
        caduca en unos minutos.
      </Aviso>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {fallo ? (
        <Aviso tipo="informacion" titulo="No has entrado" data-testid="acceso-error">
          {fallo}
        </Aviso>
      ) : null}
      <form className="flex flex-col gap-3" onSubmit={(evento) => void pedirEnlace(evento)}>
        <Campo
          id="acceso-correo"
          etiqueta="Tu correo"
          valor={correo}
          onCambio={setCorreo}
          marcador="nombre@empresa.es"
          ayuda="Te mandamos un enlace de un solo uso. No hay contraseña."
          data-testid="acceso-correo"
        />
        <Boton type="submit" cargando={estado === 'enviando'} ancho="completo">
          Enviarme el enlace
        </Boton>
      </form>
      <div className="flex flex-col gap-2">
        <p className="text-sm text-neutral-600">¿Ya registraste una passkey en este dispositivo?</p>
        <Boton
          tono="secundario"
          ancho="completo"
          cargando={estado === 'passkey'}
          onClick={() => void entrarConPasskey()}
        >
          Entrar con passkey
        </Boton>
      </div>
    </div>
  );
}
