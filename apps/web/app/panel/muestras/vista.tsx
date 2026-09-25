'use client';

/**
 * Página de muestras: todos los componentes de `@aiw/ui` en los dos modos.
 * Es la referencia visual del sistema «Oficina cercana» (ADR-020), no una
 * pantalla de producto: no lleva bandera de funcionalidad.
 */
import { useState } from 'react';

import {
  AvatarDeAgente,
  AvatarDePersona,
  Aviso,
  AvisoDeAprobacion,
  Boton,
  Campo,
  Estado,
  Indicador,
  Insignia,
  ListaDeAvisos,
  Porque,
  Tarjeta,
  TarjetaDeWidget,
  type ColorDeAvatar,
  type PuestoConEmblema,
} from '@aiw/ui';

type Modo = 'sistema' | 'claro' | 'oscuro';

const PUESTOS: { puesto: PuestoConEmblema; nombre: string; color: ColorDeAvatar }[] = [
  { puesto: 'cobros', nombre: 'Cobros', color: 'melocoton' },
  { puesto: 'conciliacion', nombre: 'Conciliación', color: 'menta' },
  { puesto: 'prevision', nombre: 'Previsión', color: 'cielo' },
  { puesto: 'moderador', nombre: 'Moderador', color: 'limon' },
  { puesto: 'director-ia', nombre: 'Director de IA', color: 'lila' },
];

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-titulos text-xl font-semibold text-texto">{titulo}</h2>
      {children}
    </section>
  );
}

export function VistaDeMuestras() {
  const [modo, establecerModo] = useState<Modo>('sistema');
  const [texto, establecerTexto] = useState('');

  const elegirModo = (siguiente: Modo) => {
    establecerModo(siguiente);
    if (siguiente === 'sistema') {
      delete document.documentElement.dataset['tema'];
    } else {
      document.documentElement.dataset['tema'] = siguiente;
    }
  };

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-texto text-xs font-medium uppercase tracking-widest text-texto-3">
            Sistema de diseño
          </p>
          <h1 className="font-titulos text-3xl font-bold text-texto">Oficina cercana</h1>
        </div>
        <div className="flex gap-2" role="group" aria-label="Modo de color">
          {(['sistema', 'claro', 'oscuro'] as const).map((opcion) => (
            <Boton
              key={opcion}
              tono={modo === opcion ? 'primario' : 'secundario'}
              onClick={() => {
                elegirModo(opcion);
              }}
              aria-pressed={modo === opcion}
            >
              {opcion === 'sistema' ? 'Sistema' : opcion === 'claro' ? 'Claro' : 'Oscuro'}
            </Boton>
          ))}
        </div>
      </header>

      <Seccion titulo="Avatares de agente">
        <div className="flex flex-wrap gap-6">
          {PUESTOS.map(({ puesto, nombre, color }) => (
            <div key={puesto} className="flex flex-col items-center gap-2">
              <AvatarDeAgente nombre={nombre} puesto={puesto} color={color} gesto="alegre" />
              <span className="text-xs text-texto-2">{nombre}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-6">
          <div className="flex flex-col items-center gap-2">
            <AvatarDeAgente
              nombre="Cobros"
              puesto="cobros"
              color="melocoton"
              estado="te-necesita"
            />
            <span className="text-xs text-texto-2">Te necesita</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <AvatarDeAgente
              nombre="Conciliación"
              puesto="conciliacion"
              color="menta"
              estado="trabajando"
            />
            <span className="text-xs text-texto-2">Trabajando</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <AvatarDeAgente
              nombre="Previsión"
              puesto="prevision"
              color="cielo"
              estado="en-espera"
            />
            <span className="text-xs text-texto-2">En espera</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <AvatarDeAgente
              nombre="Cobros"
              puesto="cobros"
              color="rosa"
              gesto="sereno"
              tamano="grande"
            />
            <span className="text-xs text-texto-2">Sereno · grande</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <AvatarDeAgente
              nombre="Cobros"
              puesto="cobros"
              color="rosa"
              gesto="concentrado"
              tamano="pequeno"
            />
            <span className="text-xs text-texto-2">Concentrado · pequeño</span>
          </div>
        </div>
      </Seccion>

      <Seccion titulo="Avatares de persona">
        <div className="flex flex-wrap gap-6">
          <div className="flex flex-col items-center gap-2">
            <AvatarDePersona nombre="Jesús Ortega" />
            <span className="text-xs text-texto-2">Con iniciales</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <AvatarDePersona nombre="" estado="te-necesita" />
            <span className="text-xs text-texto-2">Silueta · te necesita</span>
          </div>
        </div>
      </Seccion>

      <Seccion titulo="Botones">
        <div className="flex flex-wrap items-center gap-3">
          <Boton tono="primario">Aprobar</Boton>
          <Boton tono="secundario">Descartar</Boton>
          <Boton tono="peligro">Despedir</Boton>
          <Boton tono="primario" cargando>
            Contratando
          </Boton>
        </div>
      </Seccion>

      <Seccion titulo="Insignias">
        <div className="flex flex-wrap gap-3">
          <Insignia etiqueta="Nivel" valor="N1 supervisado" tono="neutro" />
          <Insignia etiqueta="Estado" valor="Certificado" tono="exito" />
          <Insignia etiqueta="Coste" valor="0,42 €" tono="aviso" />
          <Insignia etiqueta="Riesgo" valor="Sin señal" tono="peligro" />
        </div>
      </Seccion>

      <Seccion titulo="Indicadores">
        <div className="grid gap-4 sm:grid-cols-4">
          <Indicador etiqueta="Tareas del periodo" valor="128" />
          <Indicador etiqueta="Certificados" valor="6 / 6" tono="exito" />
          <Indicador etiqueta="Coste de modelos" valor="14,80 €" tono="aviso" />
          <Indicador etiqueta="Facturas vencidas" valor="3" tono="peligro" ayuda="Más de 30 días" />
        </div>
      </Seccion>

      <Seccion titulo="Campo">
        <div className="flex max-w-sm flex-col gap-4">
          <Campo
            id="muestra-nota"
            etiqueta="Nota de seguimiento"
            valor={texto}
            onCambio={establecerTexto}
            opcional
          />
          <Campo
            id="muestra-error"
            etiqueta="IBAN"
            valor="ES00"
            onCambio={() => undefined}
            error="Le faltan dígitos."
          />
        </div>
      </Seccion>

      <Seccion titulo="Avisos">
        <div className="flex flex-col gap-3">
          <Aviso tipo="vacio" titulo="Todavía no hay agentes" accion={<Boton>Contratar</Boton>} />
          <Aviso
            tipo="error"
            titulo="El ERP no responde"
            accion={<Boton tono="secundario">Reintentar</Boton>}
          />
          <Aviso tipo="informacion" titulo="El presupuesto va al 60 %" />
          <AvisoDeAprobacion
            titulo="Contratar a Cobros en Finanzas"
            quienLoPide={
              <AvatarDeAgente
                nombre="Director de IA"
                puesto="director-ia"
                color="lila"
                tamano="pequeno"
              />
            }
            alAprobar={() => undefined}
            alRechazar={() => undefined}
          >
            12 € al mes · unas 40 tareas.
          </AvisoDeAprobacion>
        </div>
      </Seccion>

      <Seccion titulo="Lista de avisos">
        <ListaDeAvisos titulo="Te necesitan">
          <AvisoDeAprobacion titulo="El cliente disputa la factura 204" alAprobar={() => undefined}>
            Necesita que abras la conversación.
          </AvisoDeAprobacion>
          <Aviso
            tipo="necesita-persona"
            titulo="IBAN nuevo sin confirmar"
            accion={<Boton>Abrirlo yo</Boton>}
          />
        </ListaDeAvisos>
      </Seccion>

      <Seccion titulo="Tarjetas">
        <div className="grid gap-4 sm:grid-cols-2">
          <Tarjeta titulo="Equipo de Finanzas" descripcion="3 agentes · 1 persona">
            <p className="text-sm text-texto-2">Cobros, Conciliación y Previsión.</p>
          </Tarjeta>
          <TarjetaDeWidget
            titulo="Coste del mes"
            descripcion="Modelos + herramientas"
            alQuitar={() => undefined}
          >
            <p className="text-2xl font-semibold text-texto">64,20 €</p>
          </TarjetaDeWidget>
        </div>
      </Seccion>

      <Seccion titulo="Por qué lo hice">
        <Porque id="muestra-porque">
          Doce facturas vencidas de menos de 30 días: la política N1 permite la nota de seguimiento
          sin aprobación.
        </Porque>
      </Seccion>

      <Seccion titulo="Estado">
        <Estado titulo="Sin conexión con Factusol">
          Reintenta en cinco minutos o revisa las credenciales del conector.
        </Estado>
      </Seccion>
    </main>
  );
}
