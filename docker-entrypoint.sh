#!/bin/sh
set -e

echo "=================================================="
echo "[DOCKER] AI Finance Reconciliation Agent Container"
echo "=================================================="

if [ -n "$DATABASE_URL" ]; then
  echo "[DOCKER] Target Database: $DATABASE_URL"
  echo "[DOCKER] Running automated schema initialization..."
  npm run db:init || echo "[DOCKER] Schema init notice (proceeding)..."

  if [ "$AUTO_SEED" = "true" ] || [ "$AUTO_SEED" = "1" ]; then
    echo "[DOCKER] AUTO_SEED enabled: populating demo financial transactions..."
    npm run db:seed || echo "[DOCKER] Seed notice (proceeding)..."
  fi
fi

echo "=================================================="
echo "[DOCKER] Starting Next.js Production Web Server..."
echo "=================================================="

exec "$@"
