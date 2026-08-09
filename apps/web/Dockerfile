# syntax=docker/dockerfile:1
# Build context must be the monorepo root: docker build -f apps/web/Dockerfile .

FROM node:24-alpine AS pruner
WORKDIR /repo
RUN npm i -g turbo
COPY . .
RUN turbo prune @foundry/web --docker

FROM node:24-alpine AS builder
WORKDIR /repo
COPY --from=pruner /repo/out/json/ .
RUN npm install
COPY --from=pruner /repo/out/full/ .
# NEXT_PUBLIC_* vars are inlined into the client bundle at build time —
# must be set here, a runtime container env var arrives too late.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
RUN npx turbo run build --filter=@foundry/web

FROM node:24-alpine AS runner
WORKDIR /repo
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /repo/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
