/**
 * Arranca el conector de demostración como servidor MCP por entrada y salida
 * estándar. Es lo que consume el Compose de desarrollo en la demostración.
 *
 * La credencial llega por `DEMO_CONECTOR_SECRETO`, igual que la recibiría del
 * gestor de secretos: el proceso no acepta ninguna por argumento de línea de
 * mandatos, porque los argumentos se ven en la lista de procesos.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { VARIABLE_SECRETO_DEMO, crearServidorDemo } from './servidor.js';

const credencial = process.env[VARIABLE_SECRETO_DEMO] ?? '';
if (credencial === '') {
  console.error(
    `Falta ${VARIABLE_SECRETO_DEMO} en el entorno. Copia .env.example a .env con ` +
      '`pnpm dev:up`, que sustituye cada GENERAR por un valor aleatorio local.',
  );
  process.exit(1);
}

const { servidor } = crearServidorDemo({ credencial, credencialEsperada: credencial });
await servidor.connect(new StdioServerTransport());

// La salida estándar es el canal del protocolo: cualquier traza va al error.
console.error('[@aiw/connector-demo] servidor MCP escuchando por entrada estándar.');
