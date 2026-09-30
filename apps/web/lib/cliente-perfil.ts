'use client';

/** Cambia el ajuste de presencia del perfil (ADR-026) desde el navegador. */
export interface ResultadoDePerfil {
  fallo?: string;
}

export async function actualizarPresencia(mostrarPresencia: boolean): Promise<ResultadoDePerfil> {
  try {
    const respuesta = await fetch('/api/perfil', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mostrarPresencia }),
    });
    if (!respuesta.ok) return { fallo: 'No se pudo guardar el ajuste. Vuelve a intentarlo.' };
    return {};
  } catch {
    return { fallo: 'No se pudo guardar el ajuste. Vuelve a intentarlo.' };
  }
}

/**
 * Disposición del panel de widgets del inicio: qué widgets, en qué orden, con qué
 * tamaño y cuáles ocultos, por persona (rebanada «Inicio: widgets, agentes en
 * tiempo real y avisos a la derecha»). Comparte ruta con la presencia: los dos son
 * «cómo ve esta persona el panel».
 */
export interface EntradaDeDisposicionDelPerfil {
  id: string;
  tamano: 'pequeno' | 'mediano' | 'grande';
  oculto: boolean;
}

export async function leerDisposicionPanel(): Promise<EntradaDeDisposicionDelPerfil[]> {
  try {
    const respuesta = await fetch('/api/perfil', { cache: 'no-store' });
    if (!respuesta.ok) return [];
    const cuerpo = (await respuesta.json()) as { disposicionPanel?: unknown };
    return Array.isArray(cuerpo.disposicionPanel)
      ? (cuerpo.disposicionPanel as EntradaDeDisposicionDelPerfil[])
      : [];
  } catch {
    return [];
  }
}

export async function guardarDisposicionPanel(
  disposicionPanel: EntradaDeDisposicionDelPerfil[],
): Promise<ResultadoDePerfil> {
  try {
    const respuesta = await fetch('/api/perfil', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ disposicionPanel }),
    });
    if (!respuesta.ok) return { fallo: 'No se pudo guardar la disposición del panel.' };
    return {};
  } catch {
    return { fallo: 'No se pudo guardar la disposición del panel.' };
  }
}
