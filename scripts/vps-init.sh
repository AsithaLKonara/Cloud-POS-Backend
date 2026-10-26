#!/usr/bin/env bash
# ==============================================================================
# XONIT POS & ERP - Automated VPS Provisioning Script
# Target Architecture: Ubuntu 22.04 / 24.04 LTS (x86_64 or ARM64)
# Hardware Profile: 4 vCPU Cores | 8 GB RAM | 100 GB SSD
# ==============================================================================
# This script configures:
# 1. System packages, Timezone, and Essential Utilities
# 2. 4GB Swap Space (Safeguard 8GB RAM against Next.js build spikes)
# 3. UFW Firewall & Fail2ban (Security Hardening)
# 4. PostgreSQL 16 (Tuned for 8GB RAM with dedicated DB & User)
# 5. Redis 7 (In-Memory Cache & Queue, tuned memory limits)
# 6. Node.js 20 LTS & Global Tools (PM2, pnpm)
# 7. Nginx Web Server (Reverse Proxy, HTTP/2, Gzip, Buffer Optimization)
# 8. Certbot (Let's Encrypt SSL Automation)
# 9. Application Directory Structure (/var/www/xonit-pos)
# 10. Automated Daily Database Backup Daemon & Logrotate
# ==============================================================================

set -euo pipefail

# Text colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Ensure root privileges
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}❌ Please run this script as root or with sudo:${NC} sudo bash $0"
  exit 1
fi

echo -e "${CYAN}${BOLD}"
echo "===================================================================="
echo "      🚀 XONIT POS & ERP - Production VPS Provisioning Engine      "
echo "      Target Specs: 4 vCPU | 8 GB RAM | 100 GB SSD                 "
echo "===================================================================="
echo -e "${NC}"

# Configurable defaults (Prompt or override via ENV)
DB_NAME="${DB_NAME:-xonit_pos_db}"
DB_USER="${DB_USER:-xonit_user}"
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 16)}"
APP_DIR="/var/www/xonit-pos"
APP_USER="${SUDO_USER:-$(logname 2>/dev/null || echo "ubuntu")}"

if ! id "$APP_USER" >/dev/null 2>&1; then
  APP_USER="root"
fi

echo -e "${BLUE}ℹ️  Target App Directory:${NC} ${APP_DIR}"
echo -e "${BLUE}ℹ️  System Deploy User:${NC}   ${APP_USER}"
echo -e "${BLUE}ℹ️  Database Name:${NC}        ${DB_NAME}"
echo -e "${BLUE}ℹ️  Database User:${NC}        ${DB_USER}"
echo "--------------------------------------------------------------------"

# ------------------------------------------------------------------------------
# STEP 1: Update OS Packages & Install Base Tools
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[1/10] Updating OS packages and installing essential tools...${NC}"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y \
  curl \
  wget \
  git \
  build-essential \
  software-properties-common \
  apt-transport-https \
  ca-certificates \
  gnupg \
  lsb-release \
  ufw \
  fail2ban \
  htop \
  net-tools \
  unzip \
  zip \
  logrotate

# ------------------------------------------------------------------------------
# STEP 2: Configure 4GB Swap Space (Critical for Next.js 8GB RAM Safety)
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[2/10] Configuring 4GB Swap Space...${NC}"
if [ -f /swapfile ]; then
  echo -e "${GREEN}✓ Swapfile already exists.${NC}"
else
  fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo -e "${GREEN}✓ 4GB Swapfile created and activated.${NC}"
fi

# Optimize Swappiness for 8GB RAM server
sysctl vm.swappiness=10
sysctl vm.vfs_cache_pressure=50
if ! grep -q "vm.swappiness=10" /etc/sysctl.conf; then
  echo "vm.swappiness=10" >> /etc/sysctl.conf
  echo "vm.vfs_cache_pressure=50" >> /etc/sysctl.conf
fi

# ------------------------------------------------------------------------------
# STEP 3: Security Hardening (UFW Firewall & Fail2ban)
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[3/10] Configuring UFW Firewall and Fail2ban...${NC}"
ufw --force reset >/dev/null 2>&1 || true
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable

systemctl enable fail2ban
systemctl restart fail2ban
echo -e "${GREEN}✓ Firewall and Fail2ban successfully secured.${NC}"

# ------------------------------------------------------------------------------
# STEP 4: Install & Configure PostgreSQL 16
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[4/10] Installing and tuning PostgreSQL 16...${NC}"
if ! command -v psql >/dev/null 2>&1; then
  install -d /etc/apt/keyrings
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg
  echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt-get update -y
  apt-get install -y postgresql-16 postgresql-contrib-16
fi

systemctl enable postgresql
systemctl start postgresql

# Create Database and User with secure credentials
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || \
sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}' CREATEDB;"

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"
sudo -u postgres psql -d "${DB_NAME}" -c "GRANT ALL ON SCHEMA public TO ${DB_USER};"

# Tune PostgreSQL for 8GB RAM VPS
PG_CONF=$(sudo -u postgres psql -t -P format=unaligned -c 'SHOW config_file;')
if [ -f "$PG_CONF" ]; then
  # Safe tuning for 8GB RAM (Leaves ~5-6GB for Next.js, Backend, and Redis)
  sed -i "s/^#*shared_buffers = .*/shared_buffers = 1GB/" "$PG_CONF"
  sed -i "s/^#*effective_cache_size = .*/effective_cache_size = 3GB/" "$PG_CONF"
  sed -i "s/^#*maintenance_work_mem = .*/maintenance_work_mem = 128MB/" "$PG_CONF"
  sed -i "s/^#*checkpoint_completion_target = .*/checkpoint_completion_target = 0.9/" "$PG_CONF"
  sed -i "s/^#*wal_buffers = .*/wal_buffers = 16MB/" "$PG_CONF"
  sed -i "s/^#*default_statistics_target = .*/default_statistics_target = 100/" "$PG_CONF"
  sed -i "s/^#*random_page_cost = .*/random_page_cost = 1.1/" "$PG_CONF"
  sed -i "s/^#*effective_io_concurrency = .*/effective_io_concurrency = 200/" "$PG_CONF"
  sed -i "s/^#*work_mem = .*/work_mem = 16MB/" "$PG_CONF"
  sed -i "s/^#*max_connections = .*/max_connections = 100/" "$PG_CONF"
  systemctl restart postgresql
fi
echo -e "${GREEN}✓ PostgreSQL 16 installed, user created, and tuned for 8GB RAM.${NC}"

# ------------------------------------------------------------------------------
# STEP 5: Install & Configure Redis 7
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[5/10] Installing and tuning Redis 7...${NC}"
apt-get install -y redis-server
systemctl enable redis-server

# Tune Redis memory limits (512MB max for 8GB RAM)
REDIS_CONF="/etc/redis/redis.conf"
if [ -f "$REDIS_CONF" ]; then
  sed -i "s/^#*maxmemory .*/maxmemory 512mb/" "$REDIS_CONF"
  if ! grep -q "^maxmemory " "$REDIS_CONF"; then
    echo "maxmemory 512mb" >> "$REDIS_CONF"
  fi
  sed -i "s/^#*maxmemory-policy .*/maxmemory-policy volatile-lru/" "$REDIS_CONF"
  if ! grep -q "^maxmemory-policy " "$REDIS_CONF"; then
    echo "maxmemory-policy volatile-lru" >> "$REDIS_CONF"
  fi
  systemctl restart redis-server
fi
echo -e "${GREEN}✓ Redis 7 installed and tuned (512MB volatile-lru).${NC}"

# ------------------------------------------------------------------------------
# STEP 6: Install Node.js 20 LTS & PM2 Process Manager
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[6/10] Installing Node.js 20 LTS & PM2...${NC}"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

npm install -g pm2 pnpm
pm2 install pm2-logrotate || true
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true

# Setup PM2 to start on system boot
env PATH=$PATH:/usr/bin pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" || pm2 startup systemd || true
echo -e "${GREEN}✓ Node.js $(node -v) and PM2 installed.${NC}"

# ------------------------------------------------------------------------------
# STEP 7: Install Nginx & Certbot
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[7/10] Installing Nginx & Certbot...${NC}"
apt-get install -y nginx certbot python3-certbot-nginx
systemctl enable nginx
systemctl start nginx
echo -e "${GREEN}✓ Nginx and Certbot installed.${NC}"

# ------------------------------------------------------------------------------
# STEP 8: Create Application & Logging Directories
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[8/10] Setting up application directories and permissions...${NC}"
mkdir -p "${APP_DIR}"
mkdir -p /var/log/xonit
mkdir -p /var/backups/xonit
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
chown -R "${APP_USER}:${APP_USER}" /var/log/xonit
chown -R "${APP_USER}:${APP_USER}" /var/backups/xonit
chmod -R 775 /var/log/xonit
chmod 700 /var/backups/xonit
echo -e "${GREEN}✓ Directories created: ${APP_DIR}, /var/log/xonit, /var/backups/xonit${NC}"

# ------------------------------------------------------------------------------
# STEP 9: Configure Automated Daily Database Backup & Logrotate
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[9/10] Configuring Automated Backup Cron & Logrotate...${NC}"

# Setup Cron for daily backups at 02:00 AM
CRON_FILE="/etc/cron.d/xonit-vps-backup"
cat << 'EOF' > "${CRON_FILE}"
# Daily automated PostgreSQL database backup at 2:00 AM UTC
0 2 * * * root /var/www/xonit-pos/scripts/vps-backup-db.sh >/dev/null 2>&1
EOF
chmod 644 "${CRON_FILE}"

# Setup Logrotate for application logs
cat << 'EOF' > /etc/logrotate.d/xonit
/var/log/xonit/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 ubuntu ubuntu
    sharedscripts
    postrotate
        pm2 reloadLogs >/dev/null 2>&1 || true
    endscript
}
EOF
echo -e "${GREEN}✓ Daily DB Backup Cron and Logrotate active.${NC}"

# ------------------------------------------------------------------------------
# STEP 10: Generate Production Environment Template with Generated Secrets
# ------------------------------------------------------------------------------
echo -e "\n${YELLOW}[10/10] Generating Production Environment Credentials...${NC}"

DB_CONNECTION_STRING="postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}?schema=public"
REDIS_CONNECTION_STRING="redis://127.0.0.1:6379"

CREDENTIALS_FILE="/root/xonit-vps-credentials.txt"
cat << EOF > "${CREDENTIALS_FILE}"
====================================================================
           XONIT POS & ERP - PRODUCTION VPS CREDENTIALS             
====================================================================
Date Generated: $(date)
Server Specs:   4 vCPU Cores | 8 GB RAM | 100 GB SSD

DATABASE (PostgreSQL 16):
Host:         127.0.0.1
Port:         5432
Database:     ${DB_NAME}
Username:     ${DB_USER}
Password:     ${DB_PASSWORD}
DATABASE_URL: ${DB_CONNECTION_STRING}

REDIS CACHE (Redis 7):
Host:         127.0.0.1
Port:         6379
REDIS_URL:    ${REDIS_CONNECTION_STRING}

APPLICATION PATHS:
Root Dir:     ${APP_DIR}
Backend Logs: /var/log/xonit/backend-out.log
              /var/log/xonit/backend-error.log
Frontend Logs:/var/log/xonit/frontend-out.log
              /var/log/xonit/frontend-error.log
DB Backups:   /var/backups/xonit/
====================================================================
EOF
chmod 600 "${CREDENTIALS_FILE}"

echo -e "\n${GREEN}${BOLD}====================================================================${NC}"
echo -e "${GREEN}${BOLD}🎉 SUCCESS! VPS Infrastructure Provisioning Completed! 🎉${NC}"
echo -e "${GREEN}${BOLD}====================================================================${NC}"
echo -e "${CYAN}Credentials saved securely to:${NC} ${BOLD}${CREDENTIALS_FILE}${NC}"
echo -e "\n${BOLD}Database URL to use in Backend/.env:${NC}"
echo -e "${YELLOW}${DB_CONNECTION_STRING}${NC}"
echo -e "\n${BOLD}Next Steps:${NC}"
echo -e "1. Clone your project into: ${BOLD}${APP_DIR}${NC}"
echo -e "2. Configure Nginx with your domain or VPS IP (see ${BOLD}nginx/xonit.conf${NC})"
echo -e "3. Run ${BOLD}certbot --nginx -d yourdomain.com${NC} for free SSL"
echo -e "4. Run ${BOLD}./scripts/deploy.sh${NC} to start all services!"
echo -e "====================================================================\n"
