import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

import { origenesDeDesarrollo } from './lib/origenes-dev';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // No generamos AGENTS.md/CLAUDE.md: este repo ya tiene los suyos, y no se
  // tocan sin rebanada y aprobación de Jesús.
  agentRules: false,
  // Imagen autocontenida para el bundle SaaS y on-premise.
  output: 'standalone',
  outputFileTracingRoot: raiz,
  // Los paquetes internos se exportan como TypeScript.
  transpilePackages: ['@aiw/ui'],
  // Para poder abrir el prototipo en un teléfono real por la IP del portátil.
  // Sin esto, `next dev` sirve el HTML pero devuelve 403 en los ficheros de
  // JavaScript, React no hidrata y ningún botón responde. Solo afecta a
  // desarrollo. Con `AIW_DEV_ORIGENES` se añaden túneles (ngrok, Tailscale).
  allowedDevOrigins: origenesDeDesarrollo(networkInterfaces(), process.env['AIW_DEV_ORIGENES']),
};

export default nextConfig;
