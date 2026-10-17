export interface EscPosReceiptData {
  companyName: string;
  orderNumber: string;
  cashierName: string;
  date: string;
  items: Array<{
    name: string;
    quantity: number;
    unitPriceLkr: number;
    totalLkr: number;
  }>;
  subtotalLkr: number;
  discountLkr: number;
  totalLkr: number;
  paymentMethod: string;
}

export interface ScaleReading {
  weight: number;
  unit: 'kg' | 'g' | 'lb';
  isStable: boolean;
  raw: string;
}

export class HardwareService {
  /**
   * Generates raw ESC/POS byte array for 80mm / 58mm thermal printers
   */
  static buildEscPosReceipt(data: EscPosReceiptData, paperWidth: 80 | 58 = 80): Buffer {
    const charsPerLine = paperWidth === 80 ? 48 : 32;
    const parts: number[] = [];

    // ESC @ (Initialize)
    parts.push(0x1b, 0x40);

    // ESC a 1 (Center Align)
    parts.push(0x1b, 0x61, 0x01);
    // Double Height + Double Width for Store Name
    parts.push(0x1d, 0x21, 0x11);
    parts.push(...Buffer.from(`${data.companyName}\n`, 'utf-8'));
    parts.push(0x1d, 0x21, 0x00);

    parts.push(...Buffer.from('='.repeat(charsPerLine) + '\n', 'utf-8'));

    // Left Align Header details
    parts.push(0x1b, 0x61, 0x00);
    parts.push(...Buffer.from(`Receipt: #${data.orderNumber}\n`, 'utf-8'));
    parts.push(...Buffer.from(`Cashier: ${data.cashierName}\n`, 'utf-8'));
    parts.push(...Buffer.from(`Date   : ${data.date}\n`, 'utf-8'));
    parts.push(...Buffer.from('-'.repeat(charsPerLine) + '\n', 'utf-8'));

    // Items
    for (const item of data.items) {
      const line = `${item.name} x${item.quantity} - Rs. ${item.totalLkr.toFixed(0)}\n`;
      parts.push(...Buffer.from(line, 'utf-8'));
    }

    parts.push(...Buffer.from('-'.repeat(charsPerLine) + '\n', 'utf-8'));

    // Totals Section (Right Align)
    parts.push(0x1b, 0x61, 0x02);
    parts.push(...Buffer.from(`Subtotal: Rs. ${data.subtotalLkr.toLocaleString()}\n`, 'utf-8'));
    if (data.discountLkr > 0) {
      parts.push(...Buffer.from(`Discount: -Rs. ${data.discountLkr.toLocaleString()}\n`, 'utf-8'));
    }
    parts.push(...Buffer.from(`TOTAL: Rs. ${data.totalLkr.toLocaleString()}\n`, 'utf-8'));

    // Footer & Paper Cut
    parts.push(0x1b, 0x61, 0x01);
    parts.push(...Buffer.from('\nThank you for your business!\nPowered by XONIT POS\n\n\n', 'utf-8'));
    parts.push(0x1d, 0x56, 0x41, 0x10); // Cut

    return Buffer.from(parts);
  }

  /**
   * Generates ESC/POS pulse command to pop RJ11 cash drawer
   */
  static getCashDrawerPulse(pin: 2 | 5 = 2): Buffer {
    return Buffer.from([0x1b, 0x70, pin === 5 ? 1 : 0, 25, 250]);
  }

  /**
   * Robust RS-232 serial scale parser
   */
  static parseScaleStream(raw: string): ScaleReading {
    const clean = raw.trim();

    // Protocol 1: CAS format: "ST,GS,+  1.450kg" or "US,GS,+  0.820kg"
    const casMatch = clean.match(/(ST|US),\s*(GS|NT),\s*([+-]?\s*\d+\.?\d*)\s*(kg|g|lb)/i);
    if (casMatch) {
      const isStable = casMatch[1].toUpperCase() === 'ST';
      const weight = parseFloat(casMatch[3].replace(/\s+/g, ''));
      const unit = casMatch[4].toLowerCase() as 'kg' | 'g' | 'lb';
      return { weight: isNaN(weight) ? 0 : weight, unit, isStable, raw: clean };
    }

    // Protocol 2: Toledo / Avery format: "W:  1.450kg" or "NET  1.450 kg"
    const toledoMatch = clean.match(/(?:W:|NET|WT:)\s*([+-]?\d+\.?\d*)\s*(kg|g|lb)/i);
    if (toledoMatch) {
      const weight = parseFloat(toledoMatch[1]);
      const unit = toledoMatch[2].toLowerCase() as 'kg' | 'g' | 'lb';
      return { weight: isNaN(weight) ? 0 : weight, unit, isStable: true, raw: clean };
    }

    // Protocol 3: Raw numeric stream
    const rawMatch = clean.match(/([+-]?\d+\.?\d*)\s*(kg|g|lb)?/i);
    if (rawMatch) {
      const weight = parseFloat(rawMatch[1]);
      const unit = (rawMatch[2]?.toLowerCase() || 'kg') as 'kg' | 'g' | 'lb';
      return { weight: isNaN(weight) ? 0 : weight, unit, isStable: true, raw: clean };
    }

    return { weight: 0, unit: 'kg', isStable: false, raw: clean };
  }

  /**
   * Generates TSPL label string for barcode sticker printers (50mm x 25mm)
   */
  static generateTsplLabel(productName: string, sku: string, priceLkr: number): string {
    return [
      'SIZE 50 mm, 25 mm',
      'GAP 2 mm, 0 mm',
      'DIRECTION 1',
      'CLS',
      'TEXT 20,20,"0",0,1,1,"XONIT POS"',
      `TEXT 20,45,"TSS24.BF2",0,1,1,"${productName.substring(0, 22)}"`,
      `BARCODE 20,95,"128",45,1,0,2,2,"${sku}"`,
      `TEXT 20,150,"0",0,1,1,"${sku}"`,
      `TEXT 200,145,"0",0,2,2,"Rs. ${priceLkr.toLocaleString()}"`,
      'PRINT 1,1',
      '',
    ].join('\r\n');
  }
}
