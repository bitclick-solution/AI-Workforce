import { AnthropicBedrockMantle } from '@anthropic-ai/bedrock-sdk';
import { afterEach, describe, expect, it } from 'vitest';

import {
  iniciarServidorSimulado,
  respuestaDeTexto,
  type ServidorSimulado,
} from '../pruebas/servidor-simulado.js';
import { crearAdaptadorAnthropic } from './anthropic.js';
import {
  clienteBedrockDesdeEntorno,
  clientePrimeraParteDesdeEntorno,
  clienteVertexDesdeEntorno,
} from './clientes.js';

/**
 * Prueba que el cliente real de Bedrock —el que se usará en cuanto haya
 * credenciales de la UE— habla la misma forma de la API de Mensajes que el cliente
 * simulado: apuntado al servidor simulado y con `skipAuth`, sin AWS detrás, el
 * adaptador funciona igual. Lo único que falta para lo real es la credencial, no el
 * código.
 *
 * El cliente de Vertex no se prueba aquí de la misma forma: su SDK resuelve
 * credenciales de Google incluso con un `accessToken` de mentira (intenta
 * `Application Default Credentials` igualmente), así que un `accessToken` falso no
 * basta para desviarlo de la nube real. `clienteVertexDesdeEntorno` sigue
 * construyendo el cliente real igual que `clienteBedrockDesdeEntorno`; la prueba de
 * que las dos plataformas comparten adaptador la da `anthropic.test.ts`, que ejercita
 * la misma lógica con el cliente simulado bajo `plataforma: 'vertex-eu'`.
 */
describe('clientes reales contra el servidor simulado', () => {
  let servidor: ServidorSimulado | undefined;

  afterEach(async () => {
    await servidor?.cerrar();
    servidor = undefined;
  });

  it('el cliente de Bedrock (skipAuth) completa contra el simulado', async () => {
    servidor = await iniciarServidorSimulado(respuestaDeTexto('hola desde bedrock'));
    const cliente = new AnthropicBedrockMantle({
      awsRegion: 'eu-central-1',
      baseURL: servidor.url,
      skipAuth: true,
    });
    const puerto = crearAdaptadorAnthropic(cliente, {
      papel: 'sonnet5',
      plataforma: 'bedrock-eu',
      configuracion: { esfuerzoPorClasePaso: {} },
    });

    const resultado = await puerto.completar({
      clasePaso: 'negocio',
      mensajes: [{ rol: 'user', contenido: 'hola' }],
    });
    expect(resultado.tipo).toBe('ok');
  });

  it('las tres fábricas de cliente real fallan con el nombre exacto de lo que falta', () => {
    expect(() => clienteBedrockDesdeEntorno({})).toThrow(/AIW_BEDROCK_REGION_UE/);
    expect(() => clienteVertexDesdeEntorno({})).toThrow(/AIW_VERTEX_REGION_UE/);
    expect(() => clientePrimeraParteDesdeEntorno({})).toThrow(/ANTHROPIC_API_KEY/);
  });
});
