import prisma from '../config/prisma';
import { AppError } from '../middlewares/errorHandler';
import { redisClient } from '../config/redis';
import { inventoryService } from './inventory.service';
import { paymentService } from './payment.service';
import { fraudService } from './fraud.service';
import { alertService } from './alert.service';
import { NotificationService } from './notification.service';
import { getEffectivePrice } from '../utils/pricing.util';
import { variantBasicSelect } from '../dto/product.dto';

export const checkoutService = {
  /**
   * Calculates the checkout totals for a given cart and shipping address.
   */
  async calculateCheckout(cartId: string, address: any, isGuest: boolean = true) {
    let cart;

    if (isGuest) {
      const redisKey = `cart:${cartId}`; // cartId is sessionId for guests
      const cartStr = await redisClient.get(redisKey);
      if (!cartStr) throw new AppError('Guest cart not found', 400);
      cart = JSON.parse(cartStr);
    } else {
      cart = await prisma.cart.findUnique({
        where: { id: cartId },
        include: {
          items: {
            include: { 
              variant: {
                select: variantBasicSelect
              }
            },
          },
        },
      });
      if (!cart) throw new AppError('Cart not found', 400);
    }

    if (!cart || cart.items.length === 0) {
      throw new AppError('Cart is empty or not found', 400);
    }

    let subtotal = 0;
    cart.items.forEach((item: any) => {
      subtotal += item.quantity * getEffectivePrice(item.variant);
    });

    // Flat shipping rate for now
    const shippingFee = 400;
    const tax = 0;
    const total = subtotal + shippingFee + tax;

    return {
      subtotal,
      shippingFee,
      tax,
      total,
      loyaltyDiscount: 0,
      itemCount: cart.items.length,
    };
  },

  /**
   * Initiates checkout, resolves identity, and creates an order.
   */
  async initiateCheckout(cartId: string, customerData: { phone: string; email?: string; firstName?: string; lastName?: string; isGuest?: boolean; deviceFingerprint?: string }, shippingAddress: any, paymentMethod?: string, pointsToRedeem?: number) {
    const isGuest = customerData.isGuest !== false;
    let cart;

    if (isGuest) {
      const redisKey = `cart:${cartId}`;
      const cartStr = await redisClient.get(redisKey);
      if (!cartStr) throw new AppError('Guest cart not found', 400);
      cart = JSON.parse(cartStr);

      // Re-hydrate allowedPaymentMethods from DB - Redis cache may be stale if product was updated
      for (const item of cart.items) {
        if (item.variantId) {
          const freshVariant = await prisma.productVariant.findUnique({
            where: { id: item.variantId },
            select: { product: { select: { allowedPaymentMethods: true } } }
          });
          if (freshVariant?.product) {
            if (!item.variant) item.variant = {};
            if (!item.variant.product) item.variant.product = {};
            item.variant.product.allowedPaymentMethods = freshVariant.product.allowedPaymentMethods;
          }
        }
      }
    } else {
      cart = await prisma.cart.findUnique({
        where: { id: cartId },
        include: {
          items: { 
            include: { 
              variant: { 
                include: {
                  product: {
                    select: { allowedPaymentMethods: true }
                  }
                } 
              } 
            } 
          },
        },
      });
      if (!cart) throw new AppError('Cart not found', 400);
    }

    if (!cart || cart.items.length === 0) {
      throw new AppError('Cart is empty or not found', 400);
    }

    if (paymentMethod) {
      for (const item of cart.items) {
        const allowedMethods = item.variant?.product?.allowedPaymentMethods;
        if (allowedMethods && allowedMethods.length > 0) {
          // DB stores methods as PascalCase ("COD","Koko"), paymentMethod from client may be lowercase
          const normalised = allowedMethods.map((m: string) => m.toLowerCase());
          if (!normalised.includes(paymentMethod.toLowerCase())) {
            throw new AppError(`Payment method '${paymentMethod}' is not allowed for some items in your cart.`, 400);
          }
        }
      }
    }


    // 1. Identity Resolution
    let customer = await prisma.customer.findFirst({
      where: { phone: customerData.phone },
    });

    if (!customer && customerData.email) {
      customer = await prisma.customer.findFirst({
        where: { email: customerData.email },
      });
    }

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          phone: customerData.phone,
          email: customerData.email,
          firstName: customerData.firstName,
          lastName: customerData.lastName,
          isGuest: isGuest,
        },
      });
    } else if (customerData.email && !customer.email) {
      try {
        customer = await prisma.customer.update({
          where: { id: customer.id },
          data: { email: customerData.email },
        });
      } catch (e) {
        // Ignore if email is taken by another account to prevent checkout failure
      }
    }

    // 2. Calculation
    let totals = await this.calculateCheckout(cartId, shippingAddress, isGuest);
    
    // Loyalty Points Logic
    let loyaltyAccountToUpdate = null;
    let loyaltyDiscount = 0;

    if (pointsToRedeem && pointsToRedeem > 0 && !isGuest && customer) {
      const loyaltyAccount = await prisma.loyaltyAccount.findUnique({ where: { customerId: customer.id } });
      if (!loyaltyAccount || loyaltyAccount.points < pointsToRedeem) {
        throw new AppError('Insufficient loyalty points', 400);
      }

      // Convert points to LKR (assume 1 point = 1 LKR for now, could be dynamic)
      loyaltyDiscount = pointsToRedeem * 1;
      
      if (loyaltyDiscount > totals.total) {
        loyaltyDiscount = totals.total; // Cannot discount more than the order total
      }

      totals.total = totals.total - loyaltyDiscount;
      totals.loyaltyDiscount = loyaltyDiscount;
      loyaltyAccountToUpdate = loyaltyAccount;
    }

    // 2.5 Evaluate Fraud Risk
    // deviceFingerprint is not explicitly passed to initiateCheckout, so we'll optionally pass it.
    // Wait, the signature of initiateCheckout doesn't have deviceFingerprint. Let's update the signature to accept it.
    const fraudEvaluation = await fraudService.evaluateCheckoutRisk(
      cart,
      customerData,
      shippingAddress,
      totals,
      customerData.deviceFingerprint // I will pass this from controller
    );

    if (fraudEvaluation.riskLevel === 'BLOCKED') {
      await alertService.sendFraudAlert(cartId, fraudEvaluation.fraudScore, fraudEvaluation.riskLevel, fraudEvaluation.fraudSignals, cartId);
      throw new AppError('Checkout blocked due to high fraud risk.', 400);
    }

    // 3. Setup Branch and Pre-Check Stock
    let onlineBranch = await prisma.branch.findFirst({
      where: { OR: [{ name: 'Online' }, { code: 'ONLINE' }] }
    });
    
    if (!onlineBranch) {
      onlineBranch = await prisma.branch.findFirst({ where: { isActive: true } });
    }
    
    if (!onlineBranch) {
      throw new AppError('No valid branch found to fulfill the order.', 400);
    }

    // Pre-check stock before doing anything else
    for (const item of cart.items) {
      const inv = await prisma.inventoryItem.findUnique({
        where: { variantId_branchId: { variantId: item.variantId, branchId: onlineBranch.id } }
      });
      if (!inv || inv.quantity < item.quantity) {
        throw new AppError(`Insufficient stock for item: ${item.variant?.product?.name || item.variantId}. Available: ${inv?.quantity || 0}, Requested: ${item.quantity}`, 400);
      }
    }

    // 4. Create Order & Transactions
    const orderNumber = `LC-${Date.now().toString().slice(-6)}`;
    
    const order = await prisma.$transaction(async (tx) => {
      const createdOrder = await tx.order.create({
        data: {
          orderNumber,
          customerId: customer!.id,
          status: (paymentMethod?.toLowerCase() === 'cod') ? 'PENDING' : 'AWAITING_PAYMENT',
          paymentMethod: paymentMethod || 'COD',
          paymentStatus: (paymentMethod?.toLowerCase() === 'cod') ? 'COD_PENDING' : 'UNPAID',
          subtotal: totals.subtotal,
          shippingFee: totals.shippingFee,
          tax: totals.tax,
          loyaltyDiscount: totals.loyaltyDiscount,
          total: totals.total,
          shippingAddress: shippingAddress,
          fraudScore: fraudEvaluation.fraudScore,
          riskLevel: fraudEvaluation.riskLevel,
          fraudSignals: fraudEvaluation.fraudSignals,
          items: {
            create: cart.items.map((item: any) => ({
              variantId: item.variantId,
              quantity: item.quantity,
              priceAtPurchase: getEffectivePrice(item.variant),
            })),
          },
        },
        include: {
          items: true,
        },
      });

      // Log initial payment transaction
      await tx.paymentTransaction.create({
        data: {
          orderId: createdOrder.id,
          customerId: customer!.id,
          gateway: paymentMethod || 'COD',
          method: paymentMethod || 'COD',
          amount: totals.total,
          status: 'Pending'
        }
      });

      // Deduct Loyalty Points
      if (loyaltyAccountToUpdate && pointsToRedeem && pointsToRedeem > 0) {
        await tx.loyaltyTransaction.create({
          data: {
            accountId: loyaltyAccountToUpdate.id,
            amount: -pointsToRedeem,
            type: 'REDEEMED',
            reason: `Order #${createdOrder.orderNumber}`,
            orderId: createdOrder.id
          }
        });
        await tx.loyaltyAccount.update({
          where: { id: loyaltyAccountToUpdate.id },
          data: { points: { decrement: pointsToRedeem } }
        });
      }

      // Deduct Inventory
      for (const item of cart.items) {
        await inventoryService.adjustStock({
          variantId: item.variantId,
          branchId: onlineBranch!.id,
          type: 'DEDUCT',
          quantity: item.quantity,
          reason: 'Online Order Checkout',
          reference: createdOrder.id
        }, tx);
      }

      // Clean up Cart (DB)
      if (!isGuest) {
        await tx.cart.update({
          where: { id: cartId },
          data: { status: 'CONVERTED' },
        });
      }

      return createdOrder;
    });

    if (fraudEvaluation.riskLevel === 'HIGH') {
      await alertService.sendFraudAlert(order.orderNumber, fraudEvaluation.fraudScore, fraudEvaluation.riskLevel, fraudEvaluation.fraudSignals, cartId);
    }

    // 5. Initiate Payment
    const paymentInfo = await paymentService.initiatePayment(order.id, paymentMethod || 'COD');

    // Only delete the guest cart AFTER successful payment initiation
    if (isGuest) {
      await redisClient.del(`cart:${cartId}`);
    }

    // 6. Trigger Notification
    try {
      await NotificationService.createInternal(
        'New Order Received',
        `Order #${order.orderNumber} has been placed for Rs. ${order.total}`,
        'ORDER',
        `/orders/${order.id}`
      );
    } catch (e) {
      console.error('Failed to trigger notification:', e);
    }

    return { order, payment: paymentInfo };
  },
};
