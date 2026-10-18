jest.mock('../config/prisma', () => ({
  __esModule: true,
  default: {
    order: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    orderItem: {
      create: jest.fn(),
    },
    posSession: {
      update: jest.fn(),
    },
    diningTable: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    productVariant: {
      findUnique: jest.fn(),
    },
    inventoryItem: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    branch: {
      findUnique: jest.fn(),
    },
    customer: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}));

import prisma from '../config/prisma';
import { SplitBillService } from '../services/split-bill.service';
import { TableService } from '../services/table.service';
import { ReceiptService } from '../services/receipt.service';

const mockPrisma = prisma as any;

describe('Universal Modular POS Engine (Task 3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('SplitBillService', () => {
    it('splits an order evenly into N ways allocating any cent remainder cleanly', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'ord-100',
        orderNumber: 'POS-100',
        subtotal: 90,
        tax: 10,
        total: 100,
        items: [],
      });
      mockPrisma.order.update.mockResolvedValue({});

      const result = await SplitBillService.splitEvenly('ord-100', 3);

      expect(result.ways).toBe(3);
      expect(result.splits).toHaveLength(3);
      // Total sum of splits must match 100
      const totalSum = result.splits.reduce((acc, s) => acc + s.amount, 0);
      expect(Math.round(totalSum * 100) / 100).toBe(100);
      expect(result.splits![0]!.amount).toBe(33.34);
      expect(result.splits![1]!.amount).toBe(33.33);
      expect(result.splits![2]!.amount).toBe(33.33);
    });

    it('splits an order by segregating specific items into itemized bills', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        id: 'ord-200',
        orderNumber: 'POS-200',
        subtotal: 60,
        tax: 6,
        total: 66,
        items: [
          { id: 'item-1', variantId: 'v-burger', priceAtPurchase: 20, quantity: 1 },
          { id: 'item-2', variantId: 'v-pasta', priceAtPurchase: 25, quantity: 1 },
          { id: 'item-3', variantId: 'v-wine', priceAtPurchase: 15, quantity: 1 },
        ],
      });
      mockPrisma.order.update.mockResolvedValue({});

      const result = await SplitBillService.splitByItems('ord-200', [
        { name: 'Seat 1 - Food', itemIds: ['item-1', 'item-2'] },
        { name: 'Seat 2 - Beverage', itemIds: ['item-3'] },
      ]);

      expect(result.bills).toHaveLength(2);
      expect(result.bills![0]!.name).toBe('Seat 1 - Food');
      expect(result.bills![0]!.subtotal).toBe(45);
      expect(result.bills![1]!.name).toBe('Seat 2 - Beverage');
      expect(result.bills![1]!.subtotal).toBe(15);
      expect(result.bills![0]!.total + result.bills![1]!.total).toBe(66);
    });
  });

  describe('TableService', () => {
    it('creates a dining table or service station', async () => {
      mockPrisma.diningTable.create.mockResolvedValue({
        id: 'tbl-1',
        name: 'Table 14',
        zone: 'PATIO',
        capacity: 4,
        status: 'AVAILABLE',
        branchId: 'branch-main',
      });

      const table = await TableService.createTable({
        name: 'Table 14',
        zone: 'PATIO',
        capacity: 4,
        branchId: 'branch-main',
      });

      expect(table.name).toBe('Table 14');
      expect(table.status).toBe('AVAILABLE');
      expect(mockPrisma.diningTable.create).toHaveBeenCalled();
    });

    it('updates table status', async () => {
      mockPrisma.diningTable.update.mockResolvedValue({
        id: 'tbl-1',
        status: 'OCCUPIED',
      });

      const updated = await TableService.updateTableStatus('tbl-1', 'OCCUPIED');
      expect(updated.status).toBe('OCCUPIED');
      expect(mockPrisma.diningTable.update).toHaveBeenCalledWith({
        where: { id: 'tbl-1' },
        data: { status: 'OCCUPIED' },
      });
    });
  });

  describe('ReceiptService', () => {
    it('formats a Retail receipt with split payment tenders', () => {
      const receipt = ReceiptService.formatReceipt({
        type: 'RETAIL',
        tenantName: 'Urban Outfitters',
        currencySymbol: '$',
        order: {
          orderNumber: 'POS-9001',
          createdAt: new Date('2026-10-18T10:00:00Z'),
          branchName: 'Downtown Flagship',
          customerName: 'Alice Smith',
          subtotal: 100,
          discount: 10,
          tax: 5,
          total: 95,
          splitPayments: [
            { method: 'CASH', amount: 45 },
            { method: 'VISA', amount: 50, reference: 'TX-4421' },
          ],
          items: [
            { name: 'Slim Fit Denim', quantity: 1, price: 60, total: 60 },
            { name: 'Cotton Crew Tee', quantity: 2, price: 20, total: 40 },
          ],
        },
      });

      expect(receipt.receiptType).toBe('RETAIL');
      expect(receipt.rawText).toContain('URBAN OUTFITTERS');
      expect(receipt.rawText).toContain('Slim Fit Denim');
      expect(receipt.rawText).toContain('CASH: $ 45.00');
      expect(receipt.rawText).toContain('VISA: $ 50.00');
    });

    it('formats a Restaurant Kitchen Order Ticket (KOT) with modifiers and item notes', () => {
      const kot = ReceiptService.formatReceipt({
        type: 'RESTAURANT_KOT',
        tenantName: 'Bistro Bella',
        order: {
          orderNumber: 'KOT-402',
          createdAt: new Date('2026-10-18T12:30:00Z'),
          tableName: 'Table 7',
          cashierName: 'Chef Pierre',
          subtotal: 35,
          total: 35,
          items: [
            {
              name: 'Wagyu Burger',
              quantity: 2,
              price: 15,
              total: 30,
              notes: 'Medium Rare, No Onions',
              modifiers: [{ name: 'Truffle Mayo', price: 2.5 }],
            },
          ],
        },
      });

      expect(kot.receiptType).toBe('RESTAURANT_KOT');
      expect(kot.rawText).toContain('*** KITCHEN ORDER TICKET ***');
      expect(kot.rawText).toContain('Table / Station: Table 7');
      expect(kot.rawText).toContain('Wagyu Burger');
      expect(kot.rawText).toContain('+ Truffle Mayo');
      expect(kot.rawText).toContain('* NOTE: Medium Rare, No Onions');
    });

    it('formats a Salon & Wellness slip with therapist attribution', () => {
      const salonSlip = ReceiptService.formatReceipt({
        type: 'SALON_SPA',
        tenantName: 'Lotus Ayurvedic Wellness',
        currencySymbol: 'Rs.',
        order: {
          orderNumber: 'SPA-801',
          createdAt: new Date('2026-10-18T15:00:00Z'),
          customerName: 'Dilshan Silva',
          customerPhone: '0771234567',
          subtotal: 7500,
          total: 7500,
          paymentMethod: 'CARD',
          items: [
            {
              name: 'Aromatherapy Full Body Massage',
              quantity: 1,
              price: 7500,
              total: 7500,
              staffName: 'Therapist Maya',
            },
          ],
        },
      });

      expect(salonSlip.receiptType).toBe('SALON_SPA');
      expect(salonSlip.rawText).toContain('APPOINTMENT & SERVICE SLIP');
      expect(salonSlip.rawText).toContain('Client: Dilshan Silva');
      expect(salonSlip.rawText).toContain('Aromatherapy Full Body Massage [Therapist: Therapist Maya]');
      expect(salonSlip.rawText).toContain('Total: Rs. 7500.00');
    });
  });
});
