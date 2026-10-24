#!/bin/sh
# ============================================================
# ISZTRANSPORT — point d'entrée du conteneur
# 1. Prépare le dossier de la base de données (volume /data)
# 2. Crée / met à jour le schéma SQLite (idempotent, sans perte)
# 3. Démarre le serveur Next.js (sortie standalone)
# ============================================================
set -e

export DATABASE_URL="${DATABASE_URL:-file:/data/custom.db}"

DB_PATH="${DATABASE_URL#file:}"
DB_DIR="$(dirname "$DB_PATH")"
mkdir -p "$DB_DIR"

echo "[ISZTRANSPORT] Base de données : $DATABASE_URL"
echo "[ISZTRANSPORT] Vérification du schéma (prisma db push)…"
# db push est idempotent : sur une base existante à jour il ne fait rien ;
# au premier démarrage il crée toutes les tables. Les données du volume
# sont conservées entre les redémarrages et les mises à jour.
bunx prisma db push --accept-data-loss --skip-generate

echo "[ISZTRANSPORT] Démarrage du serveur sur le port ${PORT:-3000}…"
exec bun .next/standalone/server.js
