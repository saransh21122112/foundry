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
# bash: runtime-core/server.ts's live terminal spawns $SHELL, defaulting
# to "bash" — alpine's base image only ships ash/sh, no bash, so every
# real terminal connection failed with "execvp(3) failed: No such file or
# directory" (confirmed live). A real terminal should behave like a real
# shell (history, completion) rather than silently downgrading to sh.
# docker CLI, for the same reason as before — talks to the host daemon through the mounted socket, doesn't run one itself
RUN apk add --no-cache docker-cli bash

# This is an npm workspace monorepo — `npm install` at the repo root
# hoists any dependency that doesn't conflict across workspaces up to
# /repo/node_modules instead of leaving it under the per-app node_modules.
# tsx, node-pty, and ws (all needed by runtime-core/server.ts and
# start.mjs) all landed there, not in apps/agent-runtime/node_modules —
# confirmed live (2026-08-11): the container crashed on startup with
# `Cannot find package 'tsx'` because only the per-app node_modules was
# ever copied into the runner stage. Copy the root one too so Node's
# normal module-resolution walk-up actually finds them.
COPY --from=builder /repo/node_modules ./node_modules
# Workspace packages (@foundry/db, @foundry/guardrails, @foundry/
# shared-types, @foundry/agent-runtime-core) are symlinked from
# node_modules/@foundry/* to ../../packages/* — real files need to exist
# at that target for runtime-core/server.ts's raw-TS imports to resolve,
# unlike eve's own .output bundle which inlines everything at build time.
COPY --from=builder /repo/packages ./packages
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
# non-executable spawn-helper files) — cheap, idempotent insurance. Checks
# both possible locations since hoisting isn't guaranteed to stay put
# across dependency changes.
RUN find /repo/node_modules/node-pty /repo/apps/agent-runtime/node_modules/node-pty \
      -name "spawn-helper" -exec chmod +x {} \; 2>/dev/null || true

WORKDIR /repo/apps/agent-runtime
EXPOSE 3000
EXPOSE 3313
ENV PORT=3000
ENV RUNTIME_CORE_PORT=3313
CMD ["node", "start.mjs"]
