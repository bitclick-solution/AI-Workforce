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
