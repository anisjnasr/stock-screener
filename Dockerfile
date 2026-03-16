# Stock Scanner: Next.js app + screener DB (data/screener.db via volume)
# Build: docker build -t stock-scanner .
# Run:  docker run -p 3000:3000 -v $(pwd)/data:/app/data -e MASSIVE_API_KEY=xxx stock-scanner
# Do not bundle data/screener.db; mount a volume at /app/data.

FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# Build stage needs devDependencies (TypeScript/Next tooling).
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# data/screener.db is not copied; mount at runtime
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Ensure data directory exists; volume mount will provide screener.db
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
