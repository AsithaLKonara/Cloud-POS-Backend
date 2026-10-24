/**
 * PM2 Process Manager Configuration for XONIT POS & Headless Platform
 * Configured specifically for a Single VPS with:
 * - 4 CPU Cores
 * - 8 GB RAM
 * - 100 GB SSD
 * 
 * Manages:
 * 1. Backend REST & Headless API (Node.js/Express)
 * 2. Frontend Web App & Admin Dashboard (Next.js)
 * 3. VPS Daily Database Backup Daemon
 */

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
      max_memory_restart: '1500M', // Protects 8GB RAM from memory leaks
      listen_timeout: 10000,
      kill_timeout: 5000,
      wait_ready: true,
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
      },
      error_file: '/var/log/xonit/backend-error.log',
      out_file: '/var/log/xonit/backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
    {
      name: 'xonit-frontend',
      cwd: './Frontend',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      instances: 1, // Next.js handles async concurrency natively
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: '/var/log/xonit/frontend-error.log',
      out_file: '/var/log/xonit/frontend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
