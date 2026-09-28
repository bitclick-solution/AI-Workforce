'use client';

/**
 * Página de muestras: todos los componentes de `@aiw/ui` en los dos modos.
 * Es la referencia visual del sistema «Oficina cercana» (ADR-020), no una
 * pantalla de producto: no lleva bandera de funcionalidad.
 */
import { useState } from 'react';

import {
  AvatarConPresencia,
  AvatarDeAgente,
  AvatarDePersona,
  Aviso,
  AvisoDeAprobacion,
  Boton,
  Campo,
  ESTADOS_DE_PRESENCIA,
  ESTADOS_SOLO_DE_AGENTE,
  Estado,
  EtiquetaIA,
  FilaDeMiembro,
  FilaDePresencia,
  HojaMovil,
  Indicador,
  IndicadorDeEscritura,
  MarcaDePresencia,
  NavegacionDeSalas,
  PanelDeMiembros,
  TarjetaDePropuesta,
  textoDePresencia,
  useTraduccion,
  Insignia,
  ListaDeAvisos,
  Porque,
  Tarjeta,
  TarjetaDeWidget,
  type ColorDeAvatar,
  type MiembroVisible,
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

/** Un miembro sintético por estado: los siete del ADR-022 en una sola muestra. */
const MIEMBROS_DE_MUESTRA: MiembroVisible[] = [
  {
    id: 'm1',
    tipo: 'persona',
    nombre: 'Lucía Ferrán',
    estado: 'en-la-sala',
    contexto: 'Gerencia · eres tú',
  },
  {
    id: 'm2',
    tipo: 'persona',
    nombre: 'Tomás Rivel',
    estado: 'inactivo',
    contexto: 'Administración',
    detalle: 'hace 15 min',
  },
  {
    id: 'm3',
    tipo: 'persona',
    nombre: 'Asesoría Olmo',
    estado: 'anadido',
    detalle: 'sin conectar desde ayer',
  },
  {
    id: 'm4',
    tipo: 'agente',
    nombre: 'Cobros',
    estado: 'te-necesita',
    color: 'melocoton',
    detalle: 'hace 6 min',
  },
  {
    id: 'm5',
    tipo: 'agente',
    nombre: 'Conciliación',
    estado: 'trabajando',
    color: 'menta',
    detalle: 'hace 12 min',
  },
  { id: 'm6', tipo: 'agente', nombre: 'Director de IA', estado: 'escribiendo', color: 'lila' },
  {
    id: 'm7',
    tipo: 'agente',
    nombre: 'Previsión',
    estado: 'en-pausa',
    color: 'cielo',
    detalle: 'hace 3 h',
  },
];

const SALAS_DE_MUESTRA = [
  { id: 'general', nombre: 'general', sinLeer: 0, menciones: 0 },
  { id: 'finanzas', nombre: 'finanzas', sinLeer: 0, menciones: 0 },
  { id: 'ventas', nombre: 'ventas-y-atención', sinLeer: 4, menciones: 2 },
  { id: 'marketing', nombre: 'marketing', sinLeer: 1, menciones: 0 },
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
  const [hojaAbierta, establecerHojaAbierta] = useState(false);
  const t = useTraduccion();

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

      <Seccion titulo="Presencia · marcas">
        <p className="text-sm text-texto-2">
          Cada estado cambia la forma de la marca y siempre lleva texto (ADR-022). Trabajando, te
          necesita y en pausa solo aplican a agentes.
        </p>
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-testid="muestra-presencia">
          {ESTADOS_DE_PRESENCIA.map((estado) => {
            const tipo = ESTADOS_SOLO_DE_AGENTE.includes(estado) ? 'agente' : 'persona';
            return (
              <li key={estado} className="flex items-center gap-3">
                <AvatarConPresencia
                  tipo={tipo}
                  nombre={tipo === 'agente' ? 'Cobros' : 'Lucía Ferrán'}
                  estado={estado}
                  color="melocoton"
                />
                <span className="flex items-center gap-2 text-sm text-texto">
                  <MarcaDePresencia estado={estado} />
                  {textoDePresencia(t, estado)}
                </span>
              </li>
            );
          })}
        </ul>
      </Seccion>

      <Seccion titulo="Fila de miembro y etiqueta IA">
        <div className="flex max-w-sm flex-col rounded-xl border border-linea bg-superficie p-2">
          {MIEMBROS_DE_MUESTRA.slice(0, 4).map((miembro) => (
            <FilaDeMiembro key={miembro.id} miembro={miembro} />
          ))}
        </div>
        <p className="flex items-center gap-2 text-sm text-texto">
          Cobros <EtiquetaIA />
        </p>
      </Seccion>

      <Seccion titulo="Panel de miembros">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-xl border border-linea bg-superficie p-4">
            <PanelDeMiembros miembros={MIEMBROS_DE_MUESTRA} />
          </div>
          <div className="rounded-xl border border-linea bg-superficie p-4">
            <PanelDeMiembros miembros={MIEMBROS_DE_MUESTRA} agrupar="estado" conFiltros={false} />
          </div>
        </div>
      </Seccion>

      <Seccion titulo="Navegación de salas">
        <div className="max-w-60 rounded-xl border border-linea bg-superficie p-3">
          <NavegacionDeSalas
            salas={SALAS_DE_MUESTRA}
            actual="finanzas"
            hrefDe={(id) => `#sala-${id}`}
            alElegir={() => undefined}
          />
        </div>
      </Seccion>

      <Seccion titulo="Indicador de escritura">
        <div className="flex flex-col gap-2 rounded-xl border border-linea bg-superficie p-4">
          <IndicadorDeEscritura nombres={['Cobros']} />
          <IndicadorDeEscritura nombres={['Cobros', 'Conciliación']} />
          <IndicadorDeEscritura nombres={['Cobros', 'Conciliación', 'Previsión']} />
        </div>
      </Seccion>

      <Seccion titulo="Móvil · fila de presencia y hoja">
        <div className="max-w-sm overflow-hidden rounded-xl border border-linea">
          <FilaDePresencia
            miembros={MIEMBROS_DE_MUESTRA}
            resumen="5 en la sala · 2 inactivos · 1 añadido"
            etiqueta="Ver miembros: 5 en la sala · 2 inactivos · 1 añadido"
            alAbrir={() => {
              establecerHojaAbierta(true);
            }}
          />
        </div>
        <HojaMovil
          abierta={hojaAbierta}
          titulo={`Miembros · ${MIEMBROS_DE_MUESTRA.length}`}
          alCerrar={() => {
            establecerHojaAbierta(false);
          }}
        >
          <PanelDeMiembros
            miembros={MIEMBROS_DE_MUESTRA}
            agrupar="estado"
            conFiltros={false}
            sinTitulo
          />
        </HojaMovil>
      </Seccion>

      <Seccion titulo="Tarjeta de propuesta">
        <TarjetaDePropuesta
          titulo="Contratar Previsión de tesorería"
          datos={[
            { etiqueta: 'Equipo y nivel', valor: 'Finanzas · N1, te pide permiso' },
            { etiqueta: 'Coste', valor: 'Unos 50 € al mes, dentro del plan' },
            { etiqueta: 'Herramientas', valor: 'ERP y banco, solo lectura' },
            { etiqueta: 'Se deshace', valor: 'Despidiéndolo desde Equipo' },
          ]}
          acciones={<Boton>Contratar</Boton>}
        />
      </Seccion>

      <Seccion titulo="Estado">
        <Estado titulo="Sin conexión con Factusol">
          Reintenta en cinco minutos o revisa las credenciales del conector.
        </Estado>
      </Seccion>
    </main>
  );
}
