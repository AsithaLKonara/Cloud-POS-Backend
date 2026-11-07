import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { requestContext } from '../context/RequestContext';
import { logger } from '../utils/logger';
import * as path from 'path';

dotenv.config();
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: path.join(__dirname, '../../.env') });
}
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: path.join(__dirname, '../../../.env') });
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 30,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
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
  'DiningTable',
  'Supplier',
  'PurchaseOrder',
  'StockTransfer',
  'InventoryBatch',
  'Setting',
  'SystemErrorLog',
  'TenantIntegrationCredential',
  'TenantApiKey',
  'TenantWebhookEndpoint',
  'OrderSequence',
  'ChartOfAccount',
  'JournalEntry',
  'VendorBill',
  'SalesInvoice',
  'BillOfMaterials',
  'StocktakeSession',
  'PosHeldCart',
  'Role',
]);

const CHILD_RELATION_SCOPING: Record<string, string> = {
  ProductVariant: 'product',
  InventoryItem: 'branch',
  CustomerCreditLedger: 'customer',
  PaymentTransaction: 'order',
  ReturnRequest: 'order',
  ReturnItem: 'returnRequest',
  OrderItem: 'order',
  CartItem: 'cart',
  LoyaltyAccount: 'customer',
  JournalEntryLine: 'journalEntry',
  BillOfMaterialItem: 'bom',
  StocktakeItem: 'session',
};

/**
 * Global Prisma Extension for Multi-Tenancy & Row-Level Security (RLS)
 * 
 * Intercepts every query:
 * 1. Automatically injects tenantId into query where clauses and mutations for tenant-scoped models.
 * 2. Scopes child models through parent relations to eliminate cross-tenant data leaks.
 * 3. Bypasses connection-starving interactive transaction wrappers on standard queries.
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

        const isPlatformAdmin = ctx.isPlatformAdmin || false;
        const currentTenantId = ctx.tenantId || '';

        // Auto-inject tenantId into tenant-scoped models when tenantId is present and not platform admin
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
          if (['update', 'delete', 'updateMany', 'deleteMany'].includes(operation)) {
            args.where = {
              ...args.where,
              tenantId: currentTenantId,
            };
          }
        }

        // Auto-scope Cart: allows guest carts (customerId = null) while scoping customer carts to tenant
        if (model === 'Cart' && currentTenantId && !isPlatformAdmin) {
          args = args || {};
          if (['findFirst', 'findMany', 'findUnique', 'count', 'aggregate', 'groupBy'].includes(operation)) {
            if (args.where?.customerId) {
              args.where = {
                ...args.where,
                customer: { tenantId: currentTenantId },
              };
            } else if (!args.where?.id && !args.where?.sessionId) {
              args.where = {
                ...args.where,
                OR: [
                  { customer: { tenantId: currentTenantId } },
                  { customerId: null },
                ],
              };
            }
          }
        }

        // Auto-scope child models via parent relation to prevent cross-tenant data leaks
        if (model && CHILD_RELATION_SCOPING[model] && currentTenantId && !isPlatformAdmin) {
          args = args || {};
          const relField = CHILD_RELATION_SCOPING[model];

          if (['findFirst', 'findMany', 'findUnique', 'count', 'aggregate', 'groupBy', 'update', 'delete', 'updateMany', 'deleteMany'].includes(operation)) {
            if (model === 'ReturnItem') {
              args.where = {
                ...args.where,
                returnRequest: {
                  order: {
                    tenantId: currentTenantId,
                  },
                },
              };
            } else if (model === 'CartItem') {
              args.where = {
                ...args.where,
                variant: {
                  product: {
                    tenantId: currentTenantId,
                  },
                },
              };
            } else {
              args.where = {
                ...args.where,
                [relField]: {
                  tenantId: currentTenantId,
                },
              };
            }
          }
        }

        // Direct execution without pool-starving interactive transaction wrapper
        return query(args);
      },
    },
  },
});

export default prisma;
