import prisma from '../config/prisma';
import { GeneralLedgerService } from './gl.service';
import { SequenceService } from './sequence.service';

export interface CreateSalesInvoiceDTO {
  tenantId?: string | null;
  customerId: string;
  branchId: string;
  orderId?: string;
  invoiceType?: 'QUOTATION' | 'PROFORMA' | 'COMMERCIAL';
  invoiceNumber?: string;
  subtotal: number;
  tax?: number;
  dueDate: string | Date;
}

export class AccountsReceivableService {
  /**
   * Generates a formal Quotation, Proforma, or Commercial Tax Invoice
   */
  static async createSalesInvoice(data: any) {
    let customerId = data.customerId;
    if (!customerId && (data.customerName || data.name)) {
      const name = data.customerName || data.name;
      let cust = await (prisma as any).customer.findFirst({
        where: {
          OR: [{ firstName: name }, { companyName: name }],
          ...(data.tenantId ? { tenantId: data.tenantId } : {})
        }
      });
      if (!cust) {
        cust = await (prisma as any).customer.create({
          data: {
            firstName: name,
            companyName: name,
            tenantId: data.tenantId || null,
            email: `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}@client.lk`,
            phone: data.customerPhone || '+94770000000'
          }
        });
      }
      customerId = cust.id;
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
    const invoiceType = data.invoiceType || 'COMMERCIAL';
    const prefix = invoiceType === 'QUOTATION' ? 'QUO' : invoiceType === 'PROFORMA' ? 'PRO' : 'INV';
    const invoiceNumber = data.invoiceNumber || await SequenceService.getNextSequence(prefix, data.tenantId);

    const invoice = await (prisma as any).salesInvoice.create({
      data: {
        tenantId: data.tenantId || null,
        invoiceNumber,
        invoiceType,
        customerId,
        branchId,
        orderId: data.orderId || null,
        subtotal,
        tax,
        total,
        amountPaid: 0,
        balanceDue: total,
        status: invoiceType === 'COMMERCIAL' ? 'ISSUED' : 'DRAFT',
        dueDate: new Date(data.dueDate || Date.now() + 30 * 86400000)
      }
    });

    // If Commercial Invoice, post GL entry: Debit 1100 AR, Credit 4000 Sales Revenue
    if (invoiceType === 'COMMERCIAL') {
      try {
        await GeneralLedgerService.postJournalEntry({
          tenantId: data.tenantId,
          reference: invoice.invoiceNumber,
          description: `Commercial Invoice #${invoice.invoiceNumber}`,
          lines: [
            { accountCode: '1100', debit: total, credit: 0, description: 'Customer AR Asset' },
            { accountCode: '4000', debit: 0, credit: subtotal, description: 'Sales Revenue' },
            ...(tax > 0 ? [{ accountCode: '2100', debit: 0, credit: tax, description: 'VAT / Tax Payable' }] : [])
          ]
        });
      } catch (e) {
        // Graceful
      }
    }

    return invoice;
  }

  /**
   * Records receipt of customer payment against commercial invoice
   */
  static async recordCustomerPayment(data: {
    invoiceId: string;
    amount: number;
    paymentMethod: 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'LANKA_QR';
    reference?: string;
  }) {
    const invoice = await (prisma as any).salesInvoice.findUnique({
      where: { id: data.invoiceId }
    });

    if (!invoice) throw new Error(`Invoice ${data.invoiceId} not found.`);

    if (data.amount <= 0 || data.amount > invoice.balanceDue) {
      throw new Error(`Invalid payment amount: Rs. ${data.amount}. Balance due is Rs. ${invoice.balanceDue}`);
    }

    const newAmountPaid = invoice.amountPaid + data.amount;
    const newBalanceDue = Math.max(0, invoice.total - newAmountPaid);
    const newStatus = newBalanceDue === 0 ? 'PAID' : 'PARTIALLY_PAID';

    const updated = await (prisma as any).salesInvoice.update({
      where: { id: data.invoiceId },
      data: {
        amountPaid: newAmountPaid,
        balanceDue: newBalanceDue,
        status: newStatus
      }
    });

    // GL: Debit Cash/Bank, Credit 1100 AR
    const debitAccount = data.paymentMethod === 'CASH' ? '1010' : '1020';
    try {
      await GeneralLedgerService.postJournalEntry({
        tenantId: invoice.tenantId,
        reference: data.reference || `REC-${invoice.invoiceNumber}`,
        description: `Customer Receipt for Invoice ${invoice.invoiceNumber} via ${data.paymentMethod}`,
        lines: [
          { accountCode: debitAccount, debit: data.amount, credit: 0, description: 'Receipt Inward' },
          { accountCode: '1100', debit: 0, credit: data.amount, description: 'Clear AR Debt' }
        ]
      });
    } catch (e) {
      // Graceful
    }

    return updated;
  }

  /**
   * Generates AR Aging Report (Current, 1-30, 31-60, 61-90, 90+ days)
   */
  static async getArAgingReport(tenantId?: string | null) {
    const where: any = {
      invoiceType: 'COMMERCIAL',
      status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
      balanceDue: { gt: 0 }
    };
    if (tenantId) where.tenantId = tenantId;

    const invoices = await (prisma as any).salesInvoice.findMany({
      where,
      orderBy: { dueDate: 'asc' }
    });

    const now = new Date().getTime();
    const buckets = {
      current: 0,
      days1_30: 0,
      days31_60: 0,
      days61_90: 0,
      days90_plus: 0,
      totalDue: 0,
      invoices: [] as any[]
    };

    for (const inv of invoices) {
      const dueTime = new Date(inv.dueDate).getTime();
      const overdueDays = Math.floor((now - dueTime) / (1000 * 60 * 60 * 24));
      const amount = inv.balanceDue;

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

      buckets.invoices.push({
        ...inv,
        overdueDays: Math.max(0, overdueDays)
      });
    }

    return buckets;
  }
}

