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

WORKDIR /repo/apps/agent-runtime
EXPOSE 3000
ENV PORT=3000
CMD ["node", ".output/server/index.mjs"]
