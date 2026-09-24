/**
 * Arranca el conector de demostración como servidor MCP.
 *
 *   pnpm --filter @aiw/connector-demo servir            # entrada y salida estándar
 *   pnpm --filter @aiw/connector-demo servir --http     # HTTP transmisible
 *
 * La credencial llega por `DEMO_CONECTOR_SECRETO`, igual que la recibiría del
 * gestor de secretos: cuando el gateway lanza este proceso, la inyecta en su
 * entorno. El proceso no acepta ninguna credencial por argumento de línea de
 * mandatos, porque los argumentos se ven en la lista de procesos de la máquina.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { servirDemoPorHttp } from './http.js';
import { VARIABLE_SECRETO_DEMO, crearServidorDemo } from './servidor.js';

const credencial = process.env[VARIABLE_SECRETO_DEMO] ?? '';
if (credencial === '') {
  console.error(
    `Falta ${VARIABLE_SECRETO_DEMO} en el entorno. Copia .env.example a .env con ` +
      '`pnpm dev:up`, que sustituye cada GENERAR por un valor aleatorio local.',
  );
  process.exit(1);
}

const fallos = Number(process.env['DEMO_CONECTOR_FALLOS'] ?? '0');
const comun = {
  credencial,
  credencialEsperada: credencial,
  ...(Number.isInteger(fallos) && fallos > 0 ? { fallosIniciales: fallos } : {}),
};

if (process.argv.includes('--http')) {
  const puerto = Number(process.env['DEMO_CONECTOR_PUERTO'] ?? '4020');
  const servido = await servirDemoPorHttp({ ...comun, puerto });
  console.error(`[@aiw/connector-demo] servidor MCP escuchando en ${servido.url}`);
  const apagar = () => void servido.cerrar().then(() => process.exit(0));
  process.on('SIGINT', apagar);
  process.on('SIGTERM', apagar);
} else {
  const { servidor } = crearServidorDemo(comun);
  await servidor.connect(new StdioServerTransport());
  // La salida estándar es el canal del protocolo: cualquier traza va al error.
  console.error('[@aiw/connector-demo] servidor MCP escuchando por entrada estándar.');
}
