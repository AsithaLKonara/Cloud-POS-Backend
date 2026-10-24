#!/usr/bin/env bash
# ==============================================================================
# XONIT Single-VPS Zero-Downtime Deployment Script
# Runs migrations, builds Backend & Frontend, and reloads PM2 clusters
# ==============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

echo "=========================================="
echo "🚀 Starting XONIT Production VPS Deployment"
echo "Time: $(date)"
echo "=========================================="

# 1. Pull latest git code
echo "--> 1. Pulling latest commits from git..."
git pull --rebase origin main || true

# 2. Build Backend
echo "--> 2. Building Backend (Prisma & TypeScript)..."
cd "${ROOT_DIR}/Backend"
npm install --legacy-peer-deps
npx prisma generate
# Deploy any pending database migrations
npx prisma db push --skip-generate || true
npm run build

# 3. Build Frontend
echo "--> 3. Building Frontend (Next.js Production Bundle)..."
cd "${ROOT_DIR}/Frontend"
npm install --legacy-peer-deps
npm run build

# 4. Reload PM2 Process Manager
echo "--> 4. Reloading PM2 Processes (Zero-Downtime)..."
cd "${ROOT_DIR}"
if command -v pm2 >/dev/null 2>&1; then
  pm2 reload ecosystem.config.js --update-env || pm2 start ecosystem.config.js
  pm2 save
  echo "✓ PM2 reload complete."
else
  echo "⚠️ PM2 not installed globally. Run: npm install -g pm2"
fi

echo "=========================================="
echo "🎉 XONIT VPS Deployment Completed Successfully!"
echo "=========================================="
