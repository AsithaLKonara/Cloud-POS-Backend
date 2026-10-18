export interface ReceiptFormatOptions {
  type: 'RETAIL' | 'RESTAURANT_KOT' | 'SALON_SPA' | 'AUTOMOTIVE';
  tenantName: string;
  currencySymbol?: string;
  order: {
    orderNumber: string;
    createdAt: Date | string;
    cashierName?: string;
    branchName?: string;
    customerName?: string;
    customerPhone?: string;
    diningOption?: string;
    tableName?: string;
    metadata?: Record<string, any>;
    subtotal: number;
    discount?: number;
    tax?: number;
    total: number;
    paymentMethod?: string;
    splitPayments?: { method: string; amount: number; reference?: string }[];
    items: {
      name: string;
      sku?: string;
      quantity: number;
      price: number;
      total: number;
      notes?: string;
      modifiers?: { name: string; price: number }[];
      staffName?: string;
      unit?: string;
    }[];
  };
}

export interface FormattedReceiptPayload {
  receiptType: 'RETAIL' | 'RESTAURANT_KOT' | 'SALON_SPA' | 'AUTOMOTIVE';
  orderNumber: string;
  title: string;
  lines: { text: string; align?: 'left' | 'center' | 'right'; bold?: boolean; doubleWidth?: boolean }[];
  rawText: string;
}

export class ReceiptService {
  /**
   * Generates a structured receipt payload ready for thermal printing via ESC/POS or web receipt rendering.
   */
  static formatReceipt(options: ReceiptFormatOptions): FormattedReceiptPayload {
    const { type, tenantName, order, currencySymbol = 'Rs.' } = options;
    const lines: { text: string; align?: 'left' | 'center' | 'right'; bold?: boolean; doubleWidth?: boolean }[] = [];
    const dateStr = new Date(order.createdAt).toLocaleString();

    if (type === 'RESTAURANT_KOT') {
      // Kitchen Order Ticket (KOT)
      lines.push({ text: '*** KITCHEN ORDER TICKET ***', align: 'center', bold: true, doubleWidth: true });
      lines.push({ text: `Order #: ${order.orderNumber}`, align: 'left', bold: true });
      if (order.tableName) {
        lines.push({ text: `Table / Station: ${order.tableName}`, align: 'left', bold: true });
      }
      lines.push({ text: `Type: ${order.diningOption || 'DINE_IN'} | Time: ${dateStr}`, align: 'left' });
      if (order.cashierName) {
        lines.push({ text: `Server: ${order.cashierName}`, align: 'left' });
      }
      lines.push({ text: '----------------------------------------', align: 'center' });

      for (const it of order.items) {
        lines.push({ text: `${it.quantity}x ${it.name}`, align: 'left', bold: true });
        if (it.modifiers && it.modifiers.length > 0) {
          for (const mod of it.modifiers) {
            lines.push({ text: `   + ${mod.name}`, align: 'left' });
          }
        }
        if (it.notes) {
          lines.push({ text: `   * NOTE: ${it.notes}`, align: 'left', bold: true });
        }
      }
      lines.push({ text: '----------------------------------------', align: 'center' });
    } else if (type === 'SALON_SPA') {
      // Salon & Wellness Appointment Slip
      lines.push({ text: tenantName.toUpperCase(), align: 'center', bold: true, doubleWidth: true });
      lines.push({ text: 'APPOINTMENT & SERVICE SLIP', align: 'center', bold: true });
      lines.push({ text: `Receipt #: ${order.orderNumber}`, align: 'left' });
      lines.push({ text: `Date: ${dateStr}`, align: 'left' });
      if (order.customerName) {
        lines.push({ text: `Client: ${order.customerName} (${order.customerPhone || 'N/A'})`, align: 'left' });
      }
      lines.push({ text: '----------------------------------------', align: 'center' });

      for (const it of order.items) {
        const staffInfo = it.staffName ? ` [Therapist: ${it.staffName}]` : '';
        lines.push({ text: `${it.name}${staffInfo}`, align: 'left', bold: true });
        lines.push({ text: `${it.quantity} @ ${currencySymbol} ${it.price.toFixed(2)} = ${currencySymbol} ${it.total.toFixed(2)}`, align: 'right' });
      }
      lines.push({ text: '----------------------------------------', align: 'center' });
      lines.push({ text: `Total: ${currencySymbol} ${order.total.toFixed(2)}`, align: 'right', bold: true, doubleWidth: true });
      lines.push({ text: 'Thank you for your visit! Glow & Relax.', align: 'center' });
    } else if (type === 'AUTOMOTIVE') {
      // Automotive Work Order Slip
      lines.push({ text: tenantName.toUpperCase(), align: 'center', bold: true, doubleWidth: true });
      lines.push({ text: 'SERVICE INVOICE & WORK ORDER', align: 'center', bold: true });
      lines.push({ text: `Invoice #: ${order.orderNumber}`, align: 'left' });
      lines.push({ text: `Date: ${dateStr}`, align: 'left' });
      if (order.metadata?.vehiclePlate) {
        lines.push({ text: `Vehicle: ${order.metadata.vehiclePlate} | Mileage: ${order.metadata.mileage || 'N/A'} km`, align: 'left', bold: true });
      }
      lines.push({ text: '----------------------------------------', align: 'center' });

      for (const it of order.items) {
        lines.push({ text: `${it.name}`, align: 'left' });
        lines.push({ text: `${it.quantity}x @ ${currencySymbol} ${it.price.toFixed(2)} = ${currencySymbol} ${it.total.toFixed(2)}`, align: 'right' });
      }
      lines.push({ text: '----------------------------------------', align: 'center' });
      lines.push({ text: `Subtotal: ${currencySymbol} ${order.subtotal.toFixed(2)}`, align: 'right' });
      if (order.discount && order.discount > 0) {
        lines.push({ text: `Discount: -${currencySymbol} ${order.discount.toFixed(2)}`, align: 'right' });
      }
      lines.push({ text: `Total: ${currencySymbol} ${order.total.toFixed(2)}`, align: 'right', bold: true });
    } else {
      // Standard Retail & General Store Receipt
      lines.push({ text: tenantName.toUpperCase(), align: 'center', bold: true, doubleWidth: true });
      if (order.branchName) {
        lines.push({ text: `Branch: ${order.branchName}`, align: 'center' });
      }
      lines.push({ text: `Receipt #: ${order.orderNumber}`, align: 'left' });
      lines.push({ text: `Date: ${dateStr}`, align: 'left' });
      if (order.customerName) {
        lines.push({ text: `Customer: ${order.customerName}`, align: 'left' });
      }
      lines.push({ text: '----------------------------------------', align: 'center' });

      for (const it of order.items) {
        lines.push({ text: `${it.name}`, align: 'left' });
        lines.push({ text: `${it.quantity}x @ ${currencySymbol} ${it.price.toFixed(2)} = ${currencySymbol} ${it.total.toFixed(2)}`, align: 'right' });
      }
      lines.push({ text: '----------------------------------------', align: 'center' });
      lines.push({ text: `Subtotal: ${currencySymbol} ${order.subtotal.toFixed(2)}`, align: 'right' });
      if (order.discount && order.discount > 0) {
        lines.push({ text: `Discount: -${currencySymbol} ${order.discount.toFixed(2)}`, align: 'right' });
      }
      if (order.tax && order.tax > 0) {
        lines.push({ text: `Tax: ${currencySymbol} ${order.tax.toFixed(2)}`, align: 'right' });
      }
      lines.push({ text: `TOTAL: ${currencySymbol} ${order.total.toFixed(2)}`, align: 'right', bold: true, doubleWidth: true });

      // Payment Tender Breakdown
      if (order.splitPayments && order.splitPayments.length > 0) {
        lines.push({ text: 'Payment Breakdown:', align: 'left', bold: true });
        for (const p of order.splitPayments) {
          lines.push({ text: `  ${p.method}: ${currencySymbol} ${p.amount.toFixed(2)}`, align: 'right' });
        }
      } else if (order.paymentMethod) {
        lines.push({ text: `Paid via: ${order.paymentMethod}`, align: 'right' });
      }

      lines.push({ text: '----------------------------------------', align: 'center' });
      lines.push({ text: 'Thank you for your business!', align: 'center' });
    }

    const rawText = lines.map(l => l.text).join('\n');

    return {
      receiptType: type,
      orderNumber: order.orderNumber,
      title: `${tenantName} - ${type}`,
      lines,
      rawText,
    };
  }
}
