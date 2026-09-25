'use client';

import { Aviso, Boton, Tarjeta } from '@aiw/ui';
import { useRouter } from 'next/navigation';

import { useRecorrido } from '../../lib/prototipo/contexto';
import { OBJETIVO_MINUTOS } from '../../lib/prototipo/datos';

export default function Portada() {
  const router = useRouter();
  const { recorrido, sellarHito, reiniciar } = useRecorrido();
  const empezado = recorrido.hitos.primerClic !== undefined;

  function empezar() {
    sellarHito('primerClic');
    router.push('/prototipo/contratacion');
  }

  return (
    <>
      <header>
        <p className="text-xs font-medium uppercase tracking-widest text-neutral-500">
          Bitclick Solutions · prototipo de interfaz
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-neutral-900 sm:text-4xl">
          Del primer clic a la primera tarea aprobada
        </h1>
        <p className="mt-3 max-w-2xl text-neutral-700">
          Tres pantallas: contratar un agente escribiendo una frase, preguntarle algo en la sala y
          aprobar desde el móvil lo que quiere escribir en tu ERP. El reloj empieza cuando pulsas
          «Empezar» y para cuando apruebas la primera tarea. El objetivo son {OBJETIVO_MINUTOS}{' '}
          minutos.
        </p>
      </header>

      <Aviso
        tipo="informacion"
        titulo="Esto es un prototipo, no el producto"
        data-testid="aviso-prototipo"
      >
        <p>
          Todos los datos son de ejemplo y están escritos a mano. Nada se envía a nadie, no hay
          ninguna conexión con un ERP ni con un correo, y nada de lo que hagas aquí queda guardado.
          Los números de las fichas (coste, tareas, niveles) sí son los de la definición de
          producto.
        </p>
      </Aviso>

      <Tarjeta
        titulo="Qué vas a hacer"
        descripcion="Tres pasos y un resumen. Puedes volver atrás en cualquier momento con la barra de arriba."
      >
        <ol className="flex flex-col gap-3 text-sm text-neutral-700">
          <li>
            <strong className="text-neutral-900">1. Contratar.</strong> Escribe qué necesitas con
            tus palabras. Te devuelvo una propuesta con la ficha del puesto, lo que va a poder
            tocar, sus límites, su nivel de autonomía y lo que cuesta.
          </li>
          <li>
            <strong className="text-neutral-900">2. Preguntar en la sala.</strong> Haz una pregunta
            de finanzas. Responde el agente que tiene el dato, con su coste, su nivel y el motivo.
          </li>
          <li>
            <strong className="text-neutral-900">3. Aprobar.</strong> El agente pide permiso para
            escribir una nota en una factura. Lo lees en el móvil y decides: aprobar, rechazar o
            cambiar el texto antes de aprobar.
          </li>
        </ol>
      </Tarjeta>

      <div className="flex flex-wrap items-center gap-3">
        <Boton onClick={empezar} data-testid="empezar">
          {empezado ? 'Seguir con la contratación' : 'Empezar'}
        </Boton>
        {empezado ? (
          <Boton tono="secundario" onClick={reiniciar} data-testid="reiniciar">
            Reiniciar el recorrido
          </Boton>
        ) : null}
      </div>
    </>
  );
}
