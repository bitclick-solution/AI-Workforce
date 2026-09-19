VIGENTE

# Especificación · Monorepo, integración continua y Compose base

- Rebanada: [Notion](https://app.notion.com/p/3e05306618988159a779d6370b3a06a8) · Ciclo 0 · Tipo Plataforma · Paquetes deploy, docs · P0
- Rama: `rebanada/monorepo-ci-compose`
- Plan de referencia: [Plan de construcción v8](https://claude.ai/artifact/Mf7PeYbaXCnp5wFhQu3XWn), secciones _Stack_, _Estructura del monorepo_, _Cómo llevarlo a cabo_ y _Definición de hecho_.
- Zona crítica: no. `CODEOWNERS` declara las zonas críticas para las rebanadas siguientes.

## Objetivo

Dejar el repositorio listo para que cada rebanada posterior añada código sobre una base común: estructura del plan, tooling de TypeScript estricto, pipeline en verde y un entorno de desarrollo que arranca con un solo comando. Sin lógica de negocio.

## Paquetes tocados

Todos, pero solo con su esqueleto: `apps/{web,api,worker,platform-agents,channels}`, `connectors/{odoo,factusol}`, `services/{pii,documents}`, `packages/{domain,models,mcp-gateway,learning,knowledge,metrics,notifications,rooms,ledger,evals,ui}`, `deploy/compose`, `docs/{adr,prd,specs}`.

## Criterios de hecho

1. `pnpm install` en Node 22 instala el workspace completo con pnpm y Turborepo.
2. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm evals:smoke` y `pnpm build` terminan en verde en local y en GitHub Actions.
3. `pnpm e2e` ejecuta Playwright contra `apps/web` y comprueba la página de inicio.
4. GitHub Actions construye una imagen por aplicación sin publicarla.
5. `pnpm dev:up` genera `.env` a partir de `.env.example`, arranca PostgreSQL 16 con pgvector, Temporal con su interfaz, Centrifugo, Langfuse y MinIO, y espera a que estén sanos.
6. `.env.example` no contiene ningún valor real; los secretos se generan en local.
7. `CODEOWNERS` cubre las siete zonas críticas del plan y la plantilla de PR incluye la definición de hecho como lista.
8. `README.md` explica requisitos, arranque, comandos y estructura.

## Casos de prueba

- Unitario por paquete: cada paquete expone su nombre y responsabilidad (`src/index.test.ts`).
- Eval de humo: `packages/evals` ejecuta un caso dorado determinista sin llamar a ningún modelo.
- Extremo a extremo: Playwright abre `/` y encuentra el encabezado "AI Workforce".
- Secretos: gitleaks recorre el repositorio en CI y falla si detecta una credencial.
- Compose: `docker compose config` valida el fichero; el arranque completo se verifica en el equipo de Jesús porque este entorno no tiene demonio de Docker.

## Fuera de alcance

Tailwind avanzado y shadcn/ui, Better Auth, Drizzle y migraciones, flujos de Temporal, servidor MCP, despliegue a staging, bundle on-premise, workflow de publicación de Changesets. Cada uno tiene su rebanada.

## Presupuesto de tokens

Presupuesto: 40 €. Consumo real estimado al abrir el PR: ver la rebanada en Notion.
