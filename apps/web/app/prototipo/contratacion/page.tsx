'use client';

import { Aviso, Boton, Campo, Insignia, Porque, Tarjeta } from '@aiw/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useRecorrido } from '../../../lib/prototipo/contexto';
import { PROPUESTA_CONCILIACION } from '../../../lib/prototipo/datos';
import { FRASES_DE_EJEMPLO, interpretarFrase, type Respuesta } from '../../../lib/prototipo/frases';

export default function Contratacion() {
  const router = useRouter();
  const { recorrido, sellarHito } = useRecorrido();
  const [frase, setFrase] = useState('');
  const [respuesta, setRespuesta] = useState<Respuesta | null>(null);
  const [pensando, setPensando] = useState(false);
  const contratado = recorrido.hitos.agenteContratado !== undefined;
  const puesto = PROPUESTA_CONCILIACION;

  function proponer(texto: string) {
    setFrase(texto);
    setPensando(true);
    // El retardo es de pantalla, no de proceso: el prototipo no llama a nada.
    setTimeout(() => {
      setRespuesta(interpretarFrase(texto));
      setPensando(false);
    }, 150);
  }

  function contratar() {
    sellarHito('agenteContratado');
    router.push('/prototipo/sala');
  }

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 sm:text-3xl">
          Contrata escribiendo una frase
        </h1>
        <p className="mt-2 max-w-2xl text-neutral-700">
          No hay formularios ni catálogos. Dime qué necesitas con tus palabras y te devuelvo una
          propuesta completa. Nada se crea hasta que la confirmes.
        </p>
      </header>

      <Tarjeta titulo="Qué necesitas" nivel={2}>
        <div className="flex flex-col gap-4">
          <Campo
            id="frase"
            etiqueta="Escríbelo con tus palabras"
            valor={frase}
            onCambio={setFrase}
            marcador="Contrata un agente de conciliación en Finanzas"
            ayuda="Prueba también con algo que no exista o con algo que mueva dinero, para ver qué contesto."
            data-testid="campo-frase"
          />
          <div className="flex flex-wrap gap-2">
            <Boton onClick={() => proponer(frase)} cargando={pensando} data-testid="proponer">
              Ver la propuesta
            </Boton>
            {FRASES_DE_EJEMPLO.map((ejemplo, indice) => (
              <Boton
                key={ejemplo}
                tono="secundario"
                onClick={() => proponer(ejemplo)}
                data-testid={`ejemplo-${indice}`}
              >
                {ejemplo}
              </Boton>
            ))}
          </div>
        </div>
      </Tarjeta>

      {respuesta === null ? (
        <Aviso
          tipo="vacio"
          titulo="Todavía no me has pedido nada"
          data-testid="estado-vacio"
          accion={
            <Boton tono="secundario" onClick={() => proponer(FRASES_DE_EJEMPLO[0])}>
              Usar la frase de ejemplo
            </Boton>
          }
        >
          <p>
            Escribe arriba qué necesitas, o usa una de las frases de ejemplo. Mientras no lo hagas,
            no hay nada que enseñarte: no invento propuestas.
          </p>
        </Aviso>
      ) : null}

      {respuesta?.veredicto === 'no-reconocida' ? (
        <Aviso
          tipo="error"
          titulo="No sé hacer eso todavía"
          data-testid="estado-error"
          accion={
            <>
              <Boton tono="secundario" onClick={() => proponer(FRASES_DE_EJEMPLO[0])}>
                Probar con conciliación
              </Boton>
              <Boton tono="secundario" onClick={() => setRespuesta(null)}>
                Escribir otra cosa
              </Boton>
            </>
          }
        >
          <p>{respuesta.motivo}</p>
        </Aviso>
      ) : null}

      {respuesta?.veredicto === 'necesita-persona' ? (
        <Aviso
          tipo="necesita-persona"
          titulo="Eso no lo hace ningún agente"
          data-testid="estado-necesita-persona"
          accion={
            <>
              <Boton tono="secundario" onClick={() => proponer(FRASES_DE_EJEMPLO[0])}>
                Ver lo que sí puedo hacer
              </Boton>
              <Boton tono="secundario" onClick={() => setRespuesta(null)}>
                Escribir otra cosa
              </Boton>
            </>
          }
        >
          <p>{respuesta.motivo}</p>
          <p className="mt-2">
            Lo que sí puedo: preparar la remesa o la propuesta de pago con todo el detalle, dejarla
            lista y avisarte. La ejecutas tú en el banco, con tus credenciales.
          </p>
        </Aviso>
      ) : null}

      {respuesta?.veredicto === 'propuesta' ? (
        <>
          <Tarjeta
            titulo={`${puesto.puesto} · ${puesto.departamento}`}
            nivel={2}
            descripcion={puesto.mision}
            data-testid="propuesta"
            cabecera={
              <>
                <Insignia etiqueta="Coste" valor={`${puesto.costeMensualEuros} € al mes`} />
                <Insignia etiqueta="Tareas" valor={`${puesto.tareasAlMes} al mes`} />
                <Insignia etiqueta="Estado" valor="Propuesto" tono="aviso" />
              </>
            }
            pie={
              <div className="flex flex-col gap-3">
                <p className="text-sm text-neutral-700">
                  Al confirmar, el puesto queda en periodo de prueba de 30 días con supervisión
                  humana. Contratar no consume tareas y se deshace en un clic.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Boton onClick={contratar} data-testid="contratar">
                    {contratado ? 'Seguir a la sala' : 'Contratar y arrancar en prueba'}
                  </Boton>
                  <Boton tono="secundario" onClick={() => setRespuesta(null)}>
                    Ahora no
                  </Boton>
                </div>
              </div>
            }
          >
            <div className="flex flex-col gap-6">
              <section>
                <h3 className="text-sm font-semibold text-neutral-900">Qué va a poder tocar</h3>
                <ul className="mt-2 flex flex-col gap-2 text-sm text-neutral-700">
                  {puesto.herramientas.map((herramienta) => (
                    <li key={herramienta.conector}>
                      <strong className="text-neutral-900">{herramienta.conector}.</strong>{' '}
                      {herramienta.operaciones}{' '}
                      <span className="text-neutral-500">({herramienta.clase})</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-sm text-neutral-500">
                  Lo que no está en esta lista, el puesto no lo ve. Las credenciales no entran nunca
                  en lo que lee el modelo.
                </p>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-neutral-900">Sus límites</h3>
                <ul className="mt-2 flex flex-col gap-2 text-sm text-neutral-700">
                  {puesto.guardrails.map((guardrail) => (
                    <li key={guardrail.riesgo} className="flex flex-wrap items-baseline gap-2">
                      <Insignia
                        etiqueta="Riesgo"
                        valor={guardrail.riesgo}
                        tono={
                          guardrail.riesgo === 'Crítico'
                            ? 'peligro'
                            : guardrail.riesgo === 'Alto'
                              ? 'aviso'
                              : 'neutro'
                        }
                      />
                      <span>{guardrail.limite}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-neutral-900">
                  Cuánta autonomía tiene, por clase de acción
                </h3>
                <ul className="mt-2 flex flex-col gap-2 text-sm text-neutral-700">
                  {puesto.niveles.map((nivel) => (
                    <li key={nivel.clase} className="flex flex-wrap items-baseline gap-2">
                      <Insignia
                        etiqueta={nivel.clase}
                        valor={nivel.nivel}
                        tono={nivel.nivel === 'N0' ? 'peligro' : 'neutro'}
                      />
                      <span>{nivel.detalle}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-neutral-900">Cuándo te va a llamar</h3>
                <p className="mt-2 text-sm text-neutral-700">{puesto.escalaCuando}</p>
                <p className="mt-2 text-sm text-neutral-700">
                  <strong className="text-neutral-900">Cómo nace su trabajo:</strong>{' '}
                  {puesto.comoNaceLaTarea}
                </p>
              </section>

              <Porque id="porque-propuesta">
                <p>{respuesta.motivo}</p>
                <p className="mt-2">
                  He elegido este puesto porque tu frase habla de conciliación y el departamento de
                  finanzas ya existe en tu organización. Los límites y los niveles no los he
                  inventado: son los de la plantilla del puesto, y puedes cambiarlos antes de
                  confirmar o después.
                </p>
              </Porque>
            </div>
          </Tarjeta>
        </>
      ) : null}
    </>
  );
}
