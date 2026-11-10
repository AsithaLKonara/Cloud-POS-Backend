import { HardwareService } from '../services/hardware.service';

describe('Customer Pole Display Protocol & Text Formatting Engine', () => {
  describe('2x20 Character Layout & Text Formatter', () => {
    it('pads strings to exact 20 characters with space padding', () => {
      const line = HardwareService.formatPoleDisplayLine('HELLO');
      expect(line.length).toBe(20);
      expect(line).toBe('HELLO               ');
    });

    it('truncates strings longer than 20 characters cleanly', () => {
      const longText = 'This is an excessively long product name that exceeds 20 characters';
      const line = HardwareService.formatPoleDisplayLine(longText);
      expect(line.length).toBe(20);
      expect(line).toBe('This is an excessive');
    });

    it('strips non-printable ASCII or control characters', () => {
      const dirty = 'ITEM \x00\x07A \t \n';
      const line = HardwareService.formatPoleDisplayLine(dirty);
      expect(line.length).toBe(20);
      expect(line.startsWith('ITEM A')).toBe(true);
    });

    it('centers text evenly for Idle / Welcome screens', () => {
      const idle = HardwareService.formatPoleDisplayIdle('XONIT POS', 'WELCOME!');
      expect(idle.line1.length).toBe(20);
      expect(idle.line2.length).toBe(20);
      expect(idle.line1).toBe('     XONIT POS      ');
      expect(idle.line2).toBe('      WELCOME!      ');
    });

    it('formats scanned item with name, price, quantity, and running subtotal', () => {
      const item = HardwareService.formatPoleDisplayItem('Fresh Milk 1L', 250.0, 2, 500.0);
      expect(item.line1.length).toBe(20);
      expect(item.line2.length).toBe(20);
      expect(item.line1).toBe('Fresh Milk 1L 250.00');
      expect(item.line2).toBe('QTY:2        SUB:500');
    });

    it('formats payment screen showing subtotal and total due', () => {
      const payment = HardwareService.formatPoleDisplayPayment(1450, 1350);
      expect(payment.line1.length).toBe(20);
      expect(payment.line2.length).toBe(20);
      expect(payment.line1).toBe('SUBTOTAL:   Rs.1,450');
      expect(payment.line2).toBe('TOTAL DUE:  Rs.1,350');
    });

    it('formats completion screen with paid amount and change due', () => {
      const done = HardwareService.formatPoleDisplayCompleted(2000, 650);
      expect(done.line1.length).toBe(20);
      expect(done.line2.length).toBe(20);
      expect(done.line1).toBe('PAID CASH:  Rs.2,000');
      expect(done.line2).toBe('CHANGE DUE:   Rs.650');
    });
  });

  describe('Hardware Protocol Binary Generators', () => {
    const l1 = 'XONIT FLAGSHIP STORE';
    const l2 = 'WELCOME TO OUR SHOP!';

    it('generates compliant Price Display (ESC Q A) LED8 byte sequences', () => {
      // Test item scan with Price indicator
      const itemBuffer = HardwareService.buildPoleDisplayBuffer('Ceylon Tea 750.00', 'QTY:1 SUB:750', 'PRICE_DISPLAY');
      expect(itemBuffer).toBeInstanceOf(Buffer);

      // Verify Clear (0x0C)
      expect(itemBuffer[0]).toBe(0x0c);
      // Verify ESC s 1 (Price lamp ON: 0x1B, 0x73, 0x31)
      expect(itemBuffer[1]).toBe(0x1b);
      expect(itemBuffer[2]).toBe(0x73);
      expect(itemBuffer[3]).toBe(0x31);
      // Verify ESC Q A (0x1B, 0x51, 0x41)
      expect(itemBuffer[4]).toBe(0x1b);
      expect(itemBuffer[5]).toBe(0x51);
      expect(itemBuffer[6]).toBe(0x41);
      // Verify numeric digits + CR (0x0D)
      expect(itemBuffer.slice(7, 13).toString('ascii')).toBe('750.00');
      expect(itemBuffer[13]).toBe(0x0d);

      // Test Total Due with Total indicator
      const totalBuffer = HardwareService.buildPoleDisplayBuffer('SUBTOTAL: Rs.1,450', 'TOTAL DUE: Rs.1,350', 'PRICE_DISPLAY');
      expect(totalBuffer[1]).toBe(0x1b);
      expect(totalBuffer[2]).toBe(0x73);
      expect(totalBuffer[3]).toBe(0x32); // Total lamp: '2' (0x32)
      expect(totalBuffer.slice(7, 11).toString('ascii')).toBe('1350');

      // Test Change Due with Change indicator
      const changeBuffer = HardwareService.buildPoleDisplayBuffer('PAID CASH: Rs.2,000', 'CHANGE DUE: Rs.650', 'PRICE_DISPLAY');
      expect(changeBuffer[1]).toBe(0x1b);
      expect(changeBuffer[2]).toBe(0x73);
      expect(changeBuffer[3]).toBe(0x34); // Change lamp: '4' (0x34)
      expect(changeBuffer.slice(7, 10).toString('ascii')).toBe('650');
    });

    it('generates compliant CD5220 / DSP800 byte sequences', () => {
      const buffer = HardwareService.buildPoleDisplayBuffer(l1, l2, 'CD5220');
      expect(buffer).toBeInstanceOf(Buffer);

      // Verify ESC @ (0x1B, 0x40) init
      expect(buffer[0]).toBe(0x1b);
      expect(buffer[1]).toBe(0x40);

      // Verify Clear (0x0C)
      expect(buffer[2]).toBe(0x0c);

      // Verify ESC Q A (Line 1 overwrite)
      expect(buffer[3]).toBe(0x1b);
      expect(buffer[4]).toBe(0x51);
      expect(buffer[5]).toBe(0x41);

      // Verify Line 1 content + CR (0x0D)
      const line1Bytes = buffer.slice(6, 26).toString('ascii');
      expect(line1Bytes).toBe('XONIT FLAGSHIP STORE');
      expect(buffer[26]).toBe(0x0d);

      // Verify ESC Q B (Line 2 overwrite) + Line 2 content + CR
      expect(buffer[27]).toBe(0x1b);
      expect(buffer[28]).toBe(0x51);
      expect(buffer[29]).toBe(0x42);
      const line2Bytes = buffer.slice(30, 50).toString('ascii');
      expect(line2Bytes).toBe('WELCOME TO OUR SHOP!');
      expect(buffer[50]).toBe(0x0d);
    });

    it('generates compliant ESC/POS (Epson DM-D series) byte sequences', () => {
      const buffer = HardwareService.buildPoleDisplayBuffer(l1, l2, 'ESCPOS');
      expect(buffer).toBeInstanceOf(Buffer);

      // Verify ESC @ (0x1B, 0x40) init & Clear (0x0C)
      expect(buffer[0]).toBe(0x1b);
      expect(buffer[1]).toBe(0x40);
      expect(buffer[2]).toBe(0x0c);

      // Verify US $ 1 1 (Move to Row 1, Col 1)
      expect(buffer[3]).toBe(0x1f);
      expect(buffer[4]).toBe(0x24);
      expect(buffer[5]).toBe(0x01);
      expect(buffer[6]).toBe(0x01);

      const line1Bytes = buffer.slice(7, 27).toString('ascii');
      expect(line1Bytes).toBe('XONIT FLAGSHIP STORE');

      // Verify US $ 1 2 (Move to Row 2, Col 1)
      expect(buffer[27]).toBe(0x1f);
      expect(buffer[28]).toBe(0x24);
      expect(buffer[29]).toBe(0x01);
      expect(buffer[30]).toBe(0x02);

      const line2Bytes = buffer.slice(31, 51).toString('ascii');
      expect(line2Bytes).toBe('WELCOME TO OUR SHOP!');
    });

    it('generates compliant UTC Standard protocol byte sequences', () => {
      const buffer = HardwareService.buildPoleDisplayBuffer(l1, l2, 'UTC');
      expect(buffer).toBeInstanceOf(Buffer);

      // Verify Clear (0x0C) & Cursor Home (0x0B)
      expect(buffer[0]).toBe(0x0c);
      expect(buffer[1]).toBe(0x0b);

      const line1Bytes = buffer.slice(2, 22).toString('ascii');
      expect(line1Bytes).toBe('XONIT FLAGSHIP STORE');

      // Verify Line 2 jump (0x1F, 0x42)
      expect(buffer[22]).toBe(0x1f);
      expect(buffer[23]).toBe(0x42);

      const line2Bytes = buffer.slice(24, 44).toString('ascii');
      expect(line2Bytes).toBe('WELCOME TO OUR SHOP!');
    });

    it('generates compliant AEDEX protocol byte sequences', () => {
      const buffer = HardwareService.buildPoleDisplayBuffer(l1, l2, 'AEDEX');
      expect(buffer).toBeInstanceOf(Buffer);

      // Verify '! # 1' (0x21, 0x23, 0x31)
      expect(buffer[0]).toBe(0x21);
      expect(buffer[1]).toBe(0x23);
      expect(buffer[2]).toBe(0x31);

      const line1Bytes = buffer.slice(3, 23).toString('ascii');
      expect(line1Bytes).toBe('XONIT FLAGSHIP STORE');
      expect(buffer[23]).toBe(0x0d);

      // Verify '! # 2' (0x21, 0x23, 0x32)
      expect(buffer[24]).toBe(0x21);
      expect(buffer[25]).toBe(0x23);
      expect(buffer[26]).toBe(0x32);

      const line2Bytes = buffer.slice(27, 47).toString('ascii');
      expect(line2Bytes).toBe('WELCOME TO OUR SHOP!');
      expect(buffer[47]).toBe(0x0d);
    });
  });
});

