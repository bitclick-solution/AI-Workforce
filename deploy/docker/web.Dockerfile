# syntax=docker/dockerfile:1.7
# Imagen del panel (Next.js en modo standalone).
# Uso: docker build -f deploy/docker/web.Dockerfile -t aiw/web .
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

FROM base AS pruner
WORKDIR /repo
COPY . .
RUN pnpm dlx turbo@2 prune "@aiw/web" --docker

FROM base AS builder
WORKDIR /repo
COPY --from=pruner /repo/out/json/ ./
# turbo prune no copia los ficheros raíz que no son del workspace.
COPY --from=pruner /repo/tsconfig.base.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm turbo run build --filter="@aiw/web"

FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
RUN addgroup -S aiw && adduser -S aiw -G aiw
COPY --from=builder --chown=aiw:aiw /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=aiw:aiw /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=aiw:aiw /repo/apps/web/public ./apps/web/public
USER aiw
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
