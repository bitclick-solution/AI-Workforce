# AI Workforce

Plataforma de equipos de agentes de IA de Bitclick Solutions: se contratan como a una persona, trabajan dentro de los sistemas de la organización, piden permiso antes de tocar nada importante, aprenden de cada decisión y dejan constancia de todo.

- Plan de construcción: [versión 8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn). El plan decide la arquitectura; el código la ejecuta.
- Tablero de dirección: [Notion › AI Workforce](https://app.notion.com/p/3e0530661898811a812ffdd5052b466b). Una rebanada por rama y por PR.
- Análisis de mercado: [AI Workforce para pymes](https://claude.ai/artifact/UoeoZJypNMJAxQB9Fs9TfY).

## Requisitos previos

- Node 22 (`.node-version`) y pnpm 10. Con Corepack: `corepack enable`.
- Docker con Compose v2 para el entorno de desarrollo.
- Sin claves de proveedores: el arranque local no llama a ningún modelo.

## Arrancar

1. Instala las dependencias:

   ```bash
   pnpm install
   ```

2. Arranca la infraestructura de desarrollo. El comando crea `.env` a partir de `.env.example` con secretos aleatorios locales y levanta PostgreSQL 16 con pgvector, Temporal con su interfaz, Centrifugo, Langfuse y Silo (almacén S3):

   ```bash
   pnpm dev:up
   ```

   Al terminar imprime las URL locales. Langfuse queda en `http://localhost:3001` con el usuario `dev@aiworkforce.local` y la contraseña generada en `.env`.

3. Comprueba que todo está en verde:

   ```bash
   pnpm lint && pnpm typecheck && pnpm test && pnpm evals:smoke && pnpm build
   ```

4. Opcional: Ejecuta las pruebas de extremo a extremo del panel. Requiere `pnpm --filter @aiw/web build` y los navegadores de Playwright (`pnpm exec playwright install chromium`):

   ```bash
   pnpm e2e
   ```

Para parar la infraestructura conservando los datos: `pnpm dev:down`. Para borrar también los volúmenes: `pnpm dev:down --volumes`.

## Comandos

| Comando                           | Qué hace                                                  |
| --------------------------------- | --------------------------------------------------------- |
| `pnpm dev`                        | Arranca las aplicaciones en modo desarrollo con Turborepo |
| `pnpm lint` · `pnpm format:check` | ESLint y Prettier sobre todo el repositorio               |
| `pnpm typecheck`                  | `tsc` estricto por paquete                                |
| `pnpm test`                       | Vitest por paquete                                        |
| `pnpm evals:smoke`                | Evals de humo deterministas (`packages/evals/smoke`)      |
| `pnpm build`                      | Aplicaciones Node con tsup y el panel con Next.js         |
| `pnpm e2e`                        | Playwright contra el panel                                |
| `pnpm changeset`                  | Registra un cambio para las notas de versión              |

## Estructura

```
apps/
  web/              Next.js: panel, sala común, onboarding de contratación, aprobaciones móviles
  api/              API TypeScript: organizaciones, departamentos, puestos, versiones, políticas, contador, auditoría, servidor MCP
  worker/           Temporal: flujos de tarea, delegación, bucle del agente, aprendizaje programado
  platform-agents/  Moderador de sala, supervisor de departamento, Director de IA
  channels/         WhatsApp, correo, enlaces de aprobación
connectors/
  odoo/             Sobre el MCP dinámico existente, licencia revisada
  factusol/         Referencia al servicio Python existente, consumido como imagen
services/
  pii/              Detección de datos personales (Presidio), servicio aislado en Python
  documents/        OCR de respaldo y generación de PDF, servicio aislado en Python
packages/
  domain/           Entidades, políticas, niveles de autonomía, brand voice, riesgo, esquemas Zod
  models/           Enrutado sobre AI SDK, caché de prompts, coste por tarea
  mcp-gateway/      Cliente MCP, lista blanca por puesto y nivel, credenciales, registro
  learning/         Señales, lecciones, evaluación en sombra, promoción, versiones
  knowledge/        Índice de conocimiento, ingesta, grafo ligero, manual de la empresa
  metrics/          Definiciones de indicadores, materialización, umbrales
  notifications/    Bandeja, preferencias, plazos, suplencias
  rooms/            Salas, moderación, menciones, acuerdos
  ledger/           Libro de auditoría y contador
  evals/            Casos dorados por puesto y evaluadores
  ui/               Componentes compartidos
deploy/
  compose/          Desarrollo; base del on-premise Business y de la nube
  docker/           Dockerfiles de las aplicaciones
docs/
  adr/              Registros de decisiones (ADR-001 en adelante)
  prd/              Definición de producto y fichas
  specs/            Una especificación por rebanada
```

Los paquetes internos exportan TypeScript directamente; las aplicaciones Node los empaquetan con tsup y el panel con `transpilePackages`. Python solo existe en `services/` y en el conector de Factusol, como servicios aislados.

## Método

- Nadie trabaja en algo que no está en **Lista** en el tablero. Una rebanada, una rama `rebanada/<nombre>`, un PR con la especificación `docs/specs/<nombre>.md` escrita antes del código.
- Nada se fusiona sin CI en verde, veredicto del Revisor y la definición de hecho de la plantilla de PR rellena. En las zonas críticas de `.github/CODEOWNERS`, además, la aprobación de Jesús.
- Sin secretos reales en el repositorio, en prompts ni en registros. La CI ejecuta gitleaks en cada PR.
- Todo documento técnico empieza por su estado: `VIGENTE`, `SUPERSEDED por <ruta>`, `REGISTRO HISTÓRICO` o `LISTO PARA ENCARGO`.

## Integración continua

`.github/workflows/ci.yml` ejecuta en cada PR: lint y formato, tipos, pruebas, evals de humo, build, Playwright, búsqueda de secretos, arranque del Compose de desarrollo y construcción de una imagen por aplicación sin publicarla.
