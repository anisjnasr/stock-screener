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
ENV STANDALONE=1
RUN npx next build --webpack

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache curl libarchive-tools
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Include operational scripts and seed/schema data so Render Shell can run
# init/seed/refresh commands after deploy.
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/data/screener-schema.sql ./static-data/screener-schema.sql
COPY --from=builder --chown=nextjs:nodejs /app/data/all-stocks.json ./static-data/all-stocks.json
COPY --from=builder --chown=nextjs:nodejs /app/data/nasdaq100.json ./static-data/nasdaq100.json
COPY --from=builder --chown=nextjs:nodejs /app/data/sp500.json ./static-data/sp500.json
COPY --from=builder --chown=nextjs:nodejs /app/data/russell2000.json ./static-data/russell2000.json
COPY --from=builder --chown=nextjs:nodejs /app/data/thematic-etf-constituents.json ./static-data/thematic-etf-constituents.json
COPY --from=builder --chown=nextjs:nodejs /app/data/cusip-to-symbol.json ./static-data/cusip-to-symbol.json
COPY --from=builder --chown=nextjs:nodejs /app/data/cusip-overrides.json ./static-data/cusip-overrides.json
# Ensure data directory exists; volume mount will provide screener.db
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
