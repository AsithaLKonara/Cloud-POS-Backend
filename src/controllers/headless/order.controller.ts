import { Request, Response } from 'express';
import prisma from '../../config/prisma';
import { requestContext } from '../../context/RequestContext';
import { WebhookDispatcherService } from '../../services/webhook-dispatcher.service';

export class HeadlessOrderController {
  async calculateCheckout(req: Request, res: Response): Promise<void> {
    try {
      const store = requestContext.getStore();
      const tenantId = store?.tenantId;
      if (!tenantId) {
        res.status(401).json({ success: false, message: 'Tenant context missing.' });
        return;
      }

      const { items, district } = req.body;
      if (!items || !Array.isArray(items) || items.length === 0) {
        res.status(400).json({ success: false, message: 'Cart items array required.' });
        return;
      }

      const tenant = await (prisma as any).tenant.findUnique({
        where: { id: tenantId },
        select: { taxRate: true, currency: true, currencySymbol: true },
      });

      let subtotal = 0;
      const verifiedItems: any[] = [];

      for (const item of items) {
        let unitPrice = item.unitPrice || 0;
        let lineName = item.name || 'Store Item';

        const product = await (prisma as any).product.findFirst({
          where: {
            tenantId,
            OR: [
              { id: item.productId || '' },
              { variants: { some: { id: item.variantId || item.productId || '' } } }
            ]
          },
          include: { variants: true }
        });

        if (product) {
          lineName = product.name;
          const variant = product.variants?.find((v: any) => v.id === item.variantId) || product.variants?.[0];
          unitPrice = variant?.salePrice || variant?.price || unitPrice;
        }

        const lineTotal = unitPrice * item.quantity;
        subtotal += lineTotal;

        verifiedItems.push({
          productId: product?.id || item.productId || 'custom',
          name: lineName,
          unitPrice,
          quantity: item.quantity,
          lineTotal,
        });
      }

      const taxRate = tenant?.taxRate || 0;
      const taxAmount = (subtotal * taxRate) / 100;
      const shippingFee = district?.toLowerCase() === 'colombo' ? 350 : 500;
      const total = subtotal + taxAmount + shippingFee;

      res.status(200).json({
        success: true,
        data: {
          items: verifiedItems,
          currency: tenant?.currency || 'LKR',
          currencySymbol: tenant?.currencySymbol || 'Rs.',
          subtotal,
          taxRate,
          taxAmount,
          shippingFee,
          total,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  async createOrder(req: Request, res: Response): Promise<void> {
    try {
      const store = requestContext.getStore();
      const tenantId = store?.tenantId;
      if (!tenantId) {
        res.status(401).json({ success: false, message: 'Tenant context missing.' });
        return;
      }

      const {
        items,
        customer,
        shippingAddress,
        paymentMethod = 'CASH_ON_DELIVERY',
        notes,
      } = req.body;

      if (!items || items.length === 0) {
        res.status(400).json({ success: false, message: 'Items are required.' });
        return;
      }

      // 1. Fetch or create Customer
      let customerId: string | null = null;
      if (customer) {
        let existingCustomer = await (prisma as any).customer.findFirst({
          where: {
            tenantId,
            OR: [
              ...(customer.email ? [{ email: customer.email }] : []),
              ...(customer.phone ? [{ phone: customer.phone }] : []),
            ],
          },
        });

        if (!existingCustomer) {
          const customerPhone = customer.phone || `077${Math.floor(1000000 + Math.random() * 9000000)}`;
          existingCustomer = await (prisma as any).customer.create({
            data: {
              tenantId,
              firstName: customer.firstName || 'Online',
              lastName: customer.lastName || 'Shopper',
              email: customer.email || null,
              phone: customerPhone,
              isGuest: true,
            },
          });
        }
        customerId = existingCustomer.id;
      }

      // 2. Fetch default branch and fallback variant
      const defaultBranch = await (prisma as any).branch.findFirst({
        where: { tenantId },
      });

      const fallbackVariant = await (prisma as any).productVariant.findFirst({
        where: { product: { tenantId } },
      });

      // 3. Calculate totals and build order items
      let subtotal = 0;
      const orderItemsData: any[] = [];

      for (const item of items) {
        let price = item.unitPrice || 0;
        let targetVariantId = item.variantId;

        const product = await (prisma as any).product.findFirst({
          where: {
            tenantId,
            OR: [
              { id: item.productId || '' },
              { variants: { some: { id: item.variantId || item.productId || '' } } }
            ]
          },
          include: { variants: true }
        });

        if (product && product.variants?.length > 0) {
          const v = product.variants.find((v: any) => v.id === item.variantId) || product.variants[0];
          targetVariantId = v.id;
          price = v.salePrice || v.price || price;
        } else if (!targetVariantId && fallbackVariant) {
          targetVariantId = fallbackVariant.id;
        }

        subtotal += price * item.quantity;

        if (targetVariantId) {
          orderItemsData.push({
            variantId: targetVariantId,
            quantity: item.quantity,
            priceAtPurchase: price,
            costPriceAtPurchase: 0,
          });
        }
      }

      const orderNumber = `ORD-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`;
      const shippingFee = 450;
      const grandTotal = subtotal + shippingFee;

      // 4. Create Order Transaction
      const order = await (prisma as any).order.create({
        data: {
          tenantId,
          orderNumber,
          branchId: defaultBranch?.id || null,
          customerId,
          total: grandTotal,
          subtotal,
          shippingFee,
          status: 'PENDING',
          paymentStatus: paymentMethod === 'CASH_ON_DELIVERY' ? 'PENDING' : 'INITIATED',
          paymentMethod,
          shippingAddress: shippingAddress ? shippingAddress : null,
          type: 'ECOMMERCE',
          metadata: {
            notes: notes ? `[Headless Web]: ${notes}` : '[Headless Web Order]',
            source: 'HEADLESS_API',
          },
          ...(orderItemsData.length > 0 ? {
            items: {
              create: orderItemsData,
            }
          } : {}),
        },
        include: {
          items: true,
          customer: true,
        },
      });

      // 5. Asynchronously trigger outbound webhook
      WebhookDispatcherService.dispatchWebhook(tenantId, 'order.created', {
        orderId: order.id,
        orderNumber: order.orderNumber,
        total: order.total,
        status: order.status,
        customer: order.customer ? { name: `${order.customer.firstName} ${order.customer.lastName}`, email: order.customer.email } : null,
        itemsCount: order.items.length,
        createdAt: order.createdAt,
      });

      res.status(201).json({
        success: true,
        message: 'Order created successfully in XONIT ERP.',
        data: order,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  async getOrder(req: Request, res: Response): Promise<void> {
    try {
      const store = requestContext.getStore();
      const tenantId = store?.tenantId;
      const { idOrRef } = req.params;

      const order = await (prisma as any).order.findFirst({
        where: {
          tenantId,
          OR: [{ id: idOrRef }, { orderNumber: idOrRef }],
        },
        include: {
          items: true,
          customer: {
            select: { firstName: true, lastName: true, phone: true, email: true },
          },
        },
      });

      if (!order) {
        res.status(404).json({ success: false, message: 'Order not found.' });
        return;
      }

      res.status(200).json({ success: true, data: order });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}
