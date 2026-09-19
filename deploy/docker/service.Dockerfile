# syntax=docker/dockerfile:1.7
# Imagen de una aplicación Node del monorepo (api, worker, platform-agents, channels).
# Uso: docker build -f deploy/docker/service.Dockerfile --build-arg APP=api -t aiw/api .
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# Recorta el monorepo a lo que necesita la aplicación.
FROM base AS pruner
ARG APP
WORKDIR /repo
COPY . .
RUN pnpm dlx turbo@2 prune "@aiw/${APP}" --docker

# Instala dependencias y construye.
FROM base AS builder
ARG APP
WORKDIR /repo
COPY --from=pruner /repo/out/json/ ./
# turbo prune no copia los ficheros raíz que no son del workspace.
COPY --from=pruner /repo/tsconfig.base.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ ./
RUN pnpm turbo run build --filter="@aiw/${APP}"
RUN pnpm --filter="@aiw/${APP}" deploy --prod --legacy /out

# Imagen final: sin herramientas de build, usuario sin privilegios.
FROM ${NODE_IMAGE} AS runner
ARG APP
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S aiw && adduser -S aiw -G aiw
COPY --from=builder --chown=aiw:aiw /out/package.json ./package.json
COPY --from=builder --chown=aiw:aiw /out/dist ./dist
COPY --from=builder --chown=aiw:aiw /out/node_modules ./node_modules
USER aiw
CMD ["node", "dist/main.js"]
