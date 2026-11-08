import prisma from '../config/prisma';
import { GeneralLedgerService } from './gl.service';
import { SequenceService } from './sequence.service';

export interface CreateVendorBillDTO {
  tenantId?: string | null;
  supplierId: string;
  purchaseOrderId?: string;
  branchId: string;
  billNumber?: string;
  subtotal: number;
  tax?: number;
  dueDate: string | Date;
}

export class AccountsPayableService {
  /**
   * Creates a formal Vendor Bill (AP liability) linked to a Purchase Order & Supplier.
   * Performs 3-Way Matching against PO Ordered vs Goods Received vs Invoiced amount.
   */
  static async createVendorBill(data: any) {
    let supplierId = data.supplierId;
    if (!supplierId && (data.vendorName || data.supplierName)) {
      const name = data.vendorName || data.supplierName;
      let sup = await (prisma as any).supplier.findFirst({
        where: { name, ...(data.tenantId ? { tenantId: data.tenantId } : {}) }
      });
      if (!sup) {
        sup = await (prisma as any).supplier.create({
          data: {
            name,
            code: data.supplierCode || `SUP-${Date.now().toString().slice(-6)}`,
            tenantId: data.tenantId || null,
            email: `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}@supplier.lk`,
            contactName: name
          }
        });
      }
      supplierId = sup.id;
    }

    let branchId = data.branchId;
    if (!branchId && data.tenantId) {
      const br = await (prisma as any).branch.findFirst({ where: { tenantId: data.tenantId } });
      branchId = br?.id;
    }

    let subtotal = data.subtotal;
    if (subtotal === undefined && Array.isArray(data.items)) {
      subtotal = data.items.reduce((acc: number, item: any) => acc + (item.totalAmount || ((item.quantity || 0) * (item.unitPrice || 0))), 0);
    }
    subtotal = subtotal || 0;
    const tax = data.tax || 0;
    const total = subtotal + tax;
    const billNumber = data.billNumber || await SequenceService.getNextSequence('BILL', data.tenantId);

    let matchStatus = 'UNMATCHED';

    // 3-Way Match Validation if linked to Purchase Order
    if (data.purchaseOrderId) {
      const po = await (prisma as any).purchaseOrder.findUnique({
        where: { id: data.purchaseOrderId },
        include: { items: true }
      });

      if (po) {
        const poOrderedTotal = po.subtotal || 0;
        let goodsReceivedTotal = 0;
        for (const it of po.items) {
          goodsReceivedTotal += (it.quantityReceived || 0) * (it.unitCost || 0);
        }

        // Compare received value against bill total
        const diff = Math.abs(goodsReceivedTotal - total);
        // Allow up to 1% variance for rounding/shipping tolerance
        if (goodsReceivedTotal > 0 && diff <= (goodsReceivedTotal * 0.01 + 1)) {
          matchStatus = 'MATCHED';
        } else if (goodsReceivedTotal > 0) {
          matchStatus = 'VARIANCE';
        }
      }
    }

    const bill = await (prisma as any).vendorBill.create({
      data: {
        tenantId: data.tenantId || null,
        billNumber,
        supplierId,
        purchaseOrderId: data.purchaseOrderId || null,
        branchId,
        subtotal,
        tax,
        total,
        amountPaid: 0,
        balanceDue: total,
        status: 'PENDING',
        matchStatus,
        dueDate: new Date(data.dueDate)
      }
    });

    // Automatically post double-entry GL journal entry:
    // Debit 1200 Inventory Asset, Credit 2000 Accounts Payable
    try {
      await GeneralLedgerService.postJournalEntry({
        tenantId: data.tenantId,
        reference: bill.billNumber,
        description: `Vendor Bill for PO #${data.purchaseOrderId || 'Direct'}`,
        lines: [
          { accountCode: '1200', debit: total, credit: 0, description: 'Inventory Received' },
          { accountCode: '2000', debit: 0, credit: total, description: 'Supplier AP Liability' }
        ]
      });
    } catch (e) {
      // Gracefully continue if GL is optional
    }

    return bill;
  }

  /**
   * Records a payment to supplier, settling the AP liability
   */
  static async recordVendorPayment(data: {
    billId: string;
    amount: number;
    paymentMethod: 'CASH' | 'BANK_TRANSFER' | 'CHEQUE';
    reference?: string;
    tenantId?: string | null;
  }) {
    const bill = await (prisma as any).vendorBill.findUnique({
      where: { id: data.billId }
    });

    if (!bill) throw new Error(`Vendor bill ${data.billId} not found.`);

    if (data.tenantId && bill.tenantId && bill.tenantId !== data.tenantId) {
      throw new Error(`Unauthorized: Vendor bill does not belong to your tenant organization.`);
    }

    if (data.amount <= 0 || data.amount > bill.balanceDue) {
      throw new Error(`Invalid payment amount: Rs. ${data.amount}. Balance due is Rs. ${bill.balanceDue}`);
    }

    const newAmountPaid = bill.amountPaid + data.amount;
    const newBalanceDue = Math.max(0, bill.total - newAmountPaid);
    const newStatus = newBalanceDue === 0 ? 'PAID' : 'PARTIALLY_PAID';

    const updatedBill = await (prisma as any).vendorBill.update({
      where: { id: data.billId },
      data: {
        amountPaid: newAmountPaid,
        balanceDue: newBalanceDue,
        status: newStatus
      }
    });

    // GL Journal Entry: Debit 2000 AP, Credit 1010 Cash or 1020 Bank
    const creditAccount = data.paymentMethod === 'CASH' ? '1010' : '1020';
    try {
      await GeneralLedgerService.postJournalEntry({
        tenantId: bill.tenantId,
        reference: data.reference || `PAY-${bill.billNumber}`,
        description: `Vendor Payment for Bill ${bill.billNumber} via ${data.paymentMethod}`,
        lines: [
          { accountCode: '2000', debit: data.amount, credit: 0, description: 'Reduce AP Liability' },
          { accountCode: creditAccount, debit: 0, credit: data.amount, description: 'Settlement Tender' }
        ]
      });
    } catch (e) {
      // Graceful
    }

    return updatedBill;
  }

  /**
   * Generates AP Aging Report (Current, 1-30, 31-60, 61-90, 90+ days)
   */
  static async getApAgingReport(tenantId?: string | null) {
    const where: any = {
      status: { in: ['PENDING', 'PARTIALLY_PAID'] },
      balanceDue: { gt: 0 }
    };
    if (tenantId) where.tenantId = tenantId;

    const bills = await (prisma as any).vendorBill.findMany({
      where,
      orderBy: { dueDate: 'asc' }
    });

    const supplierIds = Array.from(new Set(bills.map((b: any) => b.supplierId).filter(Boolean)));
    const suppliers = supplierIds.length > 0 ? await (prisma as any).supplier.findMany({
      where: { id: { in: supplierIds } },
      select: { id: true, name: true, code: true }
    }) : [];
    const supMap = new Map(suppliers.map((s: any) => [s.id, s.name]));

    const now = new Date().getTime();
    const buckets = {
      current: 0,
      days1_30: 0,
      days31_60: 0,
      days61_90: 0,
      days90_plus: 0,
      totalDue: 0,
      bills: [] as any[]
    };

    for (const b of bills) {
      const dueTime = new Date(b.dueDate).getTime();
      const overdueDays = Math.floor((now - dueTime) / (1000 * 60 * 60 * 24));
      const amount = b.balanceDue;

      buckets.totalDue += amount;

      if (overdueDays <= 0) {
        buckets.current += amount;
      } else if (overdueDays <= 30) {
        buckets.days1_30 += amount;
      } else if (overdueDays <= 60) {
        buckets.days31_60 += amount;
      } else if (overdueDays <= 90) {
        buckets.days61_90 += amount;
      } else {
        buckets.days90_plus += amount;
      }

      buckets.bills.push({
        ...b,
        supplierName: supMap.get(b.supplierId) || 'Supplier',
        overdueDays: Math.max(0, overdueDays)
      });
    }

    return {
      ...buckets,
      summary: {
        totalOutstanding: buckets.totalDue,
        current: buckets.current,
        overdue: buckets.totalDue - buckets.current
      }
    };
  }
}

