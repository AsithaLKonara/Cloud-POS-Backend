import prisma from '../config/prisma';
import { FardarService } from './fardar.service';
import { inventoryService } from './inventory.service';
import { loyaltyService } from './loyalty.service';
import { NotificationService } from './notification.service';

export interface QuickDispatchPayload {
  customer: {
    phone: string;
    email?: string;
    firstName: string;
    lastName: string;
    addressLine1: string;
    addressLine2?: string;
    addressLine3?: string;
    city: string;
    district?: string;
    postalCode?: string;
  };
  branchId: string;
  items: {
    variantId: string;
    quantity: number;
    // Removed client-provided prices, we calculate server-side
  }[];
  paymentMethod: string; // 'COD', 'BANK_TRANSFER', 'CARD_MANUAL'
  discount?: number;
}

export const orderService = {
  async searchCustomerByPhone(phone: string) {
    const customer = await prisma.customer.findFirst({
      where: { phone },
      include: {
        addresses: {
          where: { type: 'SHIPPING' },
          orderBy: { isDefault: 'desc' },
          take: 1
        }
      }
    });
    return customer;
  },

  async createQuickDispatchOrder(data: QuickDispatchPayload) {
    return prisma.$transaction(async (tx) => {
      // 1. Find or create customer
      let customer = await tx.customer.findFirst({
        where: { phone: data.customer.phone }
      });

      if (!customer && data.customer.email) {
        customer = await tx.customer.findFirst({
          where: { email: data.customer.email }
        });
      }

      if (!customer) {
        customer = await tx.customer.create({
          data: {
            phone: data.customer.phone,
            email: data.customer.email || null,
            firstName: data.customer.firstName,
            lastName: data.customer.lastName,
            isGuest: true
          }
        });
      } else {
        let updateData: any = {};
        if (!customer.firstName && data.customer.firstName) updateData.firstName = data.customer.firstName;
        if (!customer.lastName && data.customer.lastName) updateData.lastName = data.customer.lastName;
        
        if (!customer.email && data.customer.email) {
          const emailTaken = await tx.customer.findFirst({ where: { email: data.customer.email } });
          if (!emailTaken) updateData.email = data.customer.email;
        }

        if (Object.keys(updateData).length > 0) {
          customer = await tx.customer.update({
            where: { id: customer.id },
            data: updateData
          });
        }
      }

      // 2. Check and add address if needed
      const existingAddress = await tx.address.findFirst({
        where: {
          customerId: customer.id,
          addressLine1: data.customer.addressLine1,
          city: data.customer.city
        }
      });

      let addressId: string;
      if (!existingAddress) {
        const newAddress = await tx.address.create({
          data: {
            customerId: customer.id,
            type: 'SHIPPING',
            firstName: data.customer.firstName,
            lastName: data.customer.lastName,
            addressLine1: data.customer.addressLine1,
            addressLine2: data.customer.addressLine2,
            addressLine3: data.customer.addressLine3,
            city: data.customer.city,
            district: data.customer.district,
            postalCode: data.customer.postalCode,
            phone: data.customer.phone,
            isDefault: true
          }
        });
        addressId = newAddress.id;
      } else {
        addressId = existingAddress.id;
      }

      // 3. Inventory Validation & Deduction
      for (const item of data.items) {
        const inventory = await tx.inventoryItem.findUnique({
          where: {
            variantId_branchId: {
              variantId: item.variantId,
              branchId: data.branchId
            }
          }
        });

        if (!inventory || inventory.quantity < item.quantity) {
          throw new Error(`Insufficient stock for variant ${item.variantId} in the selected branch.`);
        }

        // Deduct stock using the unified service to ensure global quantity sync and low stock alerts
        await inventoryService.adjustStock({
          variantId: item.variantId,
          branchId: data.branchId,
          type: 'DEDUCT',
          quantity: item.quantity,
          reason: 'Quick Dispatch Manual Order'
        }, tx);
      }

      // 4. Generate Order Number (e.g. QD-12345)
      const orderCount = await tx.order.count();
      const orderNumber = `QD-${10000 + orderCount + 1}`;

      // 4.5 Server-side Price Recalculation
      let subtotal = 0;
      const orderItems = [];

      for (const item of data.items) {
        const variant = await tx.productVariant.findUnique({
          where: { id: item.variantId }
        });

        if (!variant) throw new Error(`Variant ${item.variantId} not found`);

        const price = variant.salePrice ?? variant.price;
        subtotal += price * item.quantity;

        orderItems.push({
          variantId: item.variantId,
          quantity: item.quantity,
          priceAtPurchase: price
        });
      }

      const shippingFee = 400; // Flat fee or calculate based on logic
      const discount = data.discount || 0;
      const tax = 0;
      const total = subtotal + shippingFee + tax - discount;

      // 5. Create Order
      const paymentStatus = data.paymentMethod === 'COD' ? 'COD_PENDING' : 'PAID';

      const order = await tx.order.create({
        data: {
          orderNumber,
          type: 'ECOMMERCE', // It's an ecommerce order placed manually
          customerId: customer.id,
          branchId: data.branchId,
          status: 'PENDING',
          paymentMethod: data.paymentMethod,
          paymentStatus: paymentStatus,
          subtotal: subtotal,
          shippingFee: shippingFee,
          tax: tax,
          total: total,
          shippingAddress: data.customer,
          billingAddress: data.customer,
          items: {
            create: orderItems
          }
        },
        include: {
          items: true,
          customer: true
        }
      });

      // Log Payment Transaction
      await tx.paymentTransaction.create({
        data: {
          orderId: order.id,
          customerId: order.customerId,
          gateway: data.paymentMethod || 'MANUAL',
          method: data.paymentMethod || 'MANUAL',
          amount: order.total,
          status: paymentStatus === 'PAID' ? 'Paid' : 'Pending'
        }
      });

      // Trigger Notification
      try {
        await NotificationService.createInternal(
          'Manual Order Placed',
          `Order #${order.orderNumber} created manually via POS for Rs. ${order.total}`,
          'ORDER',
          `/orders/${order.id}`
        );
      } catch (e) {
        console.error('Failed to trigger notification:', e);
      }

      return order;
    });
  },

  async getOrders(filters: any = {}, pagination: { skip?: number; take?: number } = {}) {
    const { status, paymentGateway, branchId, customerId, type, search, startDate, endDate } = filters;
    const { skip = 0, take = 20 } = pagination;

    const where: any = {};
    if (status) {
      where.status = status;
    } else {
      where.status = { not: 'AWAITING_PAYMENT' };
    }
    if (branchId) where.branchId = branchId;
    if (customerId) where.customerId = customerId;
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { trackingNumber: { contains: search, mode: 'insensitive' } },
        { customer: { firstName: { contains: search, mode: 'insensitive' } } },
        { customer: { lastName: { contains: search, mode: 'insensitive' } } },
        { customer: { phone: { contains: search, mode: 'insensitive' } } }
      ];
    }
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        // Ensure the end date includes the entire day if it's just a date without time
        if (endDate.length <= 10) end.setUTCHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }
    
    // Gateway filtering: COD, BANK_TRANSFER, CARD_MANUAL for manual methods
    // Online methods: Koko, Mintpay, etc.
    // If gateway matches paymentMethod, we can filter by that.
    if (paymentGateway) {
      if (['Koko', 'Mintpay', 'OnePay', 'Payzy'].includes(paymentGateway)) {
        where.paymentMethod = paymentGateway; // Adjust if payment gateway is stored differently
      } else if (paymentGateway === 'COD') {
        where.paymentMethod = 'COD';
      }
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take,
        include: {
          customer: true,
          branch: true,
          items: {
            include: {
              variant: {
                include: {
                  product: true
                }
              }
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      }),
      prisma.order.count({ where })
    ]);

    return { orders, total };
  },

  async getOrderById(id: string) {
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        customer: true,
        branch: true,
        items: {
          include: {
            variant: {
              include: {
                product: true
              }
            }
          }
        }
      }
    });

    if (!order) {
      throw new Error("Order not found");
    }

    return order;
  },

  async updateOrderStatus(id: string, status: string, weightKg?: number) {
    // Validate valid status progression or general status updates
    const validStatuses = ['PENDING', 'PROCESSING', 'DISPATCHED', 'DELIVERED', 'CANCELLED'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    let order = await prisma.order.findUnique({
      where: { id },
      include: { customer: true }
    });

    if (!order) {
      throw new Error("Order not found");
    }

    const dataToUpdate: any = { status };

    if (status === 'DISPATCHED' && order.status !== 'DISPATCHED') {
      const shippingAddress = order.shippingAddress as any;
      const details = {
        orderId: order.orderNumber,
        customerName: order.customer?.firstName ? `${order.customer.firstName} ${order.customer.lastName || ''}` : shippingAddress?.firstName + ' ' + (shippingAddress?.lastName || ''),
        customerPhone: order.customer?.phone || shippingAddress?.phone || 'Unknown',
        customerAddress1: shippingAddress?.addressLine1 || 'Unknown',
        customerAddress2: shippingAddress?.addressLine2 || '',
        customerAddress3: shippingAddress?.addressLine3 || '',
        city: shippingAddress?.city || 'Unknown',
        district: shippingAddress?.district || shippingAddress?.city || 'Unknown',
        nearestCity: shippingAddress?.nearestCity,
        weightKg: weightKg || 1.0,
        codAmount: (order.paymentMethod?.toUpperCase() === 'COD') ? Number(order.total) : 0
      };

      try {
        const shipment = await FardarService.createShipment(details);
        if (shipment.success) {
          dataToUpdate.trackingNumber = shipment.trackingNumber;
          dataToUpdate.labelUrl = shipment.labelUrl;
        } else {
          console.error("Fardar shipment returned failure:", shipment.message);
          throw new Error(shipment.message);
        }
      } catch (err: any) {
        console.error("Failed to create Fardar shipment (Network/Internal):", err);
        throw new Error(err.message || "Failed to create Fardar shipment");
      }
    }

    if (status === 'DELIVERED' && order.paymentMethod?.toUpperCase() === 'COD' && order.paymentStatus !== 'PAID') {
      dataToUpdate.paymentStatus = 'PAID';
      
      // Log payment transaction for COD
      const existingTx = await prisma.paymentTransaction.findFirst({ where: { orderId: order.id } });
      if (existingTx) {
        await prisma.paymentTransaction.update({
          where: { id: existingTx.id },
          data: { status: 'Paid' }
        });
      } else {
        await prisma.paymentTransaction.create({
          data: {
            orderId: order.id,
            customerId: order.customerId,
            gateway: 'COD',
            method: 'COD',
            amount: order.total,
            status: 'Paid'
          }
        });
      }
    }

    order = await prisma.order.update({
      where: { id },
      data: dataToUpdate,
      include: {
        customer: true,
        items: true
      }
    });

    if (status === 'DELIVERED') {
      try {
        await loyaltyService.creditPointsForOrder(order.id);
      } catch (err) {
        console.error("Failed to credit loyalty points:", err);
      }
    }

    // Trigger Notification
    try {
      await NotificationService.createInternal(
        'Order Status Updated',
        `Order #${order.orderNumber} status changed to ${status}`,
        'SYSTEM',
        `/orders/${order.id}`
      );
    } catch (e) {
      console.error('Failed to trigger notification:', e);
    }

    return order;
  },

  async refundOrder(id: string) {
    let order = await prisma.order.findUnique({
      where: { id },
      include: { items: true }
    });

    if (!order) throw new Error("Order not found");
    if (order.status === 'CANCELLED') throw new Error("Order already cancelled");

    // Revert status and payment
    order = await prisma.order.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        paymentStatus: 'REFUNDED'
      },
      include: { items: true }
    });

    // Restore stock
    const branchId = order.branchId || (await prisma.branch.findFirst({ where: { OR: [{ name: 'Online' }, { code: 'ONLINE' }] } }))?.id;
    if (branchId) {
      for (const item of order.items) {
        await inventoryService.adjustStock({
          variantId: item.variantId,
          branchId,
          type: 'RECEIVE',
          quantity: item.quantity,
          reason: 'Order Refund Restock',
          reference: order.id
        });
      }
    }

    return order;
  },

  async refundPartialOrder(id: string, itemsToReturn: { variantId: string, qty: number }[], refundMethod?: string) {
    let order = await prisma.order.findUnique({
      where: { id },
      include: { items: true }
    });

    if (!order) throw new Error("Order not found");

    const branchId = order.branchId || (await prisma.branch.findFirst({ where: { OR: [{ name: 'Online' }, { code: 'ONLINE' }] } }))?.id;
    if (branchId) {
      for (const returnedItem of itemsToReturn) {
        await inventoryService.adjustStock({
          variantId: returnedItem.variantId,
          branchId,
          type: 'RECEIVE',
          quantity: returnedItem.qty,
          reason: `Partial Refund (${refundMethod || 'MANUAL'}) Restock`,
          reference: order.id
        });
      }
    }

    // Mark as partially refunded
    order = await prisma.order.update({
      where: { id },
      data: {
        paymentStatus: 'PARTIALLY_REFUNDED'
      },
      include: { items: true }
    });

    return order;
  },

  async getOrderConfirmation(orderNumber: string) {
    const order = await prisma.order.findFirst({
      where: { orderNumber },
      include: {
        items: {
          include: {
            variant: {
              include: {
                product: {
                  select: { id: true, name: true, slug: true }
                }
              }
            }
          }
        },
        customer: {
          select: { firstName: true, lastName: true, email: true, phone: true }
        }
      }
    });

    if (!order) {
      throw new Error("Order not found");
    }

    return order;
  },

  async trackOrder(orderNumber: string, phone: string) {
    const order = await prisma.order.findFirst({
      where: { orderNumber },
      include: { customer: true, items: { include: { variant: { include: { product: true } } } } }
    });

    if (!order) throw new Error("Order not found");
    
    const shippingAddress = order.shippingAddress as any;
    const orderPhone = order.customer?.phone || shippingAddress?.phone;

    if (orderPhone !== phone) {
      throw new Error("Phone number does not match order");
    }

    // Optionally update real-time status from Fardar here if it has a tracking number
    if (order.trackingNumber && order.status === 'DISPATCHED') {
      try {
        const trackingDetails = await FardarService.trackShipment(order.trackingNumber);
        return { ...order, trackingInfo: { status: trackingDetails.status, location: trackingDetails.location } };
      } catch (err) {
        // Ignore fardar errors
      }
    }

    return order;
  },

  async trackOrdersByPhone(phone: string) {
    const orders = await prisma.order.findMany({
      where: {
        OR: [
          { customer: { phone } },
          { shippingAddress: { path: ['phone'], equals: phone } }
        ],
        status: { notIn: ['DELIVERED', 'CANCELLED'] }
      },
      include: { customer: true, items: { include: { variant: { include: { product: true } } } } },
      orderBy: { createdAt: 'desc' }
    });

    // We can't easily query JSON field exact match with generic findMany without raw query in sqlite/postgres interchangeably.
    // If the above JSON query fails, we filter in memory as a fallback.
    // Actually, since Prisma handles JSON filter well in Postgres, it should be fine. But let's simplify:
    
    // For each order, fetch tracking info if dispatched
    const populatedOrders = await Promise.all(
      orders.map(async (order) => {
        if (order.trackingNumber && (order.status === 'DISPATCHED' || order.status === 'PROCESSING')) {
          try {
            const trackingDetails = await FardarService.trackShipment(order.trackingNumber);
            return { ...order, trackingInfo: { status: trackingDetails.status, location: trackingDetails.location } };
          } catch (err) {
            return order;
          }
        }
        return order;
      })
    );

    return populatedOrders;
  },

  async updateOrderFromFardarWebhook(trackingNumber: string, statusText: string, lastUpdated?: string) {
    // Map Fardar text statuses to our enum if applicable, e.g. "DELIVERED"
    // "107 - Delivered" might come as "Delivered", "108 - Returned"
    const order = await prisma.order.findFirst({
      where: { trackingNumber }
    });

    if (!order) {
      console.warn(`[Webhook] Order not found for tracking number: ${trackingNumber}`);
      return;
    }

    let internalStatus = order.status;
    const normalized = statusText.toUpperCase();
    if (normalized.includes('DELIVERED')) internalStatus = 'DELIVERED';
    else if (normalized.includes('CANCELLED')) internalStatus = 'CANCELLED';
    else if (normalized.includes('RETURNED')) internalStatus = 'RETURNED'; // Or CANCELLED based on logic

    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: internalStatus,
        updatedAt: lastUpdated ? new Date(lastUpdated) : new Date()
      }
    });

    console.log(`[Webhook] Order ${order.id} updated to ${internalStatus} via Fardar Webhook`);
  }
};
