import { WarrantyService } from '../services/warranty.service';
import prisma from '../config/prisma';

describe('Warranty & Serial Tracking Core Service', () => {
  let testTenantId: string;
  let testBranchId: string;
  let testVariantId: string;
  let testCustomerId: string;
  let testOrderId: string;
  const testSerialNum = `SN-TEST-${Date.now()}`;
  const testImei = `IMEI-${Date.now()}`;

  beforeAll(async () => {
    // 1. Find or create test tenant
    let tenant = await prisma.tenant.findFirst({
      where: { slug: { contains: 'test' } },
    });
    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: {
          name: 'Warranty Test Tenant',
          slug: `warranty-tenant-${Date.now()}`,
          businessType: 'RETAIL',
          status: 'ACTIVE',
        },
      });
    }
    testTenantId = tenant.id;

    // 2. Find or create branch
    let branch = await prisma.branch.findFirst({
      where: { tenantId: testTenantId },
    });
    if (!branch) {
      branch = await prisma.branch.create({
        data: {
          tenant: { connect: { id: testTenantId } },
          name: 'Main Electronic Hub',
          code: `MEH-${Date.now()}`,
          type: 'RETAIL',
        },
      });
    }
    testBranchId = branch.id;

    // 3. Create a product with 12 months warranty
    const product = await prisma.product.create({
      data: {
        tenant: { connect: { id: testTenantId } },
        name: 'Smart 4K LED TV 55"',
        slug: `smart-tv-55-${Date.now()}`,
        brand: 'Sony',
        warrantyPeriodMonths: 12,
        warrantyPolicy: '1 Year Comprehensive Panel & Motherboard Warranty',
      },
    });

    // 4. Create variant
    const variant = await prisma.productVariant.create({
      data: {
        product: { connect: { id: product.id } },
        name: '55" Ultra HD HDR',
        sku: `TV-55-UHD-${Date.now()}`,
        price: 185000,
        hasSerialTracking: true,
      },
    });
    testVariantId = variant.id;

    // 5. Create or find customer
    const testCustomerPhone = `9471${Date.now().toString().slice(-7)}`;
    let customer = await prisma.customer.findFirst({
      where: { tenantId: testTenantId, phone: testCustomerPhone },
    });
    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          tenant: { connect: { id: testTenantId } },
          firstName: 'Kamal',
          lastName: 'Perera',
          phone: testCustomerPhone,
          email: `kamal.${Date.now()}@example.com`,
        },
      });
    }
    testCustomerId = customer.id;

    // 6. Create order
    const order = await prisma.order.create({
      data: {
        tenant: { connect: { id: testTenantId } },
        orderNumber: `ORD-WARR-${Date.now()}`,
        customer: { connect: { id: customer.id } },
        subtotal: 185000,
        shippingFee: 0,
        total: 185000,
        status: 'DELIVERED',
        paymentStatus: 'PAID',
        items: {
          create: [
            {
              variantId: variant.id,
              quantity: 1,
              priceAtPurchase: 185000,
            },
          ],
        },
      },
      include: { items: true },
    });
    testOrderId = order.id;
  });

  it('should register a new serialized unit in stock', async () => {
    const serial = await WarrantyService.registerSerial(testTenantId, {
      variantId: testVariantId,
      branchId: testBranchId,
      serialNumber: testSerialNum,
      imei: testImei,
      notes: 'Initial warehouse receipt batch A',
    });

    expect(serial).toBeDefined();
    expect(serial.serialNumber).toBe(testSerialNum);
    expect(serial.status).toBe('IN_STOCK');
    expect(serial.variant.product.warrantyPeriodMonths).toBe(12);
  });

  it('should reject duplicate serial numbers within the same tenant', async () => {
    await expect(
      WarrantyService.registerSerial(testTenantId, {
        variantId: testVariantId,
        serialNumber: testSerialNum,
      })
    ).rejects.toThrow(/already registered/);
  });

  it('should bulk register serial numbers in a single transaction', async () => {
    const serialList = [`SN-BULK-1-${Date.now()}`, `SN-BULK-2-${Date.now()}`, `SN-BULK-3-${Date.now()}`];
    const result = await WarrantyService.bulkRegisterSerials(testTenantId, testVariantId, serialList, testBranchId);

    expect(result.registeredCount).toBe(3);
    expect(result.skippedCount).toBe(0);
  });

  it('should check warranty status and calculate validity and days remaining', async () => {
    // Simulate sale by updating purchaseDate and warrantyExpiresAt (12 months from now)
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setMonth(expiresAt.getMonth() + 12);

    await prisma.productSerial.update({
      where: {
        tenantId_serialNumber: {
          tenantId: testTenantId,
          serialNumber: testSerialNum,
        },
      },
      data: {
        status: 'SOLD',
        purchaseDate: now,
        warrantyExpiresAt: expiresAt,
      },
    });

    const statusCheck = await WarrantyService.checkWarrantyStatus(testTenantId, {
      serialNumber: testSerialNum,
    });

    expect(statusCheck.found).toBe(true);
    expect(statusCheck.isValidWarranty).toBe(true);
    expect(statusCheck.status).toBe('ACTIVE');
    expect(statusCheck.daysRemaining).toBeGreaterThan(350);
    expect(statusCheck.warrantyPeriodMonths).toBe(12);
    expect(statusCheck.product?.name).toContain('Smart 4K LED TV');
  });

  it('should open a warranty claim ticket and set serial status to UNDER_WARRANTY', async () => {
    const claim = await WarrantyService.createClaim(testTenantId, {
      branchId: testBranchId,
      customerId: testCustomerId,
      orderId: testOrderId,
      variantId: testVariantId,
      customerName: 'Kamal Perera',
      customerPhone: '94712345678',
      customerEmail: 'kamal.perera@example.com',
      serialNumber: testSerialNum,
      productName: 'Smart 4K LED TV 55"',
      issueDescription: 'Vertical color lines appearing across the center of screen after 20 minutes of usage',
      accessoryNotes: 'Remote control and power cable received',
      technicianName: 'Saman Jayasinghe',
    });

    expect(claim).toBeDefined();
    expect(claim.claimNumber).toMatch(/^CLM-\d+$/);
    expect(claim.status).toBe('RECEIVED');
    expect(claim.customerName).toBe('Kamal Perera');

    // Verify serial status transitioned
    const updatedSerial = await prisma.productSerial.findFirst({
      where: { tenantId: testTenantId, serialNumber: testSerialNum },
    });
    expect(updatedSerial?.status).toBe('UNDER_WARRANTY');
  });

  it('should transition claim through diagnosis, repair, and record timeline audit logs', async () => {
    // 1. Find the claim
    const claims = await WarrantyService.getClaims(testTenantId, { search: testSerialNum });
    expect(claims.claims.length).toBeGreaterThan(0);
    const claimId = claims.claims[0]!.id;

    // 2. Move to IN_DIAGNOSIS
    const inDiagnosis = await WarrantyService.updateClaimStatus(testTenantId, claimId, {
      status: 'IN_DIAGNOSIS',
      diagnosticNotes: 'Defective T-Con board ribbon cable identified. Component replacement required.',
      technicianNotes: 'Ordered replacement T-Con ribbon cable from Sony official parts center.',
      technicianName: 'Saman Jayasinghe',
      note: 'Technical inspection started',
    });

    expect(inDiagnosis.status).toBe('IN_DIAGNOSIS');
    expect(inDiagnosis.diagnosticNotes).toContain('T-Con board');

    // 3. Move to REPAIRED
    const repaired = await WarrantyService.updateClaimStatus(testTenantId, claimId, {
      status: 'REPAIRED',
      resolutionType: 'REPAIRED',
      repairCost: 4500, // Internal cost
      customerCharge: 0, // Free under warranty
      technicianNotes: 'Ribbon cable replaced and display calibrated. 2-hour burn-in test passed successfully.',
      note: 'Repair completed and QA passed',
    });

    expect(repaired.status).toBe('REPAIRED');
    expect(repaired.completedAt).toBeDefined();

    // 4. Check full claim history and timeline logs
    const fullClaim = await WarrantyService.getClaimById(testTenantId, claimId);
    expect(fullClaim.logs.length).toBeGreaterThanOrEqual(3);
    expect(fullClaim.logs.some((l) => l.toStatus === 'IN_DIAGNOSIS')).toBe(true);
    expect(fullClaim.logs.some((l) => l.toStatus === 'REPAIRED')).toBe(true);
  });

  it('should calculate warranty KPIs correctly', async () => {
    const kpis = await WarrantyService.getWarrantyKPIs(testTenantId);

    expect(kpis).toBeDefined();
    expect(typeof kpis.totalSerials).toBe('number');
    expect(kpis.totalSerials).toBeGreaterThanOrEqual(4);
    expect(typeof kpis.resolvedThisMonth).toBe('number');
    expect(kpis.resolvedThisMonth).toBeGreaterThanOrEqual(1);
  });
});
