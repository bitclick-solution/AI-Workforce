import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Imagen autocontenida para el bundle SaaS y on-premise.
  output: 'standalone',
  outputFileTracingRoot: raiz,
  // Los paquetes internos se exportan como TypeScript.
  transpilePackages: ['@aiw/ui'],
};

export default nextConfig;
