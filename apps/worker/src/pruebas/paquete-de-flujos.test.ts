/**
 * El paquete de flujos se empaqueta y respeta el aislamiento de Temporal.
 *
 * Esta prueba no necesita servidor de Temporal: `bundleWorkflowCode` empaqueta el
 * código de flujo con las mismas restricciones que aplicará el trabajador. Si el
 * bucle importara algo que no se puede ejecutar en el entorno aislado —el sistema
 * de ficheros, una conexión, el reloj del sistema—, falla aquí y no en la
 * demostración del viernes.
 *
 * Es la prueba más barata de esta rebanada y la que más pronto avisa: el error
 * típico al escribir un flujo es importar por error un módulo de actividades.
 */
import { bundleWorkflowCode } from '@temporalio/worker';
import { describe, expect, it } from 'vitest';

import { RUTA_FLUJOS } from '../trabajador.js';

describe('paquete de flujos', () => {
  it('se empaqueta sin arrastrar nada que el entorno aislado no permita', async () => {
    const { code } = await bundleWorkflowCode({ workflowsPath: RUTA_FLUJOS });

    expect(code.length).toBeGreaterThan(1000);
    // Los dos flujos de la rebanada están en el paquete.
    expect(code).toContain('tareaAgente');
    expect(code).toContain('delegacion');
    // Y el motor de políticas viaja con ellos: la decisión se toma en el flujo, no
    // en una actividad, así que queda en el historial de Temporal.
    expect(code).toContain('decidirPaso');
  }, 240_000);
});
