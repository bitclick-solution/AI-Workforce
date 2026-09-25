'use client';

import { Aviso, Boton, Campo, Insignia, Porque, Tarjeta } from '@aiw/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useRecorrido } from '../../../lib/prototipo/contexto';
import {
  AGENTE_DE_COBROS,
  INTERVENCION_DE_COBROS,
  PREGUNTA_DE_LA_SALA,
} from '../../../lib/prototipo/datos';

type EstadoDeLaSala = 'vacia' | 'pensando' | 'respondida' | 'error' | 'necesita-persona';

export default function Sala() {
  const router = useRouter();
  const { sellarHito } = useRecorrido();
  const [pregunta, setPregunta] = useState('');
  const [estado, setEstado] = useState<EstadoDeLaSala>('vacia');
  const intervencion = INTERVENCION_DE_COBROS;

  function preguntar(texto: string, destino: 'respondida' | 'error' | 'necesita-persona') {
    setPregunta(texto);
    setEstado('pensando');
    // El retardo es de pantalla: aquí no hay moderador ni agente, solo datos.
    setTimeout(() => {
      setEstado(destino);
      if (destino === 'respondida') sellarHito('intervencionPedida');
    }, 200);
  }

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 sm:text-3xl">
          Sala general
        </h1>
        <p className="mt-2 max-w-2xl text-neutral-700">
          Preguntas una vez y contesta quien tiene el dato. El moderador da la palabra a un solo
          agente y dice por qué a ese. Cada intervención enseña lo que cuesta, con cuánta autonomía
          actúa y en qué se ha basado.
        </p>
      </header>

      <Tarjeta titulo="Pregunta a tu equipo" nivel={2}>
        <div className="flex flex-col gap-4">
          <Campo
            id="pregunta"
            etiqueta="Tu pregunta"
            valor={pregunta}
            onCambio={setPregunta}
            marcador={PREGUNTA_DE_LA_SALA}
            ayuda="Prueba también las dos preguntas que fallan: son las que hay que ver antes de fiarse."
            data-testid="campo-pregunta"
          />
          <div className="flex flex-wrap gap-2">
            <Boton
              onClick={() => preguntar(PREGUNTA_DE_LA_SALA, 'respondida')}
              cargando={estado === 'pensando'}
              data-testid="preguntar"
            >
              {PREGUNTA_DE_LA_SALA}
            </Boton>
            <Boton
              tono="secundario"
              onClick={() =>
                preguntar('¿Cuánto hay en la cuenta del Santander ahora mismo?', 'error')
              }
              data-testid="preguntar-error"
            >
              Una pregunta que el ERP no puede contestar
            </Boton>
            <Boton
              tono="secundario"
              onClick={() =>
                preguntar(
                  'Distribuciones Ribera dice que la factura está mal. ¿Qué hacemos?',
                  'necesita-persona',
                )
              }
              data-testid="preguntar-persona"
            >
              Una pregunta que pide una decisión tuya
            </Boton>
          </div>
        </div>
      </Tarjeta>

      {estado === 'vacia' ? (
        <Aviso
          tipo="vacio"
          titulo="La sala está en silencio"
          data-testid="estado-vacio"
          accion={
            <Boton onClick={() => preguntar(PREGUNTA_DE_LA_SALA, 'respondida')}>
              Preguntar por los cobros
            </Boton>
          }
        >
          <p>
            Tus agentes no hablan si no tienen nada que aportar. {AGENTE_DE_COBROS.puesto} está{' '}
            {AGENTE_DE_COBROS.estado.toLowerCase()} y te escucha. Pregúntale algo.
          </p>
        </Aviso>
      ) : null}

      {estado === 'error' ? (
        <Aviso
          tipo="error"
          titulo="No he podido leer el banco"
          data-testid="estado-error"
          accion={
            <>
              <Boton
                tono="secundario"
                onClick={() =>
                  preguntar('¿Cuánto hay en la cuenta del Santander ahora mismo?', 'error')
                }
              >
                Reintentar
              </Boton>
              <Boton tono="secundario" onClick={() => preguntar(PREGUNTA_DE_LA_SALA, 'respondida')}>
                Preguntar otra cosa
              </Boton>
            </>
          }
        >
          <p>
            La conexión con el ERP ha devuelto un error de autorización al pedir los saldos: la
            cuenta que autorizaste no tiene permiso de lectura sobre bancos. No te doy un número
            aproximado ni me lo invento.
          </p>
          <p className="mt-2">
            Puedes reintentar, o ampliar el permiso en Conexiones. Mientras tanto, todo lo de
            facturas y cobros sigue funcionando.
          </p>
        </Aviso>
      ) : null}

      {estado === 'necesita-persona' ? (
        <Aviso
          tipo="necesita-persona"
          titulo="Esto lo decides tú"
          data-testid="estado-necesita-persona"
          accion={
            <>
              <Boton tono="secundario" onClick={() => preguntar(PREGUNTA_DE_LA_SALA, 'respondida')}>
                Volver a los cobros
              </Boton>
            </>
          }
        >
          <p>
            Distribuciones Ribera ha puesto la factura en disputa. Mi ficha dice que paro en cuanto
            un cliente discute el importe: no contesto yo a una disputa ni negocio condiciones.
          </p>
          <p className="mt-2">
            He dejado la factura marcada, he parado los recordatorios de ese cliente y te he pasado
            el histórico completo. Dime qué respondes y lo anoto.
          </p>
        </Aviso>
      ) : null}

      {estado === 'respondida' ? (
        <Tarjeta
          titulo={`${AGENTE_DE_COBROS.puesto} · ${AGENTE_DE_COBROS.departamento}`}
          nivel={2}
          data-testid="intervencion"
          cabecera={
            <>
              <Insignia etiqueta="Coste" valor={`${intervencion.costeTareas} tarea`} />
              <Insignia etiqueta="Nivel" valor={intervencion.nivel} />
            </>
          }
          pie={
            <div className="flex flex-col gap-3">
              <p className="text-sm text-neutral-700">
                Las dos primeras acciones necesitan tu permiso antes de salir. La tercera no la hago
                yo en ningún caso.
              </p>
              <Boton
                onClick={() => router.push('/prototipo/aprobacion')}
                data-testid="ir-a-aprobar"
              >
                Ver la petición de permiso
              </Boton>
            </div>
          }
        >
          <div className="flex flex-col gap-5">
            <p className="text-sm text-neutral-500" data-testid="moderador">
              {intervencion.moderador}
            </p>
            <p className="text-base text-neutral-800">{intervencion.respuesta}</p>

            <section>
              <h3 className="text-sm font-semibold text-neutral-900">Lo que propongo hacer</h3>
              <ul className="mt-2 flex flex-col gap-3">
                {intervencion.acciones.map((accion) => (
                  <li
                    key={accion.id}
                    className="rounded-lg border border-neutral-200 p-3 text-sm text-neutral-700"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-neutral-900">{accion.titulo}</strong>
                      <Insignia
                        etiqueta="Nivel"
                        valor={accion.nivel}
                        tono={accion.nivel === 'N0' ? 'peligro' : 'neutro'}
                      />
                      <Insignia
                        etiqueta="Coste"
                        valor={accion.tareas === 0 ? 'sin coste' : `${accion.tareas} tareas`}
                      />
                    </div>
                    <p className="mt-1">{accion.detalle}</p>
                  </li>
                ))}
              </ul>
            </section>

            <Porque id="porque-intervencion">
              <p>{intervencion.porque}</p>
              <ul className="mt-2 list-disc pl-5">
                {intervencion.citas.map((cita) => (
                  <li key={cita.fuente}>
                    <strong className="text-neutral-900">{cita.fuente}:</strong> {cita.dato}
                  </li>
                ))}
              </ul>
            </Porque>
          </div>
        </Tarjeta>
      ) : null}
    </>
  );
}
