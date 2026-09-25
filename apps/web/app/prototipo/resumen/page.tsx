'use client';

import { Aviso, Boton, formatearDuracion, Insignia, Tarjeta, useTraduccion } from '@aiw/ui';
import { useRouter } from 'next/navigation';

import { useRecorrido } from '../../../lib/prototipo/contexto';
import { CONTADOR_DE_EJEMPLO, OBJETIVO_MINUTOS } from '../../../lib/prototipo/datos';
import { duracionHastaAprobacion, siguienteHito } from '../../../lib/prototipo/recorrido';

const QUE_FALTA: Record<string, { texto: string; ruta: string }> = {
  primerClic: { texto: 'Empieza el recorrido en la portada.', ruta: '/prototipo' },
  agenteContratado: { texto: 'Contrata el agente.', ruta: '/prototipo/contratacion' },
  intervencionPedida: { texto: 'Pregunta en la sala.', ruta: '/prototipo/sala' },
  tareaAprobada: { texto: 'Aprueba la primera tarea.', ruta: '/prototipo/aprobacion' },
};

export default function Resumen() {
  const t = useTraduccion();
  const router = useRouter();
  const { recorrido, reiniciar } = useRecorrido();
  const duracion = duracionHastaAprobacion(recorrido);
  const pendiente = siguienteHito(recorrido);
  const dentroDelObjetivo = duracion !== null && duracion <= OBJETIVO_MINUTOS * 60_000;

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 sm:text-3xl">
          Lo que ha pasado
        </h1>
        <p className="mt-2 max-w-2xl text-neutral-700">
          Este es el número que el producto se compromete a cumplir: del primer clic a la primera
          tarea aprobada, menos de {OBJETIVO_MINUTOS} minutos.
        </p>
      </header>

      {duracion === null && pendiente !== null ? (
        <Aviso
          tipo="vacio"
          titulo="Todavía no hay tiempo que medir"
          data-testid="estado-vacio"
          accion={
            <Boton onClick={() => router.push(QUE_FALTA[pendiente]?.ruta ?? '/prototipo')}>
              {QUE_FALTA[pendiente]?.texto ?? 'Empezar'}
            </Boton>
          }
        >
          <p>
            El reloj para en la primera tarea aprobada, y esa todavía no ha llegado. No enseño un
            número a medias.
          </p>
        </Aviso>
      ) : null}

      {duracion !== null ? (
        <Tarjeta
          titulo="Del primer clic a la primera tarea aprobada"
          nivel={2}
          data-testid="tiempo-medido"
          cabecera={
            <Insignia
              etiqueta="Objetivo"
              valor={dentroDelObjetivo ? 'cumplido' : 'no cumplido'}
              tono={dentroDelObjetivo ? 'exito' : 'aviso'}
            />
          }
        >
          <p className="text-4xl font-semibold tracking-tight text-neutral-900">
            {formatearDuracion(duracion, t)}
          </p>
          <p className="mt-2 text-sm text-neutral-700">
            Objetivo: por debajo de {OBJETIVO_MINUTOS} minutos. En el producto, este tiempo se
            calcula desde el libro de auditoría: de la entrada «organización creada» a la primera
            decisión de aprobación. Aquí sale del navegador y solo sirve para la sesión de prueba.
          </p>
        </Tarjeta>
      ) : null}

      <Tarjeta titulo="Lo que has hecho" nivel={2} data-testid="hitos">
        <ul className="flex flex-col gap-2 text-sm text-neutral-700">
          <li>
            <strong className="text-neutral-900">Contratar:</strong>{' '}
            {recorrido.hitos.agenteContratado === undefined
              ? 'pendiente'
              : 'Conciliación bancaria, en periodo de prueba de 30 días.'}
          </li>
          <li>
            <strong className="text-neutral-900">Preguntar en la sala:</strong>{' '}
            {recorrido.hitos.intervencionPedida === undefined
              ? 'pendiente'
              : 'una intervención de Reclamación de cobros, con su coste, su nivel y su motivo.'}
          </li>
          <li>
            <strong className="text-neutral-900">Aprobar:</strong>{' '}
            {recorrido.hitos.tareaAprobada === undefined
              ? 'pendiente'
              : recorrido.aprobadaConEdicion
                ? 'una nota de seguimiento, aprobada después de que cambiaras el texto.'
                : 'una nota de seguimiento, aprobada tal cual.'}
          </li>
        </ul>
      </Tarjeta>

      <Tarjeta
        titulo="Contador de tareas"
        nivel={2}
        descripcion={`Plan ${CONTADOR_DE_EJEMPLO.plan}. Es un contador de ejemplo: el de verdad está en el panel.`}
        data-testid="contador"
        cabecera={
          <Insignia
            etiqueta="Consumido"
            valor={`${recorrido.tareas} de ${CONTADOR_DE_EJEMPLO.incluidas}`}
          />
        }
      >
        <p className="text-sm text-neutral-700">
          Contratar no consume tareas. La intervención en la sala y la nota aprobada sí. En el
          producto, cada una deja además su entrada en el registro, con qué herramienta se usó, qué
          datos se consultaron y cuánto costó.
        </p>
      </Tarjeta>

      <div className="flex flex-wrap gap-2">
        <Boton
          tono="secundario"
          onClick={() => {
            reiniciar();
            router.push('/prototipo');
          }}
          data-testid="reiniciar"
        >
          Empezar de nuevo
        </Boton>
      </div>
    </>
  );
}
