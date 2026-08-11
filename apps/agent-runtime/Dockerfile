# syntax=docker/dockerfile:1
# Build context must be the monorepo root: docker build -f apps/agent-runtime/Dockerfile .
# Needs /var/run/docker.sock bind-mounted at run time (ECS EC2 task, not Fargate) —
# eve's docker() sandbox backend drives the host's Docker daemon via the `docker` CLI.

FROM node:24-alpine AS pruner
WORKDIR /repo
RUN npm i -g turbo
COPY . .
RUN turbo prune @foundry/agent-runtime --docker

FROM node:24-alpine AS builder
WORKDIR /repo
# python3/make/g++: node-pty (runtime-core's real PTY backend) has no
# prebuilt binary for linux-musl, so `npm install` compiles it from source
# here via node-gyp — same reason node-pty needed a script-approval step
# locally, just without an interactive gate to get past inside a clean
# Docker build.
RUN apk add --no-cache python3 make g++
COPY --from=pruner /repo/out/json/ .
RUN npm install
COPY --from=pruner /repo/out/full/ .
RUN npx turbo run build --filter=@foundry/agent-runtime

FROM node:24-alpine AS runner
WORKDIR /repo
ENV NODE_ENV=production
# docker CLI only — talks to the host daemon through the mounted socket, doesn't run one itself
RUN apk add --no-cache docker-cli

COPY --from=builder /repo/apps/agent-runtime/.output ./apps/agent-runtime/.output
COPY --from=builder /repo/apps/agent-runtime/node_modules ./apps/agent-runtime/node_modules
COPY --from=builder /repo/apps/agent-runtime/package.json ./apps/agent-runtime/package.json
COPY --from=builder /repo/apps/agent-runtime/start.mjs ./apps/agent-runtime/start.mjs
# runtime-core/server.ts runs as raw TS via tsx (not part of eve's own
# .output bundle), and it imports ops-manager's tool files directly out of
# agent/subagents — both need to exist as real files at container runtime,
# not just at build time.
COPY --from=builder /repo/apps/agent-runtime/runtime-core ./apps/agent-runtime/runtime-core
COPY --from=builder /repo/apps/agent-runtime/agent ./apps/agent-runtime/agent
# node-pty's prebuilt/compiled helper binary sometimes loses its execute
# bit across the layer copy (the same issue hit locally, root-caused to
# non-executable spawn-helper files) — cheap, idempotent insurance.
RUN find /repo/apps/agent-runtime/node_modules/node-pty -name "spawn-helper" -exec chmod +x {} \; 2>/dev/null || true

WORKDIR /repo/apps/agent-runtime
EXPOSE 3000
EXPOSE 3313
ENV PORT=3000
ENV RUNTIME_CORE_PORT=3313
CMD ["node", "start.mjs"]
