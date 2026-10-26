/**
 * PM2 Process Manager Configuration for XONIT POS & Headless Platform
 * Configured specifically for a Single VPS with:
 * - 4 CPU Cores
 * - 8 GB RAM
 * - 100 GB SSD
 * 
 * Resource Allocation:
 * - 2 Cores + 3GB RAM: PostgreSQL 16 & Redis 7
 * - 2 Cores + 3GB RAM: PM2 Apps (Backend Cluster + Next.js Server)
 * - 2GB RAM + 4GB Swap: OS, Nginx, Buffers & Build Headroom
 */

const fs = require('fs');
const path = require('path');

// Determine log directory (prefer /var/log/xonit, fallback to ./logs)
let logDir = '/var/log/xonit';
try {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
} catch (e) {
  logDir = path.join(__dirname, 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

module.exports = {
  apps: [
    {
      name: 'xonit-backend',
      cwd: './Backend',
      script: 'dist/src/index.js',
      instances: 2, // 2 cluster workers across 4 cores, leaving 2 cores for Postgres/Redis/Next.js
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '1200M', // Protects 8GB RAM from memory leaks
      listen_timeout: 10000,
      kill_timeout: 5000,
      wait_ready: true,
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
      error_file: path.join(logDir, 'backend-error.log'),
      out_file: path.join(logDir, 'backend-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
    {
      name: 'xonit-frontend',
      cwd: './Frontend',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      instances: 1, // Next.js handles concurrency via async event loop
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: path.join(logDir, 'frontend-error.log'),
      out_file: path.join(logDir, 'frontend-out.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
