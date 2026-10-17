import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContextData {
  tenantId?: string | null; // null = Platform Admin / global context
  tenantSlug?: string | null;
  userId?: string | null;
  role?: string | null;
  isAdmin?: boolean;
  isPlatformAdmin?: boolean;
  branchId?: string | null; // null = Tenant Admin (all branches in tenant), string = restricted to one branch
}

export const requestContext = new AsyncLocalStorage<RequestContextData>();
