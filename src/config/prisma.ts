import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { requestContext } from '../context/RequestContext';
import { logger } from '../utils/logger';

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const basePrisma = new PrismaClient({ 
  adapter,
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'stdout', level: 'error' },
    { emit: 'stdout', level: 'info' },
    { emit: 'stdout', level: 'warn' },
  ],
});

basePrisma.$on('query' as never, (e: any) => {
  if (e.duration > 50) {
    logger.warn(`Slow Query [${e.duration}ms]: ${e.query}`);
  }
});

const TENANT_SCOPED_MODELS = new Set([
  'Category',
  'Product',
  'Branch',
  'PosTerminal',
  'PosSession',
  'Order',
  'Customer',
  'BranchExpense',
  'AuditLog',
  'Coupon',
]);

/**
 * Global Prisma Extension for Multi-Tenancy & Row-Level Security (RLS)
 * 
 * Intercepts every query:
 * 1. Sets PostgreSQL session variables (app.current_tenant_id, app.current_user_id, etc.).
 * 2. Automatically injects tenantId into query where clauses and mutations for tenant-scoped models.
 */
const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }: { model?: string; operation: string; args: any; query: (args: any) => Promise<any> }) {
        const ctx = requestContext.getStore();
        
        // If there is no context (e.g., background job, startup, migration), run query normally
        if (!ctx) {
          return query(args);
        }

        const isAdmin = ctx.isAdmin || false;
        const isPlatformAdmin = ctx.isPlatformAdmin || false;
        const currentUserId = ctx.userId || '';
        const currentRole = ctx.role || 'GUEST';
        const currentTenantId = ctx.tenantId || '';

        // Auto-inject tenantId into tenant-scoped models when tenantId is present and not explicitly querying globally
        if (model && TENANT_SCOPED_MODELS.has(model) && currentTenantId && !isPlatformAdmin) {
          args = args || {};

          // Auto-scope reads
          if (['findFirst', 'findMany', 'findUnique', 'count', 'aggregate', 'groupBy'].includes(operation)) {
            args.where = {
              ...args.where,
              tenantId: currentTenantId,
            };
          }

          // Auto-scope creates
          if (operation === 'create' && args.data) {
            if (!args.data.tenantId) {
              args.data.tenantId = currentTenantId;
            }
          }

          if (operation === 'createMany' && Array.isArray(args.data)) {
            args.data = args.data.map((item: any) => ({
              ...item,
              tenantId: item.tenantId || currentTenantId,
            }));
          }

          // Auto-scope updates & deletes
          if (['updateMany', 'deleteMany'].includes(operation)) {
            args.where = {
              ...args.where,
              tenantId: currentTenantId,
            };
          }
        }

        // Wrap the actual query in a transaction to safely set PostgreSQL session variables
        return basePrisma.$transaction(async (tx) => {
          await tx.$executeRaw`
            SELECT set_config('app.current_tenant_id', ${currentTenantId}, true),
                   set_config('app.current_user_id', ${currentUserId}, true),
                   set_config('app.current_role', ${currentRole}, true),
                   set_config('app.is_admin', ${isAdmin.toString()}, true)
          `;
          return query(args);
        });
      },
    },
  },
});

export default prisma;
