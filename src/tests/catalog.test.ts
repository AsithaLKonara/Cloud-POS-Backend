jest.mock('../config/prisma', () => ({
  __esModule: true,
  default: {
    tenant: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    category: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    product: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    productVariant: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    inventoryItem: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
      aggregate: jest.fn(),
    },
    inventoryTransaction: {
      create: jest.fn(),
    },
  },
}));

import prisma from '../config/prisma';
import { PresetService } from '../services/preset.service';
import { TenantService } from '../services/tenant.service';
import { inventoryService } from '../services/inventory.service';
import { requestContext } from '../context/RequestContext';

const mockPrisma = prisma as any;

describe('Universal Dynamic Catalog & Presets (Task 2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('PresetService', () => {
    it('returns predefined categories for RETAIL business type', () => {
      const presets = PresetService.getPresetCategories('RETAIL');
      expect(presets.length).toBeGreaterThan(0);
      const names = presets.map((p: any) => p.name);
      expect(names).toContain("Men's Apparel");
      expect(names).toContain("Footwear");
    });

    it('returns predefined categories for RESTAURANT_CAFE business type', () => {
      const presets = PresetService.getPresetCategories('RESTAURANT_CAFE');
      expect(presets.length).toBeGreaterThan(0);
      const names = presets.map((p: any) => p.name);
      expect(names).toContain('Appetizers & Starters');
      expect(names).toContain('Main Courses');
      expect(names).toContain('Cold Beverages & Mocktails');
    });

    it('returns predefined categories for SALON_SPA business type', () => {
      const presets = PresetService.getPresetCategories('SALON_SPA');
      expect(presets.length).toBeGreaterThan(0);
      const names = presets.map((p: any) => p.name);
      expect(names).toContain('Hair Services & Styling');
      expect(names).toContain('Massage & Body Therapy');
    });

    it('returns predefined categories for PHARMACY_CLINIC business type', () => {
      const presets = PresetService.getPresetCategories('PHARMACY_CLINIC');
      expect(presets.length).toBeGreaterThan(0);
      const names = presets.map((p: any) => p.name);
      expect(names).toContain('Prescription Medicines');
      expect(names).toContain('Over-The-Counter (OTC)');
    });

    it('returns standard attribute schemas according to business type', () => {
      const retailAttrs = PresetService.getAttributeSchemaForBusinessType('RETAIL');
      expect(retailAttrs.map((a: any) => a.key)).toEqual(expect.arrayContaining(['color', 'size', 'material']));

      const pharmaAttrs = PresetService.getAttributeSchemaForBusinessType('PHARMACY_CLINIC');
      expect(pharmaAttrs.map((a: any) => a.key)).toEqual(expect.arrayContaining(['dosage', 'expiryDate', 'batchNumber', 'prescriptionRequired']));

      const salonAttrs = PresetService.getAttributeSchemaForBusinessType('SALON_SPA');
      expect(salonAttrs.map((a: any) => a.key)).toEqual(expect.arrayContaining(['durationMinutes', 'practitionerGender']));
    });

    it('seeds preset categories automatically on tenant creation', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValue(null);
      mockPrisma.tenant.create.mockResolvedValue({
        id: 'tenant-cafe-1',
        name: 'The Artisan Cafe',
        slug: 'artisan-cafe',
        businessType: 'RESTAURANT_CAFE',
        currency: 'USD',
        currencySymbol: '$',
      });
      mockPrisma.category.findFirst.mockResolvedValue(null);
      mockPrisma.category.create.mockImplementation(async ({ data }: any) => ({
        id: `cat-${Math.random()}`,
        ...data,
      }));

      const tenant = await TenantService.createTenant({
        name: 'The Artisan Cafe',
        slug: 'artisan-cafe',
        businessType: 'RESTAURANT_CAFE',
      });

      expect(tenant).toBeDefined();
      expect(mockPrisma.category.create).toHaveBeenCalled();
      const calls = mockPrisma.category.create.mock.calls;
      const createdNames = calls.map((c: any) => c[0].data.name);
      expect(createdNames).toContain('Main Courses');
      expect(createdNames).toContain('Cold Beverages & Mocktails');
    });
  });

  describe('Universal Inventory & Service Tracking', () => {
    it('bypasses stock deduction when product has trackInventory: false (e.g. Services)', async () => {
      mockPrisma.productVariant.findUnique.mockResolvedValue({
        id: 'variant-service-1',
        sku: 'SRV-MASSAGE-60',
        product: {
          id: 'prod-service-1',
          name: 'Swedish Massage 60min',
          productType: 'SERVICE',
          trackInventory: false,
        },
      });

      const result = await inventoryService.adjustStock({
        variantId: 'variant-service-1',
        branchId: 'branch-1',
        type: 'DEDUCT',
        quantity: 1,
        reason: 'POS Sale',
      });

      expect(result).toEqual({
        inventoryItem: null,
        transaction: null,
        skipped: true,
      });

      // Verify no database updates were performed on inventory items
      expect(mockPrisma.inventoryItem.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.inventoryTransaction.create).not.toHaveBeenCalled();
    });

    it('enforces stock deduction for physical goods with trackInventory: true', async () => {
      mockPrisma.productVariant.findUnique.mockResolvedValueOnce({
        id: 'variant-phys-1',
        sku: 'ITEM-SHAMPOO',
        costPrice: 15,
        product: {
          id: 'prod-phys-1',
          name: 'Organic Shampoo',
          productType: 'PHYSICAL',
          trackInventory: true,
        },
      }).mockResolvedValueOnce({
        id: 'variant-phys-1',
        costPrice: 15,
      });

      mockPrisma.inventoryItem.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.inventoryItem.findUnique.mockResolvedValue({
        id: 'inv-1',
        variantId: 'variant-phys-1',
        branchId: 'branch-1',
        quantity: 9,
        lowStockThreshold: 5,
      });
      mockPrisma.inventoryItem.aggregate.mockResolvedValue({ _sum: { quantity: 9 } });
      mockPrisma.productVariant.update.mockResolvedValue({});
      mockPrisma.inventoryTransaction.create.mockResolvedValue({ id: 'tx-1' });

      const result = await inventoryService.adjustStock({
        variantId: 'variant-phys-1',
        branchId: 'branch-1',
        type: 'DEDUCT',
        quantity: 1,
        reason: 'POS Sale',
      });

      expect(mockPrisma.inventoryItem.updateMany).toHaveBeenCalledWith({
        where: {
          variantId: 'variant-phys-1',
          branchId: 'branch-1',
          quantity: { gte: 1 },
        },
        data: { quantity: { decrement: 1 } },
      });
      expect(mockPrisma.inventoryTransaction.create).toHaveBeenCalled();
    });
  });
});
