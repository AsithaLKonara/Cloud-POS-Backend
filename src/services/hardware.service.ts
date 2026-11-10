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

export type PoleDisplayProtocol = 'PRICE_DISPLAY' | 'CD5220' | 'ESCPOS' | 'UTC' | 'AEDEX';

export interface PoleDisplayLines {
  line1: string;
  line2: string;
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
    if (casMatch && casMatch[1] && casMatch[3] && casMatch[4]) {
      const isStable = casMatch[1].toUpperCase() === 'ST';
      const weight = parseFloat(casMatch[3].replace(/\s+/g, ''));
      const unit = casMatch[4].toLowerCase() as 'kg' | 'g' | 'lb';
      return { weight: isNaN(weight) ? 0 : weight, unit, isStable, raw: clean };
    }

    // Protocol 2: Toledo / Avery format: "W:  1.450kg" or "NET  1.450 kg"
    const toledoMatch = clean.match(/(?:W:|NET|WT:)\s*([+-]?\d+\.?\d*)\s*(kg|g|lb)/i);
    if (toledoMatch && toledoMatch[1] && toledoMatch[2]) {
      const weight = parseFloat(toledoMatch[1]);
      const unit = toledoMatch[2].toLowerCase() as 'kg' | 'g' | 'lb';
      return { weight: isNaN(weight) ? 0 : weight, unit, isStable: true, raw: clean };
    }

    // Protocol 3: Raw numeric stream
    const rawMatch = clean.match(/([+-]?\d+\.?\d*)\s*(kg|g|lb)?/i);
    if (rawMatch && rawMatch[1]) {
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

  /**
   * Parses EAN-13 in-store scale barcodes (prefixes 20-29).
   * Commonly used for produce, meats, bulk grains, and deli items.
   * Format:
   *  - Prefixes 20, 21, 28: Weight-embedded (20AAAAAWWWWW C) where WWWWW = weight in grams (e.g. 01450 = 1.450 kg)
   *  - Prefixes 22, 23: Price-embedded (22AAAAAPPPPP C) where PPPPP = price in cents/cents-equivalent
   */
  static parseEmbeddedScaleBarcode(barcode: string): {
    isScaleBarcode: boolean;
    prefix?: string;
    itemCode?: string;
    weightKg?: number;
    price?: number;
  } {
    const clean = barcode.trim();
    if (clean.length !== 12 && clean.length !== 13) {
      return { isScaleBarcode: false };
    }

    const prefix = clean.substring(0, 2);
    const prefixNum = parseInt(prefix, 10);
    if (isNaN(prefixNum) || prefixNum < 20 || prefixNum > 29) {
      return { isScaleBarcode: false };
    }

    const itemCode = clean.substring(2, 7);
    const valuePart = clean.substring(7, 12);
    const numericValue = parseInt(valuePart, 10);

    if (isNaN(numericValue)) {
      return { isScaleBarcode: false };
    }

    if ([20, 21, 24, 25, 28].includes(prefixNum)) {
      // Weight in kilograms (value in grams / 1000)
      return {
        isScaleBarcode: true,
        prefix,
        itemCode,
        weightKg: Math.round((numericValue / 1000) * 1000) / 1000,
      };
    } else {
      // Price-embedded
      return {
        isScaleBarcode: true,
        prefix,
        itemCode,
        price: Math.round((numericValue / 100) * 100) / 100,
      };
    }
  }

  /**
   * Cleans and pads/truncates a string to exact character width (default 20 for standard pole displays).
   */
  static formatPoleDisplayLine(text: string, width = 20): string {
    const clean = (text || '')
      .replace(/[^\x20-\x7E]/g, '') // Keep standard printable ASCII
      .trim();
    if (clean.length > width) {
      return clean.substring(0, width);
    }
    return clean.padEnd(width, ' ');
  }

  /**
   * Centers text within a fixed width (default 20 characters).
   */
  static centerText(text: string, width = 20): string {
    const clean = (text || '').replace(/[^\x20-\x7E]/g, '').trim();
    if (clean.length >= width) return clean.substring(0, width);
    const leftPad = Math.floor((width - clean.length) / 2);
    const rightPad = width - clean.length - leftPad;
    return ' '.repeat(leftPad) + clean + ' '.repeat(rightPad);
  }

  /**
   * Creates a two-column row (left text + right text) fitted to exact width.
   */
  static makeTwoColumnLine(left: string, right: string, width = 20): string {
    const cleanRight = (right || '').replace(/[^\x20-\x7E]/g, '').trim();
    const availableForLeft = Math.max(0, width - cleanRight.length - 1);
    const cleanLeft = (left || '').replace(/[^\x20-\x7E]/g, '').trim().substring(0, availableForLeft);
    const spaces = Math.max(1, width - cleanLeft.length - cleanRight.length);
    return cleanLeft + ' '.repeat(spaces) + cleanRight;
  }

  /**
   * Formats Idle / Welcome screen for 2x20 customer display.
   */
  static formatPoleDisplayIdle(storeName = 'XONIT POS', greeting = 'WELCOME! PLEASE PAY'): PoleDisplayLines {
    return {
      line1: this.centerText(storeName, 20),
      line2: this.centerText(greeting, 20),
    };
  }

  /**
   * Formats Line item screen when cashier scans or updates a product.
   */
  static formatPoleDisplayItem(name: string, price: number, qty = 1, subtotal?: number): PoleDisplayLines {
    const priceStr = price.toFixed(2);
    const line1 = this.makeTwoColumnLine(name, priceStr, 20);

    const calcSubtotal = subtotal !== undefined ? subtotal : price * qty;
    const subStr = `SUB:${calcSubtotal.toFixed(0)}`;
    const qtyStr = `QTY:${qty}`;
    const line2 = this.makeTwoColumnLine(qtyStr, subStr, 20);

    return { line1, line2 };
  }

  /**
   * Formats Payment pending screen showing subtotal and total due.
   */
  static formatPoleDisplayPayment(subtotal: number, totalDue: number): PoleDisplayLines {
    return {
      line1: this.makeTwoColumnLine('SUBTOTAL:', `Rs.${subtotal.toLocaleString()}`, 20),
      line2: this.makeTwoColumnLine('TOTAL DUE:', `Rs.${totalDue.toLocaleString()}`, 20),
    };
  }

  /**
   * Formats Sale Completed screen showing tender received and change due.
   */
  static formatPoleDisplayCompleted(amountPaid: number, changeDue: number): PoleDisplayLines {
    return {
      line1: this.makeTwoColumnLine('PAID CASH:', `Rs.${amountPaid.toLocaleString()}`, 20),
      line2: this.makeTwoColumnLine('CHANGE DUE:', `Rs.${changeDue.toLocaleString()}`, 20),
    };
  }

  /**
   * Generates binary command buffer for 2x20 VFD / LCD Pole Displays.
   * Supports CD5220 (Posiflex/Generic), ESC/POS (Epson DM-D), UTC Standard, and AEDEX.
   */
  static buildPoleDisplayBuffer(
    line1: string,
    line2: string,
    protocol: PoleDisplayProtocol = 'CD5220'
  ): Buffer {
    const l1 = this.formatPoleDisplayLine(line1, 20);
    const l2 = this.formatPoleDisplayLine(line2, 20);
    const parts: number[] = [];

    switch (protocol) {
      case 'PRICE_DISPLAY': {
        // Single-line 8-digit LED / VFD Price Display (ESC Q A protocol, e.g. LED8 / LED8N / DSP-840)
        const combined = `${line1} ${line2}`;
        const noCommas = combined.replace(/,/g, '');
        let indicator = 0; // 0=None, 1=Price, 2=Total, 3=Collect, 4=Change
        let amountStr = '0.00';

        if (/change/i.test(noCommas)) {
          indicator = 4;
          const m = noCommas.match(/\bchange(?:\s+due)?[:\s]+(?:rs\.?\s*)?(\d+(?:\.\d+)?)/i);
          amountStr = (m && m[1]) || (noCommas.match(/-?\d+(?:\.\d+)?/)?.[0] || '0.00');
        } else if (/\btotal|subtotal|due/i.test(noCommas)) {
          indicator = 2;
          const m = noCommas.match(/\btotal(?:\s+due)?[:\s]+(?:rs\.?\s*)?(\d+(?:\.\d+)?)/i) ||
                    noCommas.match(/\bsubtotal[:\s]+(?:rs\.?\s*)?(\d+(?:\.\d+)?)/i);
          amountStr = (m && m[1]) || (noCommas.match(/-?\d+(?:\.\d+)?/)?.[0] || '0.00');
        } else if (/paid|cash|collect/i.test(noCommas)) {
          indicator = 3;
          const m = noCommas.match(/\b(?:paid|cash|collect)[:\s]+(?:rs\.?\s*)?(\d+(?:\.\d+)?)/i);
          amountStr = (m && m[1]) || (noCommas.match(/-?\d+(?:\.\d+)?/)?.[0] || '0.00');
        } else if (/qty|price|item|\d+\.\d{2}/i.test(noCommas)) {
          indicator = 1;
          const m = noCommas.match(/\b(?:price|sub)?[:\s]+(?:rs\.?\s*)?(\d+(?:\.\d+)?)/i);
          amountStr = (m && m[1]) || (noCommas.match(/-?\d+(?:\.\d+)?/)?.[0] || '0.00');
        } else {
          const m = noCommas.match(/-?\d+(?:\.\d+)?/);
          amountStr = (m && m[0]) || '0.00';
        }

        const cleanAmount = amountStr.substring(0, 10);

        // CLR (0x0C)
        parts.push(0x0c);
        // Set Indicator Lamp: ESC s <n> (0x1B, 0x73, 0x30 + indicator)
        parts.push(0x1b, 0x73, 0x30 + indicator);
        // ESC Q A <number> CR (0x1B, 0x51, 0x41 ... 0x0D)
        parts.push(0x1b, 0x51, 0x41);
        parts.push(...Buffer.from(cleanAmount, 'ascii'));
        parts.push(0x0d);
        break;
      }

      case 'CD5220': {
        // Posiflex / DSP800 / E-POS / Standard Chinese Generic VFD
        // ESC @ (Initialize)
        parts.push(0x1b, 0x40);
        // Form Feed / Clear Display (0x0C)
        parts.push(0x0c);
        // Overwrite Line 1: ESC Q A <text> CR
        parts.push(0x1b, 0x51, 0x41);
        parts.push(...Buffer.from(l1, 'ascii'));
        parts.push(0x0d);
        // Overwrite Line 2: ESC Q B <text> CR
        parts.push(0x1b, 0x51, 0x42);
        parts.push(...Buffer.from(l2, 'ascii'));
        parts.push(0x0d);
        break;
      }

      case 'ESCPOS': {
        // Epson DM-D110, DM-D210, Bixolon, Citizen
        // ESC @ (Initialize)
        parts.push(0x1b, 0x40);
        // Clear Display
        parts.push(0x0c);
        // Move to row 1 col 1: US $ 1 1
        parts.push(0x1f, 0x24, 0x01, 0x01);
        parts.push(...Buffer.from(l1, 'ascii'));
        // Move to row 2 col 1: US $ 1 2
        parts.push(0x1f, 0x24, 0x01, 0x02);
        parts.push(...Buffer.from(l2, 'ascii'));
        break;
      }

      case 'UTC': {
        // UTC Standard / Enhanced (UTC, Firich)
        // Clear Display
        parts.push(0x0c);
        // Move to Line 1 (0x0B)
        parts.push(0x0b);
        parts.push(...Buffer.from(l1, 'ascii'));
        // Move to Line 2 (0x1F, 0x42)
        parts.push(0x1f, 0x42);
        parts.push(...Buffer.from(l2, 'ascii'));
        break;
      }

      case 'AEDEX': {
        // AEDEX protocol
        // Line 1: ! # 1 <text> CR
        parts.push(0x21, 0x23, 0x31);
        parts.push(...Buffer.from(l1, 'ascii'));
        parts.push(0x0d);
        // Line 2: ! # 2 <text> CR
        parts.push(0x21, 0x23, 0x32);
        parts.push(...Buffer.from(l2, 'ascii'));
        parts.push(0x0d);
        break;
      }

      default: {
        // Plain ASCII fallback (Line 1 + CRLF + Line 2)
        parts.push(...Buffer.from(`${l1}\r\n${l2}`, 'ascii'));
        break;
      }
    }

    return Buffer.from(parts);
  }
}
