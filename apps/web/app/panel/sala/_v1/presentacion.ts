/**
 * Del contrato de la sala a lo que pintan los componentes de `@aiw/ui`. Solo
 * presentación: textos, colores y cuentas. Ninguna regla de negocio.
 */
import { filtroDeEstado, type ColorDeAvatar, type MiembroVisible } from '@aiw/ui';

import type { CambioDeSala, MiembroDeSala } from '../../../../lib/sala-contrato';

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

/** «ahora», «15 min», «3 h», «ayer», «4 días». Sin fecha, nada. */
export function haceCuanto(desde: string | undefined, ahora: number): string | undefined {
  if (!desde) return undefined;
  const instante = Date.parse(desde);
  if (Number.isNaN(instante)) return undefined;
  const pasado = Math.max(0, ahora - instante);
  if (pasado < MINUTO) return 'ahora';
  if (pasado < HORA) return `${Math.floor(pasado / MINUTO)} min`;
  if (pasado < DIA) return `${Math.floor(pasado / HORA)} h`;
  const dias = Math.floor(pasado / DIA);
  return dias === 1 ? 'ayer' : `${dias} días`;
}

function detalleDe(miembro: MiembroDeSala, ahora: number): string | undefined {
  if (miembro.estado === 'en-la-sala' || miembro.estado === 'escribiendo') return undefined;
  const hace = haceCuanto(miembro.desde, ahora);
  if (!hace) return undefined;
  if (miembro.estado === 'anadido') {
    if (hace === 'ahora') return 'aún no ha entrado';
    return hace === 'ayer' ? 'sin conectar desde ayer' : `sin conectar hace ${hace}`;
  }
  return hace === 'ahora' ? 'ahora' : `hace ${hace}`;
}

const COLORES: readonly ColorDeAvatar[] = ['melocoton', 'menta', 'cielo', 'lila', 'limon', 'rosa'];

/** Color pastel estable por agente: sale de su identificador, no del azar. */
export function colorDeAgente(id: string): ColorDeAvatar {
  let suma = 0;
  for (const caracter of id) suma = (suma * 31 + caracter.charCodeAt(0)) >>> 0;
  return COLORES[suma % COLORES.length] ?? 'lila';
}

export function aMiembroVisible(
  miembro: MiembroDeSala,
  quienMira: string,
  ahora: number,
): MiembroVisible {
  const esTu = miembro.id === quienMira;
  const contexto = esTu
    ? [miembro.equipo, 'eres tú'].filter(Boolean).join(' · ')
    : miembro.tipo === 'persona'
      ? miembro.equipo
      : undefined;
  const detalle = detalleDe(miembro, ahora);
  return {
    id: miembro.id,
    tipo: miembro.tipo,
    nombre: miembro.nombre,
    estado: miembro.estado,
    ...(contexto ? { contexto } : {}),
    ...(detalle ? { detalle } : {}),
    ...(miembro.tipo === 'agente' ? { color: colorDeAgente(miembro.id) } : {}),
  };
}

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

/** «5 en la sala · 2 inactivos · 2 añadidos»: lo que se lee bajo la cabecera. */
export function resumenDePresencia(miembros: readonly MiembroDeSala[]): string {
  let sala = 0;
  let inactivos = 0;
  let anadidos = 0;
  for (const miembro of miembros) {
    const filtro = filtroDeEstado(miembro.estado);
    if (filtro === 'sala') sala += 1;
    else if (filtro === 'inactivos') inactivos += 1;
    else anadidos += 1;
  }
  return [
    `${sala} en la sala`,
    inactivos > 0 ? plural(inactivos, 'inactivo', 'inactivos') : '',
    anadidos > 0 ? plural(anadidos, 'añadido', 'añadidos') : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Aplica un cambio de presencia a la lista. Un miembro nuevo se añade al final. */
export function aplicarPresencia(
  miembros: readonly MiembroDeSala[],
  cambio: Extract<CambioDeSala, { tipo: 'presencia' }>,
): MiembroDeSala[] {
  const existe = miembros.some((miembro) => miembro.id === cambio.miembro.id);
  if (!existe) return [...miembros, cambio.miembro];
  return miembros.map((miembro) => (miembro.id === cambio.miembro.id ? cambio.miembro : miembro));
}

/** Nombres de quienes escriben ahora, sin contar a quien mira. */
export function escribiendoAhora(
  hastaPorMiembro: Readonly<Record<string, string>>,
  miembros: readonly MiembroDeSala[],
  quienMira: string,
  ahora: number,
): string[] {
  return miembros
    .filter((miembro) => miembro.id !== quienMira)
    .filter((miembro) => {
      const hasta = hastaPorMiembro[miembro.id];
      return hasta !== undefined && Date.parse(hasta) > ahora;
    })
    .map((miembro) => miembro.nombre);
}
