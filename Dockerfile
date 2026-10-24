# ============================================================
# ISZTRANSPORT — Image de production (long terme)
# ------------------------------------------------------------
# Application Next.js 16 (sortie "standalone") + base SQLite
# persistante montée dans /data (volume Docker).
#
# Construire :  docker build -t isztransport .
# Lancer    :  docker compose up -d   (recommandé)
# ============================================================

# ---------- Étape 1 : dépendances ----------
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---------- Étape 2 : construction ----------
FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma génère le client ; le build Next.js n'a pas besoin
# de la vraie base : un chemin factice suffit.
RUN bunx prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=file:/tmp/build-placeholder.db
RUN bun run build

# ---------- Étape 3 : exécution ----------
FROM oven/bun:1-slim AS runner
WORKDIR /app

# OpenSSL + certificats : requis par les moteurs Prisma
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Base de données : fichier SQLite dans le volume persistant /data
# (surchargeable via la variable d'environnement DATABASE_URL)
ENV DATABASE_URL=file:/data/custom.db

# Dépendances complètes : le CLI Prisma doit rester disponible
# au démarrage pour créer/mettre à jour la base automatiquement.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /data

VOLUME /data
EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
