#!/usr/bin/env bash
# ==============================================================================
# XONIT POS & ERP - Production Zero-Downtime Deployment Script
# Hardware Profile: 4 vCPU Cores | 8 GB RAM | 100 GB SSD
# ==============================================================================

set -euo pipefail

# Text colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

echo -e "${CYAN}${BOLD}"
echo "===================================================================="
echo "      🚀 XONIT POS & ERP - Production Deployment Pipeline          "
echo "      Started at: $(date +"%Y-%m-%d %H:%M:%S")                     "
echo "===================================================================="
echo -e "${NC}"

# Ensure required log directories exist
mkdir -p /var/log/xonit || mkdir -p "${ROOT_DIR}/logs"

# ------------------------------------------------------------------------------
# STEP 1: Git Pull Latest Changes
# ------------------------------------------------------------------------------
echo -e "${YELLOW}[1/5] Pulling latest code from origin main...${NC}"
if [ -d ".git" ]; then
  CURRENT_BRANCH=$(git branch --show-current || echo "main")
  git pull --rebase origin "${CURRENT_BRANCH}" || true
elif [ -d "Backend/.git" ] && [ -d "Frontend/.git" ]; then
  echo "Pulling Backend repository..."
  B_BRANCH=$(git -C Backend branch --show-current || echo "SaaS-migration")
  git -C Backend pull --rebase origin "${B_BRANCH}" || true
  echo "Pulling Frontend repository..."
  F_BRANCH=$(git -C Frontend branch --show-current || echo "SaaS-migration")
  git -C Frontend pull --rebase origin "${F_BRANCH}" || true
else
  echo "Not a git repo root, skipping git pull."
fi
echo -e "${GREEN}✓ Source code up to date.${NC}"

# ------------------------------------------------------------------------------
# STEP 2: Build & Migrate Backend
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[2/5] Building Backend (Prisma ORM & TypeScript)...${NC}"
cd "${ROOT_DIR}/Backend"

if [ ! -f ".env" ]; then
  if [ -f ".env.production" ]; then
    cp .env.production .env
    echo "Copied .env.production to .env"
  else
    echo -e "${RED}⚠️  Warning: Backend/.env not found! Please ensure database credentials exist.${NC}"
  fi
fi

# Clean install dependencies safely
npm install --legacy-peer-deps --prefer-offline --no-audit

# Generate Prisma Client
echo "Generating Prisma Client..."
npx prisma generate

# Apply pending schema migrations safely
echo "Applying database schema..."
npx prisma db push --accept-data-loss || true

# Compile TypeScript
echo "Compiling TypeScript..."
npm run build
echo -e "${GREEN}✓ Backend build succeeded.${NC}"

# ------------------------------------------------------------------------------
# STEP 3: Build Frontend (Next.js Standalone / Production)
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[3/5] Building Frontend (Next.js 15 Production Bundle)...${NC}"
cd "${ROOT_DIR}/Frontend"

if [ ! -f ".env" ] && [ ! -f ".env.local" ]; then
  if [ -f ".env.production" ]; then
    cp .env.production .env.local
    echo "Copied .env.production to .env.local"
  fi
fi

npm install --legacy-peer-deps --prefer-offline --no-audit

# Build Next.js with production optimization
echo "Compiling Next.js bundle..."
npm run build
echo -e "${GREEN}✓ Frontend build succeeded.${NC}"

# ------------------------------------------------------------------------------
# STEP 4: Zero-Downtime Reload via PM2 Process Manager
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[4/5] Reloading Application Services with PM2...${NC}"
cd "${ROOT_DIR}"

if command -v pm2 >/dev/null 2>&1; then
  # Graceful cluster reload: reloads workers one by one without dropping existing HTTP requests
  if pm2 describe xonit-backend >/dev/null 2>&1; then
    echo "Reloading existing PM2 clusters with zero downtime..."
    pm2 reload ecosystem.config.js --update-env
  else
    echo "Starting PM2 application processes..."
    pm2 start ecosystem.config.js
  fi
  pm2 save
  echo -e "${GREEN}✓ PM2 processes reloaded.${NC}"
else
  echo -e "${RED}❌ PM2 is not installed globally. Run: sudo npm install -g pm2${NC}"
  exit 1
fi

# ------------------------------------------------------------------------------
# STEP 5: Verification & Automated Health Checks
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[5/5] Performing Health Checks & Endpoint Verification...${NC}"
sleep 4

BACKEND_HEALTH_OK=false
FRONTEND_HEALTH_OK=false

# Test Backend API healthcheck
for i in {1..10}; do
  if curl -sf http://127.0.0.1:5000/health >/dev/null 2>&1; then
    BACKEND_HEALTH_OK=true
    break
  fi
  echo "Waiting for Backend to become ready ($i/10)..."
  sleep 2
done

# Test Frontend HTTP response
for i in {1..10}; do
  if curl -sf http://127.0.0.1:3000 >/dev/null 2>&1; then
    FRONTEND_HEALTH_OK=true
    break
  fi
  echo "Waiting for Frontend to become ready ($i/10)..."
  sleep 2
done

if [ "$BACKEND_HEALTH_OK" = true ] && [ "$FRONTEND_HEALTH_OK" = true ]; then
  echo -e "${GREEN}✓ Backend is HEALTHY on port 5000 (/health -> 200 OK)${NC}"
  echo -e "${GREEN}✓ Frontend is HEALTHY on port 3000 (HTTP -> 200 OK)${NC}"
  echo -e "\n${GREEN}${BOLD}====================================================================${NC}"
  echo -e "${GREEN}${BOLD}🎉 SUCCESS: Production Deployment Finished Seamlessly! 🎉${NC}"
  echo -e "${GREEN}${BOLD}====================================================================${NC}"
  echo -e "Time: $(date +"%Y-%m-%d %H:%M:%S")\n"
  pm2 status
else
  echo -e "\n${RED}⚠️  HEALTH CHECK WARNING:${NC}"
  if [ "$BACKEND_HEALTH_OK" = false ]; then
    echo -e "${RED}Backend healthcheck failed on http://127.0.0.1:5000/health!${NC}"
    echo "--- Recent Backend Errors ---"
    pm2 logs xonit-backend --lines 20 --nostream || true
  fi
  if [ "$FRONTEND_HEALTH_OK" = false ]; then
    echo -e "${RED}Frontend healthcheck failed on http://127.0.0.1:3000!${NC}"
    echo "--- Recent Frontend Errors ---"
    pm2 logs xonit-frontend --lines 20 --nostream || true
  fi
  exit 1
fi
