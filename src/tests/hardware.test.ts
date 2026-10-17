import { HardwareService } from '../services/hardware.service';

describe('Enterprise POS Hardware Integration Suite (Task 6)', () => {
  describe('80mm & 58mm ESC/POS Thermal Receipt Builder', () => {
    it('generates valid ESC/POS byte sequence with initialization and paper cut command', () => {
      const buffer = HardwareService.buildEscPosReceipt({
        companyName: 'XONIT Luxury Boutique',
        orderNumber: 'INV-998822',
        cashierName: 'Asitha K.',
        date: '2026-10-18 14:30',
        items: [
          { name: 'Organic Ceylon Tea (500g)', quantity: 2, unitPriceLkr: 1200, totalLkr: 2400 },
          { name: 'Artisan Sourdough Loaf', quantity: 1, unitPriceLkr: 850, totalLkr: 850 },
        ],
        subtotalLkr: 3250,
        discountLkr: 250,
        totalLkr: 3000,
        paymentMethod: 'CASH',
      });

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(100);

      // Verify ESC @ (0x1B, 0x40) initialization at the start
      expect(buffer[0]).toBe(0x1b);
      expect(buffer[1]).toBe(0x40);

      // Verify GS V 65 16 (0x1D, 0x56, 0x41, 0x10) paper cut at the end
      const cutSeq = [0x1d, 0x56, 0x41, 0x10];
      const endBytes = Array.from(buffer.slice(-4));
      expect(endBytes).toEqual(cutSeq);

      // Verify content is encoded properly
      const rawString = buffer.toString('utf-8');
      expect(rawString).toContain('XONIT Luxury Boutique');
      expect(rawString).toContain('INV-998822');
      expect(rawString).toContain('TOTAL: Rs. 3,000');
    });

    it('generates 58mm narrower formatting when paper width is 58', () => {
      const buffer58 = HardwareService.buildEscPosReceipt(
        {
          companyName: 'XONIT Express Kiosk',
          orderNumber: 'K-01',
          cashierName: 'Mobile Cashier',
          date: '2026-10-18',
          items: [{ name: 'Espresso', quantity: 1, unitPriceLkr: 450, totalLkr: 450 }],
          subtotalLkr: 450,
          discountLkr: 0,
          totalLkr: 450,
          paymentMethod: 'LANKA_QR',
        },
        58
      );

      const content = buffer58.toString('utf-8');
      expect(content).toContain('='.repeat(32)); // 32 chars wide divider
    });
  });

  describe('Electronic Cash Drawer RJ11 Kick Pulse', () => {
    it('generates standard ESC/POS pulse for Pin 2', () => {
      const pulsePin2 = HardwareService.getCashDrawerPulse(2);
      expect(Array.from(pulsePin2)).toEqual([0x1b, 0x70, 0x00, 25, 250]);
    });

    it('generates ESC/POS pulse for Pin 5', () => {
      const pulsePin5 = HardwareService.getCashDrawerPulse(5);
      expect(Array.from(pulsePin5)).toEqual([0x1b, 0x70, 0x01, 25, 250]);
    });
  });

  describe('RS-232 Weighing Scale Stream Parser', () => {
    it('correctly parses CAS PD-II protocol format with ST (stable) and GS (gross weight)', () => {
      const raw = 'ST,GS,+  1.450kg\r\n';
      const parsed = HardwareService.parseScaleStream(raw);

      expect(parsed.weight).toBe(1.45);
      expect(parsed.unit).toBe('kg');
      expect(parsed.isStable).toBe(true);
    });

    it('identifies unstable scale readings (US)', () => {
      const raw = 'US,GS,+  0.825kg\r\n';
      const parsed = HardwareService.parseScaleStream(raw);

      expect(parsed.weight).toBe(0.825);
      expect(parsed.isStable).toBe(false);
    });

    it('correctly parses Toledo and Avery Berkel continuous streams', () => {
      const raw = 'W:  2.345kg\r\n';
      const parsed = HardwareService.parseScaleStream(raw);

      expect(parsed.weight).toBe(2.345);
      expect(parsed.unit).toBe('kg');
      expect(parsed.isStable).toBe(true);
    });

    it('handles grams and pounds units gracefully', () => {
      const gramsRaw = 'ST,GS,+  500g\r';
      const parsedGrams = HardwareService.parseScaleStream(gramsRaw);

      expect(parsedGrams.weight).toBe(500);
      expect(parsedGrams.unit).toBe('g');
    });
  });

  describe('TSPL Barcode Label Generator for Thermal Roll Printers', () => {
    it('formats TSPL instructions matching 50x25mm roll geometry', () => {
      const tspl = HardwareService.generateTsplLabel(
        'Ceylon Cinnamon Quill Grade ALBA',
        'SKU-CIN-001',
        1850
      );

      expect(tspl).toContain('SIZE 50 mm, 25 mm');
      expect(tspl).toContain('CLS');
      expect(tspl).toContain('BARCODE 20,95,"128",45,1,0,2,2,"SKU-CIN-001"');
      expect(tspl).toContain('Rs. 1,850');
      expect(tspl).toContain('PRINT 1,1');
    });
  });
});
