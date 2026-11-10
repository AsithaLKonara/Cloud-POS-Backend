import prisma from '../config/prisma';
import { requestContext } from '../context/RequestContext';
import { logger } from '../utils/logger';

export interface CheckWarrantyQuery {
  serialNumber?: string;
  imei?: string;
  orderNumber?: string;
  phone?: string;
}

export interface RegisterSerialDTO {
  variantId: string;
  branchId?: string;
  serialNumber: string;
  imei?: string;
  batchNumber?: string;
  notes?: string;
}

export interface CreateClaimDTO {
  branchId?: string;
  customerId?: string;
  orderId?: string;
  variantId?: string;
  productVariantId?: string;
  productSerialId?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  serialNumber: string;
  productName?: string;
  issueDescription: string;
  accessoryNotes?: string;
  diagnosticNotes?: string;
  technicianName?: string;
}

export interface UpdateClaimDTO {
  status?: string;
  resolutionType?: string;
  replacementSerial?: string;
  diagnosticNotes?: string;
  technicianNotes?: string;
  technicianName?: string;
  repairCost?: number;
  customerCharge?: number;
  note?: string;
  performedBy?: string;
}

export class WarrantyService {
  /**
   * Resolves active tenantId from parameter or RequestContext.
   */
  private static resolveTenantId(tenantId?: string): string {
    if (tenantId) return tenantId;
    const ctx = requestContext.getStore();
    if (ctx?.tenantId) return ctx.tenantId;
    throw new Error('Tenant context is required for warranty operations');
  }

  /**
   * Checks real-time warranty validity by serial number, IMEI, order number, or phone.
   */
  static async checkWarrantyStatus(tenantIdArg?: string, query?: CheckWarrantyQuery) {
    const ctxTenantId = requestContext.getStore()?.tenantId;
    const tenantId = tenantIdArg || ctxTenantId;
    const now = new Date();

    if (!query?.serialNumber && !query?.imei && !query?.orderNumber && !query?.phone) {
      throw new Error('At least one search parameter (serialNumber, imei, orderNumber, or phone) is required');
    }

    // 1. Direct Serial Lookup
    if (query.serialNumber || query.imei) {
      const orConditions: any[] = [];
      if (query.serialNumber) {
        orConditions.push({ serialNumber: { contains: query.serialNumber.trim(), mode: 'insensitive' } });
      }
      if (query.imei) {
        orConditions.push({ imei: { contains: query.imei.trim(), mode: 'insensitive' } });
      }

      const serialWhere: any = {
        OR: orConditions,
        ...(tenantId ? { tenantId } : {}),
      };

      const serial = await prisma.productSerial.findFirst({
        where: serialWhere,
        include: {
          variant: {
            include: { product: true },
          },
          orderItem: {
            include: {
              order: {
                include: { customer: true },
              },
            },
          },
          claims: {
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
        },
      });

      if (serial) {
        const expiresAt = serial.warrantyExpiresAt;
        const purchaseDate = serial.purchaseDate || serial.orderItem?.order?.createdAt || serial.createdAt;
        const warrantyPeriodMonths = serial.variant.product.warrantyPeriodMonths || 0;
        const warrantyPolicy = serial.variant.product.warrantyPolicy || `${warrantyPeriodMonths} Months Standard Warranty`;

        const isActive = expiresAt ? now <= expiresAt : false;
        const daysRemaining = expiresAt ? Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 0;

        return {
          found: true,
          lookupType: 'SERIAL',
          isValidWarranty: isActive,
          status: isActive ? 'ACTIVE' : (expiresAt ? 'EXPIRED' : 'NO_WARRANTY'),
          daysRemaining: Math.max(0, daysRemaining),
          serialNumber: serial.serialNumber,
          imei: serial.imei,
          serialStatus: serial.status,
          purchaseDate,
          warrantyExpiresAt: expiresAt,
          warrantyPeriodMonths,
          warrantyPolicy,
          product: {
            id: serial.variant.productId,
            name: serial.variant.product.name,
            variantId: serial.variant.id,
            variantName: serial.variant.name,
            sku: serial.variant.sku,
            brand: serial.variant.product.brand,
          },
          customer: serial.orderItem?.order?.customer
            ? {
                id: serial.orderItem.order.customer.id,
                name: `${serial.orderItem.order.customer.firstName || ''} ${serial.orderItem.order.customer.lastName || ''}`.trim(),
                phone: serial.orderItem.order.customer.phone,
                email: serial.orderItem.order.customer.email,
              }
            : null,
          order: serial.orderItem?.order
            ? {
                id: serial.orderItem.order.id,
                orderNumber: serial.orderItem.order.orderNumber,
                orderDate: serial.orderItem.order.createdAt,
              }
            : null,
          existingClaims: serial.claims,
        };
      }
    }

    // 2. Order Number Lookup
    if (query.orderNumber) {
      const order = await prisma.order.findFirst({
        where: {
          tenantId,
          orderNumber: { equals: query.orderNumber.trim(), mode: 'insensitive' },
        },
        include: {
          customer: true,
          items: {
            include: {
              variant: {
                include: { product: true },
              },
              productSerials: true,
            },
          },
        },
      });

      if (order) {
        const serializedItems = order.items.map((item) => {
          const warrantyMonths = item.variant.product.warrantyPeriodMonths || 0;
          const purchaseDate = order.createdAt;
          const expiresAt = new Date(purchaseDate);
          expiresAt.setMonth(expiresAt.getMonth() + warrantyMonths);

          const isActive = warrantyMonths > 0 ? now <= expiresAt : false;
          const daysRemaining = isActive ? Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 0;

          return {
            orderItemId: item.id,
            productName: item.variant.product.name,
            variantName: item.variant.name,
            sku: item.variant.sku,
            quantity: item.quantity,
            warrantyPeriodMonths: warrantyMonths,
            warrantyPolicy: item.variant.product.warrantyPolicy || `${warrantyMonths} Months Warranty`,
            isValidWarranty: isActive,
            daysRemaining,
            warrantyExpiresAt: warrantyMonths > 0 ? expiresAt : null,
            serials: item.productSerials.map((s) => ({
              id: s.id,
              serialNumber: s.serialNumber,
              imei: s.imei,
              status: s.status,
            })),
          };
        });

        return {
          found: true,
          lookupType: 'ORDER',
          orderNumber: order.orderNumber,
          orderDate: order.createdAt,
          customer: order.customer
            ? {
                name: `${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim(),
                phone: order.customer.phone,
                email: order.customer.email,
              }
            : null,
          items: serializedItems,
        };
      }
    }

    return {
      found: false,
      lookupType: 'NONE',
      message: 'No matching warranty or serial record found.',
    };
  }

  /**
   * Registers a single serial number to stock.
   */
  static async registerSerial(tenantIdArg?: string, data?: RegisterSerialDTO) {
    const tenantId = this.resolveTenantId(tenantIdArg);
    if (!data?.variantId || !data?.serialNumber) {
      throw new Error('variantId and serialNumber are required');
    }

    const cleanSerial = data.serialNumber.trim();

    // Check if serial already exists in tenant
    const existing = await prisma.productSerial.findUnique({
      where: {
        tenantId_serialNumber: {
          tenantId,
          serialNumber: cleanSerial,
        },
      },
    });

    if (existing) {
      throw new Error(`Serial number "${cleanSerial}" is already registered in this tenant.`);
    }

    const created = await prisma.productSerial.create({
      data: {
        tenantId,
        variantId: data.variantId,
        branchId: data.branchId || null,
        serialNumber: cleanSerial,
        imei: data.imei ? data.imei.trim() : null,
        batchNumber: data.batchNumber ? data.batchNumber.trim() : null,
        notes: data.notes || null,
        status: 'IN_STOCK',
      },
      include: {
        variant: {
          include: { product: true },
        },
      },
    });

    return created;
  }

  /**
   * Bulk registers serial numbers (e.g. from purchase order receiving or barcode scanner stream).
   */
  static async bulkRegisterSerials(
    tenantIdArg: string | undefined,
    variantId: string,
    serialNumbers: string[],
    branchId?: string
  ) {
    const tenantId = this.resolveTenantId(tenantIdArg);
    if (!serialNumbers || serialNumbers.length === 0) {
      throw new Error('At least one serial number is required');
    }

    const uniqueSerials = Array.from(new Set(serialNumbers.map((s) => s.trim()).filter(Boolean)));
    const registered: any[] = [];
    const skipped: string[] = [];

    for (const sn of uniqueSerials) {
      try {
        const item = await this.registerSerial(tenantId, {
          variantId,
          branchId,
          serialNumber: sn,
        });
        registered.push(item);
      } catch (err) {
        skipped.push(sn);
      }
    }

    return {
      totalProvided: uniqueSerials.length,
      registeredCount: registered.length,
      skippedCount: skipped.length,
      registered,
      skipped,
    };
  }

  /**
   * Retrieves list of registered serials with filtering and pagination.
   */
  static async getSerials(
    tenantIdArg?: string,
    params?: {
      variantId?: string;
      branchId?: string;
      status?: string;
      search?: string;
      page?: number;
      limit?: number;
    }
  ) {
    const tenantId = this.resolveTenantId(tenantIdArg);
    const page = Math.max(1, params?.page || 1);
    const limit = Math.max(1, Math.min(100, params?.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = { tenantId };

    if (params?.variantId) where.variantId = params.variantId;
    if (params?.branchId) where.branchId = params.branchId;
    if (params?.status && params.status !== 'ALL') where.status = params.status;

    if (params?.search) {
      const q = params.search.trim();
      where.OR = [
        { serialNumber: { contains: q, mode: 'insensitive' } },
        { imei: { contains: q, mode: 'insensitive' } },
        { variant: { product: { name: { contains: q, mode: 'insensitive' } } } },
        { variant: { sku: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.productSerial.count({ where }),
      prisma.productSerial.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          variant: {
            include: { product: true },
          },
          branch: { select: { id: true, name: true, code: true } },
          orderItem: {
            include: {
              order: {
                select: { id: true, orderNumber: true, createdAt: true },
              },
            },
          },
        },
      }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Creates a new Warranty Claim ticket and initializes the audit timeline.
   */
  static async createClaim(tenantIdArg?: string, data?: CreateClaimDTO) {
    let tenantId = tenantIdArg || requestContext.getStore()?.tenantId;

    if (!data?.serialNumber || !data?.customerName || !data?.customerPhone || !data?.issueDescription) {
      throw new Error('serialNumber, customerName, customerPhone, and issueDescription are required');
    }

    const cleanSerial = data.serialNumber.trim();

    // Check if serial exists
    let matchedSerial = await prisma.productSerial.findFirst({
      where: {
        ...(tenantId ? { tenantId } : {}),
        serialNumber: { contains: cleanSerial, mode: 'insensitive' },
      },
      include: {
        variant: { include: { product: true } },
        orderItem: { include: { order: true } },
      },
    });

    if (!tenantId && matchedSerial) {
      tenantId = matchedSerial.tenantId;
    }
    if (!tenantId) {
      const fallbackTenant = await prisma.tenant.findFirst({ where: { status: 'ACTIVE' } });
      if (fallbackTenant) {
        tenantId = fallbackTenant.id;
      } else {
        tenantId = this.resolveTenantId(tenantIdArg);
      }
    }

    // Auto-generate unique Claim Number
    const count = await prisma.warrantyClaim.count({ where: { tenantId } });
    const claimNumber = `CLM-${10000 + count + 1}`;

    let variantId = (data as any).variantId || (data as any).productVariantId || matchedSerial?.variantId || null;
    if (!variantId) {
      const firstVariant = await prisma.productVariant.findFirst({
        where: { ...(tenantId ? { product: { tenantId } } : {}) },
      });
      variantId = firstVariant?.id || null;
    }
    const orderId = data.orderId || matchedSerial?.orderItem?.orderId || null;
    const customerId = data.customerId || matchedSerial?.orderItem?.order?.customerId || null;
    const productName = (data as any).productName || matchedSerial?.variant?.product?.name || 'Serialized Product';

    const claim = await prisma.$transaction(async (tx) => {
      // 1. Create WarrantyClaim
      const createdClaim = await tx.warrantyClaim.create({
        data: {
          claimNumber,
          tenantId,
          branchId: data.branchId || matchedSerial?.branchId || null,
          customerId,
          orderId,
          variantId,
          productSerialId: matchedSerial?.id || null,
          customerName: data.customerName.trim(),
          customerPhone: data.customerPhone.trim(),
          customerEmail: data.customerEmail ? data.customerEmail.trim() : null,
          serialNumber: cleanSerial,
          productName,
          issueDescription: data.issueDescription.trim(),
          accessoryNotes: data.accessoryNotes?.trim() || null,
          diagnosticNotes: data.diagnosticNotes?.trim() || null,
          technicianName: data.technicianName?.trim() || null,
          status: 'RECEIVED',
        },
        include: {
          variant: { include: { product: true } },
          customer: true,
          order: true,
          productSerial: true,
        },
      });

      // 2. Update Serial status to UNDER_WARRANTY
      if (matchedSerial) {
        await tx.productSerial.update({
          where: { id: matchedSerial.id },
          data: { status: 'UNDER_WARRANTY' },
        });
      }

      // 3. Create initial timeline log
      await tx.warrantyClaimLog.create({
        data: {
          claimId: createdClaim.id,
          action: 'CLAIM_CREATED',
          fromStatus: null,
          toStatus: 'RECEIVED',
          note: `Claim opened: ${data.issueDescription.trim()}`,
          performedBy: data.technicianName || 'Reception Staff',
        },
      });

      return createdClaim;
    });

    return claim;
  }

  /**
   * Retrieves paginated claims with metrics summary and filters.
   */
  static async getClaims(
    tenantIdArg?: string,
    params?: {
      page?: number;
      limit?: number;
      search?: string;
      status?: string;
      branchId?: string;
    }
  ) {
    const tenantId = this.resolveTenantId(tenantIdArg);
    const page = Math.max(1, params?.page || 1);
    const limit = Math.max(1, Math.min(100, params?.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = { tenantId };

    if (params?.branchId) where.branchId = params.branchId;
    if (params?.status && params.status !== 'ALL') where.status = params.status;

    if (params?.search) {
      const q = params.search.trim();
      where.OR = [
        { claimNumber: { contains: q, mode: 'insensitive' } },
        { serialNumber: { contains: q, mode: 'insensitive' } },
        { customerName: { contains: q, mode: 'insensitive' } },
        { customerPhone: { contains: q, mode: 'insensitive' } },
        { productName: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, claims, statusCounts] = await Promise.all([
      prisma.warrantyClaim.count({ where }),
      prisma.warrantyClaim.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: true,
          branch: { select: { id: true, name: true, code: true } },
          variant: { include: { product: true } },
          logs: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
      prisma.warrantyClaim.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { status: true },
      }),
    ]);

    const counts: Record<string, number> = {
      RECEIVED: 0,
      IN_DIAGNOSIS: 0,
      AWAITING_PARTS: 0,
      SENT_TO_VENDOR: 0,
      REPAIRED: 0,
      REPLACED: 0,
      REJECTED: 0,
      CLOSED: 0,
    };

    for (const sc of statusCounts) {
      counts[sc.status] = sc._count.status;
    }

    return {
      claims,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      summaryCounts: counts,
    };
  }

  /**
   * Retrieves full single claim details with timeline history.
   */
  static async getClaimById(tenantIdArg: string | undefined, claimId: string) {
    const tenantId = this.resolveTenantId(tenantIdArg);

    const claim = await prisma.warrantyClaim.findFirst({
      where: { id: claimId, tenantId },
      include: {
        customer: true,
        order: {
          include: {
            items: {
              include: {
                variant: { include: { product: true } },
              },
            },
          },
        },
        productSerial: {
          include: {
            variant: { include: { product: true } },
          },
        },
        variant: {
          include: { product: true },
        },
        branch: true,
        logs: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!claim) {
      throw new Error(`Warranty claim not found: ${claimId}`);
    }

    return claim;
  }

  /**
   * Updates claim status, diagnostic details, resolution, and records timeline audit log.
   */
  static async updateClaimStatus(tenantIdArg: string | undefined, claimId: string, data: UpdateClaimDTO) {
    const tenantId = this.resolveTenantId(tenantIdArg);

    const existingClaim = await prisma.warrantyClaim.findFirst({
      where: { id: claimId, tenantId },
      include: { productSerial: true },
    });

    if (!existingClaim) {
      throw new Error(`Warranty claim not found: ${claimId}`);
    }

    const previousStatus = existingClaim.status;
    const newStatus = data.status || previousStatus;

    const isCompletionStatus = ['REPAIRED', 'REPLACED', 'REJECTED', 'CLOSED'].includes(newStatus);

    const updated = await prisma.$transaction(async (tx) => {
      // 1. Update WarrantyClaim fields
      const result = await tx.warrantyClaim.update({
        where: { id: claimId },
        data: {
          status: newStatus,
          resolutionType: data.resolutionType || (data as any).resolutionNotes || existingClaim.resolutionType,
          replacementSerial: data.replacementSerial || (data as any).replacementSerialNumber || existingClaim.replacementSerial,
          diagnosticNotes: data.diagnosticNotes !== undefined ? data.diagnosticNotes : existingClaim.diagnosticNotes,
          technicianNotes: data.technicianNotes !== undefined ? data.technicianNotes : ((data as any).resolutionNotes || existingClaim.technicianNotes),
          technicianName: data.technicianName || (data as any).performedBy || existingClaim.technicianName,
          repairCost: data.repairCost !== undefined ? data.repairCost : (((data as any).laborCost !== undefined || (data as any).partsCost !== undefined) ? (((data as any).laborCost || 0) + ((data as any).partsCost || 0)) : existingClaim.repairCost),
          customerCharge: data.customerCharge !== undefined ? data.customerCharge : existingClaim.customerCharge,
          completedAt: isCompletionStatus && !existingClaim.completedAt ? new Date() : existingClaim.completedAt,
        },
        include: {
          logs: { orderBy: { createdAt: 'asc' } },
          productSerial: true,
          customer: true,
          variant: { include: { product: true } },
        },
      });

      // 2. Adjust Serial statuses based on resolution
      if (existingClaim.productSerialId) {
        if (newStatus === 'REPLACED') {
          await tx.productSerial.update({
            where: { id: existingClaim.productSerialId },
            data: { status: 'DEFECTIVE' },
          });

          // If a new replacement serial was given from stock, mark it as SOLD
          if (data.replacementSerial) {
            await tx.productSerial.updateMany({
              where: {
                tenantId,
                serialNumber: data.replacementSerial.trim(),
                status: 'IN_STOCK',
              },
              data: {
                status: 'SOLD',
                purchaseDate: new Date(),
              },
            });
          }
        } else if (newStatus === 'CLOSED' || newStatus === 'REPAIRED') {
          await tx.productSerial.update({
            where: { id: existingClaim.productSerialId },
            data: { status: 'SOLD' },
          });
        }
      }

      // 3. Create Audit Timeline entry if status or notes changed
      const actionType =
        newStatus !== previousStatus
          ? 'STATUS_CHANGE'
          : data.diagnosticNotes
          ? 'DIAGNOSIS_UPDATED'
          : 'NOTE_ADDED';

      await tx.warrantyClaimLog.create({
        data: {
          claimId,
          action: actionType,
          fromStatus: previousStatus,
          toStatus: newStatus,
          note: data.note || `Claim status updated from ${previousStatus} to ${newStatus}`,
          performedBy: data.performedBy || data.technicianName || 'Staff Member',
        },
      });

      return result;
    });

    return updated;
  }

  /**
   * Retrieves high-level Warranty KPIs for merchant dashboards.
   */
  static async getWarrantyKPIs(tenantIdArg?: string) {
    const tenantId = this.resolveTenantId(tenantIdArg);
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalSerials, activeWarranties, openClaims, inDiagnosis, resolvedThisMonth] = await Promise.all([
      prisma.productSerial.count({ where: { tenantId } }),
      prisma.productSerial.count({
        where: {
          tenantId,
          status: { in: ['SOLD', 'UNDER_WARRANTY'] },
          warrantyExpiresAt: { gte: now },
        },
      }),
      prisma.warrantyClaim.count({
        where: {
          tenantId,
          status: { in: ['RECEIVED', 'IN_DIAGNOSIS', 'AWAITING_PARTS', 'SENT_TO_VENDOR'] },
        },
      }),
      prisma.warrantyClaim.count({
        where: { tenantId, status: 'IN_DIAGNOSIS' },
      }),
      prisma.warrantyClaim.count({
        where: {
          tenantId,
          status: { in: ['REPAIRED', 'REPLACED', 'CLOSED'] },
          completedAt: { gte: startOfMonth },
        },
      }),
    ]);

    return {
      totalSerials,
      activeWarranties,
      openClaims,
      inDiagnosis,
      resolvedThisMonth,
    };
  }
}

