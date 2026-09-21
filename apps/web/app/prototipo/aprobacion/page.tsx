'use client';

import { Aviso, Boton, Campo, Insignia, Porque, Tarjeta } from '@aiw/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useRecorrido } from '../../../lib/prototipo/contexto';
import { PETICION_DE_ESCRITURA } from '../../../lib/prototipo/datos';

type EstadoDeLaPeticion =
  'pendiente' | 'editando' | 'aprobada' | 'rechazada' | 'error' | 'caducada';

export default function Aprobacion() {
  const router = useRouter();
  const { recorrido, sellarHito, anotarTareas, anotarEdicion } = useRecorrido();
  const peticion = PETICION_DE_ESCRITURA;
  const [estado, setEstado] = useState<EstadoDeLaPeticion>('pendiente');
  const [borrador, setBorrador] = useState<string>(peticion.borrador);
  const [editado, setEditado] = useState(false);
  const yaAprobada = recorrido.hitos.tareaAprobada !== undefined;

  function aprobar() {
    if (borrador.trim() === '') {
      setEstado('error');
      return;
    }
    if (editado) anotarEdicion();
    if (!yaAprobada) anotarTareas(peticion.tareas);
    sellarHito('tareaAprobada');
    setEstado('aprobada');
  }

  return (
    /* Móvil primero: esta pantalla se diseña a 390 px y crece hasta el escritorio. */
    <div className="mx-auto w-full max-w-md">
      <header>
        <p className="text-xs font-medium uppercase tracking-widest text-neutral-500">
          Permiso pendiente · {peticion.id}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-900">
          {peticion.titulo}
        </h1>
        <div className="mt-3 flex flex-wrap gap-2">
          <Insignia etiqueta="Agente" valor={peticion.agente} />
          <Insignia etiqueta="Nivel" valor={peticion.nivel} />
          <Insignia etiqueta="Riesgo" valor={peticion.riesgo} tono="aviso" />
          <Insignia etiqueta="Coste" valor={`${peticion.tareas} tarea`} />
        </div>
      </header>

      {estado === 'caducada' ? (
        <Aviso
          tipo="vacio"
          titulo="Este permiso ya no está"
          className="mt-6"
          data-testid="estado-vacio"
          accion={
            <Boton tono="secundario" onClick={() => setEstado('pendiente')}>
              Volver a la petición
            </Boton>
          }
        >
          <p>
            Pasaron las 48 horas y la tarea se cerró sin hacer nada. No se escribió nada en el ERP y
            no se envió ningún mensaje. {peticion.agente} volverá a pedírtelo mañana si sigue
            haciendo falta.
          </p>
        </Aviso>
      ) : null}

      {estado === 'error' ? (
        <Aviso
          tipo="error"
          titulo="La nota no puede quedar vacía"
          className="mt-6"
          data-testid="estado-error"
          accion={
            <>
              <Boton tono="secundario" onClick={() => setEstado('editando')}>
                Volver a escribirla
              </Boton>
              <Boton
                tono="secundario"
                onClick={() => {
                  setBorrador(peticion.borrador);
                  setEditado(false);
                  setEstado('pendiente');
                }}
              >
                Recuperar el texto original
              </Boton>
            </>
          }
        >
          <p>
            Has borrado todo el texto y no puedo escribir una nota en blanco en la factura. Escribe
            algo o recupera mi borrador.
          </p>
        </Aviso>
      ) : null}

      {estado === 'rechazada' ? (
        <Aviso
          tipo="necesita-persona"
          titulo="Rechazado. No he escrito nada"
          className="mt-6"
          data-testid="estado-necesita-persona"
          accion={
            <>
              <Boton tono="secundario" onClick={() => setEstado('pendiente')}>
                Cambiar de idea
              </Boton>
              <Boton tono="secundario" onClick={() => router.push('/prototipo/resumen')}>
                Ver el resumen
              </Boton>
            </>
          }
        >
          <p>
            La factura queda como estaba. He parado la tarea y te la paso a ti: a partir de aquí
            decide una persona. Si me dices por qué lo rechazas, no vuelvo a proponer lo mismo.
          </p>
        </Aviso>
      ) : null}

      {estado === 'aprobada' ? (
        <Tarjeta
          titulo="Hecho"
          nivel={2}
          className="mt-6"
          data-testid="aprobada"
          cabecera={<Insignia etiqueta="Estado" valor="En curso" tono="exito" />}
          pie={
            <Boton
              ancho="completo"
              onClick={() => router.push('/prototipo/resumen')}
              data-testid="ir-a-resumen"
            >
              Ver el resumen y el tiempo
            </Boton>
          }
        >
          <p className="text-sm text-neutral-700">
            He anotado la nota en la factura {peticion.documento.split(' · ')[0]} y en la ficha de{' '}
            {peticion.cliente}. Queda en el registro con tu nombre, la hora y el texto exacto.
          </p>
          {recorrido.aprobadaConEdicion ? (
            <p className="mt-3 text-sm text-neutral-700" data-testid="hubo-edicion">
              Cambiaste el texto antes de aprobar. Eso me enseña más que un sí: he guardado tu
              versión y la mía para escribir la próxima más parecida a la tuya.
            </p>
          ) : null}
          <p className="mt-3 text-sm text-neutral-500">
            En el producto, esta acción sumaría una entrada al registro y una tarea al contador.
            Aquí no: es un prototipo.
          </p>
        </Tarjeta>
      ) : null}

      {estado === 'pendiente' || estado === 'editando' ? (
        <Tarjeta titulo="Qué quiero hacer" nivel={2} className="mt-6" data-testid="peticion">
          <div className="flex flex-col gap-5">
            <p className="text-sm text-neutral-800">{peticion.resumen}</p>

            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex flex-wrap gap-2">
                <dt className="font-medium text-neutral-900">Cliente:</dt>
                <dd className="text-neutral-700">{peticion.cliente}</dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="font-medium text-neutral-900">Documento:</dt>
                <dd className="text-neutral-700">{peticion.documento}</dd>
              </div>
            </dl>

            <section>
              <h3 className="text-sm font-semibold text-neutral-900">Lo que no voy a hacer</h3>
              <ul className="mt-2 list-disc pl-5 text-sm text-neutral-700">
                {peticion.queNoHace.map((linea) => (
                  <li key={linea}>{linea}</li>
                ))}
              </ul>
            </section>

            {estado === 'editando' ? (
              <Campo
                id="borrador"
                etiqueta="El texto que voy a escribir"
                valor={borrador}
                onCambio={(valor) => {
                  setBorrador(valor);
                  setEditado(valor !== peticion.borrador);
                }}
                multilinea
                filas={5}
                ayuda="Cámbialo a tu gusto. Lo que dejes aquí es lo que se escribe, palabra por palabra."
                data-testid="campo-borrador"
              />
            ) : (
              <section>
                <h3 className="text-sm font-semibold text-neutral-900">
                  El texto que voy a escribir
                </h3>
                <blockquote
                  className="mt-2 rounded-lg bg-neutral-100 p-3 text-sm text-neutral-800"
                  data-testid="borrador"
                >
                  {borrador}
                </blockquote>
                {editado ? (
                  <p className="mt-2 text-xs text-neutral-600">Este texto lo has cambiado tú.</p>
                ) : null}
              </section>
            )}

            <Porque id="porque-peticion">
              <p>
                El viernes entró un correo de {peticion.cliente} pidiendo el duplicado de esta
                factura. Mi ficha dice que anote en el ERP cada contacto con un cliente sobre una
                factura vencida, para que quien mire la factura mañana sepa qué pasó sin buscar en
                el correo.
              </p>
              <p className="mt-2">
                Te lo pido a ti porque escribir en el ERP es riesgo medio y estoy en nivel{' '}
                {peticion.nivel}: ejecuto después de que apruebes, nunca antes. {peticion.caducidad}
              </p>
            </Porque>

            <div className="flex flex-col gap-2">
              <Boton ancho="completo" onClick={aprobar} data-testid="aprobar">
                {estado === 'editando' ? 'Aprobar con mi texto' : 'Aprobar'}
              </Boton>
              {estado === 'pendiente' ? (
                <Boton
                  ancho="completo"
                  tono="secundario"
                  onClick={() => setEstado('editando')}
                  data-testid="editar"
                >
                  Editar el texto antes de aprobar
                </Boton>
              ) : (
                <Boton
                  ancho="completo"
                  tono="secundario"
                  onClick={() => setEstado('pendiente')}
                  data-testid="dejar-de-editar"
                >
                  Dejar de editar
                </Boton>
              )}
              <Boton
                ancho="completo"
                tono="peligro"
                onClick={() => setEstado('rechazada')}
                data-testid="rechazar"
              >
                Rechazar
              </Boton>
              <Boton
                ancho="completo"
                tono="secundario"
                onClick={() => setEstado('caducada')}
                data-testid="ver-caducada"
              >
                Ver qué pasa si no decido
              </Boton>
            </div>
          </div>
        </Tarjeta>
      ) : null}
    </div>
  );
}
