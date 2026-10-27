import prisma from '../config/prisma';

export const posService = {
  async openSession(data: { branchId: string; terminalId: string; userId: string; openingFloat: number }) {
    // 1. Ensure the user record exists (lookup only, users are managed by auth)
    const user = await prisma.user.findUnique({
      where: { id: data.userId },
      include: { tenant: true }
    });
    if (!user) throw new Error(`User not found: ${data.userId}`);

    // 2. Resolve branch: direct match, user assigned branch, or tenant branch fallback
    let branch = data.branchId ? await prisma.branch.findUnique({ where: { id: data.branchId } }) : null;
    if (!branch && user.branchId) {
      branch = await prisma.branch.findUnique({ where: { id: user.branchId } });
    }
    if (!branch && user.tenantId) {
      branch = await prisma.branch.findFirst({ where: { tenantId: user.tenantId } });
    }
    if (!branch) {
      if (user.tenantId) {
        const tenantSlug = user.tenant?.slug || 'tenant';
        const code = `${tenantSlug.substring(0, 4).toUpperCase()}-01`;
        branch = await prisma.branch.create({
          data: {
            name: `${user.tenant?.name || 'Default'} - Main Branch`,
            code,
            address: 'Colombo, Sri Lanka',
            phone: '+94 11 234 5678',
            tenantId: user.tenantId
          }
        });
      } else {
        branch = await prisma.branch.findFirst();
      }
    }
    if (!branch) throw new Error(`Branch not found: ${data.branchId}`);

    // 3. Upsert the terminal — create if new, otherwise just update its branch link
    const terminal = await prisma.posTerminal.upsert({
      where: { id: data.terminalId },
      update: { branchId: branch.id },
      create: {
        id: data.terminalId,
        name: `POS Terminal ${data.terminalId.substring(0, 8)}`,
        branchId: branch.id,
        ...(user.tenantId ? { tenantId: user.tenantId } : {})
      }
    });

    // 4. Check if session already open
    const existing = await prisma.posSession.findFirst({
      where: { terminalId: terminal.id, status: 'OPEN' },
      include: { branch: true, terminal: true, user: true }
    });
    if (existing) {
      if (existing.userId === user.id) {
        return existing;
      }
      throw new Error('Terminal already has an open session.');
    }

    // 5. Create the session
    return await prisma.posSession.create({
      data: {
        branchId: branch.id,
        terminalId: terminal.id,
        userId: user.id,
        openingFloat: data.openingFloat,
        status: 'OPEN'
      },
      include: { branch: true, terminal: true, user: true }
    });
  },

  async getExpectedClosing(sessionId: string) {
    const session = await prisma.posSession.findUnique({
      where: { id: sessionId }
    });

    if (!session || session.status === 'CLOSED') {
      throw new Error('Session not found or already closed.');
    }

    const cashOrders = await prisma.order.aggregate({
      where: { 
        posSessionId: sessionId, 
        paymentMethod: 'CASH', 
        paymentStatus: { in: ['PAID', 'REFUNDED'] }
      },
      _sum: { total: true }
    });

    const expectedClosing = session.openingFloat + (cashOrders._sum.total || 0);
    return { expectedClosing };
  },

  async closeSession(data: { sessionId: string; actualClosing: number; closingNotes?: string }) {
    const session = await prisma.posSession.findUnique({
      where: { id: data.sessionId }
    });
    if (!session || session.status === 'CLOSED') {
      throw new Error('Session not found or already closed.');
    }

    const [cashAgg, cardAgg, creditAgg] = await Promise.all([
      prisma.order.aggregate({
        where: { posSessionId: data.sessionId, paymentMethod: 'CASH' },
        _sum: { total: true }
      }),
      prisma.order.aggregate({
        where: { posSessionId: data.sessionId, paymentMethod: { in: ['CARD', 'VISA', 'MASTERCARD'] } },
        _sum: { total: true }
      }),
      prisma.order.aggregate({
        where: { posSessionId: data.sessionId, paymentMethod: { in: ['CREDIT_ACCOUNT', 'GARAGE_CREDIT'] } },
        _sum: { total: true }
      })
    ]);

    const totalCashSales = cashAgg._sum.total || 0;
    const totalCardSales = cardAgg._sum.total || 0;
    const totalCreditSales = creditAgg._sum.total || 0;

    const expectedClosing = session.openingFloat + totalCashSales;
    const variance = data.actualClosing - expectedClosing;
    
    return await prisma.posSession.update({
      where: { id: data.sessionId },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        expectedClosing,
        actualClosing: data.actualClosing,
        variance,
        totalCashSales,
        totalCardSales,
        totalCreditSales,
        closingNotes: data.closingNotes || null
      },
      include: {
        branch: true,
        terminal: true,
        user: true
      }
    });
  },

  async getSessionSummary(sessionId: string) {
    const session = await prisma.posSession.findUnique({
      where: { id: sessionId },
      include: { terminal: true, branch: true }
    });
    if (!session) throw new Error("Session not found");

    const orders = await prisma.order.findMany({
      where: { posSessionId: sessionId }
    });

    const summary = {
      openingFloat: session.openingFloat,
      totalSales: 0,
      totalReturns: 0, // In this system, maybe total returns are logged via vouchers or negative orders. Assuming we'll expand this later.
      paymentMethods: {} as Record<string, number>,
      netTotal: 0
    };

    orders.forEach(order => {
      summary.totalSales += order.total;
      summary.netTotal += order.total;
      const method = order.paymentMethod || 'UNKNOWN';
      summary.paymentMethods[method] = (summary.paymentMethods[method] || 0) + order.total;
    });

    return {
      session,
      summary
    };
  },

  async getCurrentSession(terminalId?: string, branchId?: string, userId?: string) {
    const whereClause: any = { status: 'OPEN' };
    if (terminalId) whereClause.terminalId = terminalId;
    if (branchId) whereClause.branchId = branchId;
    if (userId) whereClause.userId = userId;

    let session = await prisma.posSession.findFirst({
      where: whereClause,
      include: {
        branch: true,
        terminal: true,
        user: true
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!session && userId) {
      session = await prisma.posSession.findFirst({
        where: { userId, status: 'OPEN' },
        include: {
          branch: true,
          terminal: true,
          user: true
        },
        orderBy: { createdAt: 'desc' }
      });
    }

    return session;
  },

  async generateVoucher(data: { branchId: string; returnedItems: any[]; value: number; orderId?: string }) {
    if (!data.orderId) {
      throw new Error("Order ID is required to generate a return voucher securely.");
    }
    
    // We defer to the order.service to securely calculate returned quantities and restock
    const { orderService } = require('./order.service');
    const itemsToReturn = data.returnedItems.map(item => ({ variantId: item.variantId || item.id, qty: item.qty }));
    await orderService.refundPartialOrder(data.orderId, itemsToReturn, "STORE_CREDIT");

    // After successfully marking items returned and restocking, generate the voucher
    const code = `VCH-${data.value}-${Math.floor(Math.random() * 10000)}`;
    return await prisma.exchangeVoucher.create({
      data: {
        code,
        value: data.value,
        status: 'ACTIVE'
      }
    });
  },

  async validateVoucher(code: string) {
    const voucher = await prisma.exchangeVoucher.findUnique({
      where: { code }
    });
    
    if (!voucher) throw new Error('Voucher not found');
    if (voucher.status !== 'ACTIVE') throw new Error('Voucher is already used or invalid');
    
    return voucher;
  },

  async processPosOrder(data: {
    branchId: string;
    sessionId: string;
    customerId?: string;
    items: any[];
    paymentMethod: string;
    appliedVouchers: string[];
    subtotal?: number;
    total?: number;
    tax?: number;
  }) {
    return await prisma.$transaction(async (tx) => {
      const orderNumber = `POS-${Date.now()}`;
      
      // 1. Validate vouchers and calculate deductions
      let voucherDeduction = 0;
      const validVouchers = [];
      if (data.appliedVouchers && data.appliedVouchers.length > 0) {
        for (const vCode of data.appliedVouchers) {
          const voucher = await tx.exchangeVoucher.findUnique({ where: { code: vCode } });
          if (voucher && voucher.status === 'ACTIVE') {
            voucherDeduction += voucher.value;
            validVouchers.push(voucher.id);
          }
        }
      }
      
      // 1.5 Server-side recalculation
      let calculatedSubtotal = 0;
      const orderItems = [];

      for (const item of data.items) {
        const vId = item.variantId || item.id;
        const variant = await tx.productVariant.findUnique({
          where: { id: vId }
        });
        if (!variant) throw new Error(`Variant ${vId} not found`);

        const price = variant.salePrice ?? variant.price;
        calculatedSubtotal += price * item.qty;

        orderItems.push({
          variantId: vId,
          quantity: item.qty,
          priceAtPurchase: price,
          costPriceAtPurchase: variant.costPrice ?? 0
        });
      }

      const calculatedTax = 0;
      const calculatedTotal = Math.max(0, (calculatedSubtotal + calculatedTax) - voucherDeduction);

      const branch = await tx.branch.findFirst({
        where: { OR: [{ id: data.branchId }, { code: data.branchId }] }
      });
      if (!branch) throw new Error(`Branch ${data.branchId} not found`);

      const isKoko = data.paymentMethod.toLowerCase() === 'koko';

      // 2. Create Order
      const order = await tx.order.create({
        data: {
          orderNumber,
          type: 'POS',
          status: isKoko ? 'PENDING' : 'DELIVERED', // POS orders are delivered instantly unless async payment
          paymentStatus: isKoko ? 'PENDING' : 'PAID',
          paymentMethod: data.paymentMethod,
          subtotal: calculatedSubtotal,
          tax: calculatedTax,
          shippingFee: 0,
          total: calculatedTotal,
          branchId: branch.id,
          posSessionId: data.sessionId,
          customerId: data.customerId || null,
          items: {
            create: orderItems
          }
        }
      });
      
      // 3. Update Vouchers
      if (validVouchers.length > 0) {
        await tx.exchangeVoucher.updateMany({
          where: { id: { in: validVouchers } },
          data: { status: 'USED', usedAt: new Date(), orderId: order.id }
        });
      }
      
      // 4. Deduct Inventory
      for (const item of data.items) {
        const vId = item.variantId || item.id;
        
        const inventoryItem = await tx.inventoryItem.findUnique({
          where: { variantId_branchId: { variantId: vId, branchId: branch.id } }
        });
        
        if (!inventoryItem || inventoryItem.quantity < item.qty) {
          throw new Error(`Insufficient stock for variant ${vId}. Available: ${inventoryItem?.quantity || 0}, Requested: ${item.qty}`);
        }
        
        await tx.inventoryItem.update({
          where: { variantId_branchId: { variantId: vId, branchId: branch.id } },
          data: { quantity: { decrement: item.qty } }
        });
        
        await tx.inventoryTransaction.create({
          data: {
            variantId: vId,
            branchId: branch.id,
            type: 'SALE',
            quantityChange: -item.qty,
            reference: order.id,
            reason: 'POS Sale'
          }
        });
      }

      // 5. Log Payment Transaction
      await tx.paymentTransaction.create({
        data: {
          orderId: order.id,
          customerId: order.customerId,
          gateway: data.paymentMethod,
          method: data.paymentMethod,
          amount: calculatedTotal,
          status: isKoko ? 'Pending' : 'Paid'
        }
      });
      
      return order;
    }, {
      timeout: 20000,
      maxWait: 20000,
    });
  }
};
