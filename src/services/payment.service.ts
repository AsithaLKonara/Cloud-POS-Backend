import prisma from '../config/prisma';

export const paymentService = {
  async initiatePayment(orderId: string, method: string) {
    const order = await prisma.order.findUnique({ 
      where: { id: orderId },
      include: { customer: true }
    });
    if (!order) throw new Error('Order not found');

    const setting = await prisma.setting.findUnique({ where: { key: 'PAYMENT_METHODS' } });
    let methods: any[] = [
      { id: "cod", name: "Cash on delivery", type: "offline", active: true },
      { id: "mintpay", name: "Mintpay", type: "bnpl", active: true, badge: "Pay Later" },
      { id: "koko", name: "Koko: BNPL", type: "bnpl", active: true, badge: "Pay Later" },
      { id: "payzy", name: "Payzy", type: "gateway", active: true },
      { id: "onepay", name: "Bank Card / Bank Account", type: "gateway", active: true }
    ];

    if (setting && setting.value) {
      try { methods = JSON.parse(setting.value); } catch (e) {}
    }

    const requestedMethod = methods.find(m => m.id.toLowerCase() === method.toLowerCase());
    if (!requestedMethod || !requestedMethod.active) {
      throw new Error(`Payment method ${method} is currently unavailable.`);
    }

    if (method.toUpperCase() === 'COD') {
      return {
        success: true,
        method: 'COD',
        redirectUrl: null, // No redirect needed for COD
        message: 'Order placed successfully'
      };
    }

    if (method.toLowerCase() === 'koko') {
      const { kokoProvider } = require('./providers/koko.provider');
      const baseUrl = process.env.API_BASE_URL || 'http://localhost:5000';
      const returnUrl = `${baseUrl}/api/payments/return?orderId=${order.orderNumber}`;
      const cancelUrl = `${baseUrl}/api/payments/cancel?orderId=${order.orderNumber}`;
      const responseUrl = `${baseUrl}/api/payments/webhook/koko`;
      
      const shippingAddr = order.shippingAddress as any;
      const customer = {
         firstName: order.customer?.firstName || shippingAddr?.firstName || 'Customer',
         lastName: order.customer?.lastName || shippingAddr?.lastName || 'Name',
         email: order.customer?.email || 'customer@example.com',
         phone: order.customer?.phone || shippingAddr?.phone || '0700000000'
      };

      const kokoData = await kokoProvider.createPaymentParams(
        order.orderNumber, 
        order.total, 
        'LKR', 
        customer, 
        returnUrl, 
        cancelUrl, 
        responseUrl
      );
      
      return {
         success: true,
         method: 'KOKO',
         isFormRedirect: true,
         formData: kokoData.params,
         redirectUrl: kokoData.url,
         message: 'Redirecting to Koko'
      };
    }

    // Generate a mock redirect URL for our internal mock gateway
    const redirectUrl = `/mock-gateway?method=${method.toLowerCase()}&orderNumber=${order.orderNumber}&amount=${order.total}`;

    return {
      success: true,
      method: method.toUpperCase(),
      redirectUrl,
      message: 'Please complete your payment'
    };
  },

  async handleWebhook(provider: string, payload: any, signature?: string) {
    if (provider.toLowerCase() === 'koko') {
      const { kokoProvider } = require('./providers/koko.provider');
      const verification = kokoProvider.verifyWebhook(payload);
      
      const order = await prisma.order.findFirst({ where: { orderNumber: verification.orderId } });
      if (!order) throw new Error('Order not found from webhook');

      // Check idempotency for Koko
      const eventId = `koko_${verification.trnId}_${verification.status}`;
      const existingKey = await prisma.idempotencyKey.findUnique({ where: { key: eventId } });
      if (existingKey) {
        console.log(`[Webhook] Duplicate Koko event ${eventId} ignored.`);
        return { success: true, duplicate: true };
      }
      
      const dbStatus = verification.status === 'SUCCESS' ? 'Paid' : (verification.status === 'FAILED' || verification.status === 'FAILURE' ? 'Failed' : 'Pending');

      const existingTx = await prisma.paymentTransaction.findFirst({ where: { orderId: order.id } });
      if (existingTx) {
        await prisma.paymentTransaction.update({
          where: { id: existingTx.id },
          data: {
            status: dbStatus,
            gateway: 'koko',
            method: 'koko'
          }
        });
      } else {
        await prisma.paymentTransaction.create({
          data: {
            orderId: order.id,
            customerId: order.customerId,
            gateway: 'koko',
            method: 'koko',
            amount: order.total,
            status: dbStatus
          }
        });
      }

      if (verification.status === 'SUCCESS') {
        await prisma.order.update({
          where: { id: order.id },
          data: { paymentStatus: 'PAID', status: 'PROCESSING' }
        });
      } else if (verification.status === 'FAILED' || verification.status === 'FAILURE') {
        await prisma.order.update({
          where: { id: order.id },
          data: { paymentStatus: 'FAILED', status: 'CANCELLED' }
        });
        // Restore stock
        const branchId = order.branchId || (await prisma.branch.findFirst({ where: { OR: [{ name: 'Online' }, { code: 'ONLINE' }] } }))?.id;
        if (branchId) {
          const { inventoryService } = require('./inventory.service');
          const orderWithItems = await prisma.order.findUnique({ where: { id: order.id }, include: { items: true } });
          if (orderWithItems) {
            for (const item of orderWithItems.items) {
              await inventoryService.adjustStock({
                variantId: item.variantId,
                branchId,
                type: 'RECEIVE',
                quantity: item.quantity,
                reason: 'Payment Failed Restock',
                reference: order.id
              });
            }
          }
        }
      }

      await prisma.idempotencyKey.create({ data: { key: eventId } });
      return { success: true };
    }

    if (!signature) {
      throw new Error('Missing webhook signature');
    }

    const secret = process.env.PAYMENT_WEBHOOK_SECRET || 'laural-clothing-mock-secret';
    const crypto = require('crypto');
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    if (signature !== expectedSignature) {
      throw new Error('Invalid webhook signature');
    }

    const eventId = payload.eventId;
    if (!eventId) throw new Error('Invalid webhook payload: missing eventId');

    // Check idempotency
    const existingKey = await prisma.idempotencyKey.findUnique({ where: { key: eventId } });
    if (existingKey) {
      console.log(`[Webhook] Duplicate event ${eventId} ignored.`);
      return { success: true, duplicate: true };
    }

    const orderNumber = payload.orderNumber;
    if (!orderNumber) throw new Error('Invalid webhook payload: missing orderNumber');

    const order = await prisma.order.findFirst({ where: { orderNumber } });
    if (!order) throw new Error('Order not found from webhook');

    const statusMap: Record<string, string> = {
      SUCCESS: 'Paid',
      FAILED: 'Failed',
      PENDING: 'Pending'
    };
    
    const dbStatus = statusMap[payload.status] || 'Pending';

    // Log or update the transaction
    const existingTx = await prisma.paymentTransaction.findFirst({ where: { orderId: order.id } });
    if (existingTx) {
      await prisma.paymentTransaction.update({
        where: { id: existingTx.id },
        data: {
          status: dbStatus,
          gateway: provider,
          method: provider
        }
      });
    } else {
      await prisma.paymentTransaction.create({
        data: {
          orderId: order.id,
          customerId: order.customerId,
          gateway: provider,
          method: provider,
          amount: order.total,
          status: dbStatus
        }
      });
    }

    if (payload.status === 'SUCCESS') {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: 'PAID',
          status: 'PROCESSING'
        }
      });
      // Additional logic here: notify user, etc.
    } else if (payload.status === 'FAILED') {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: 'FAILED',
          status: 'CANCELLED'
        }
      });
      // Restore stock
      const branchId = order.branchId || (await prisma.branch.findFirst({ where: { OR: [{ name: 'Online' }, { code: 'ONLINE' }] } }))?.id;
      if (branchId) {
        const { inventoryService } = require('./inventory.service');
        const orderWithItems = await prisma.order.findUnique({ where: { id: order.id }, include: { items: true } });
        if (orderWithItems) {
          for (const item of orderWithItems.items) {
            await inventoryService.adjustStock({
              variantId: item.variantId,
              branchId,
              type: 'RECEIVE',
              quantity: item.quantity,
              reason: 'Payment Failed Restock',
              reference: order.id
            });
          }
        }
      }
    }

    // Save idempotency key
    await prisma.idempotencyKey.create({ data: { key: eventId } });

    return { success: true };
  }
};
