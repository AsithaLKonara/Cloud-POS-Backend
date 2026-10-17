import { Request, Response } from 'express';
import prisma from '../config/prisma';

import { posService } from '../services/pos.service';

export const openSession = async (req: Request, res: Response) => {
  try {
    const session = await posService.openSession(req.body);
    res.status(201).json(session);
  } catch (error: any) {
    console.error(error);
    if (error.message && error.message.includes('Terminal already has an open session')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
};

export const closeSession = async (req: Request, res: Response) => {
  try {
    const closedSession = await posService.closeSession(req.body);
    res.json(closedSession);
  } catch (error: any) {
    console.error(error);
    if (error.message && error.message.includes('Session not found')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
};

export const getCurrentSession = async (req: Request, res: Response) => {
  try {
    const { terminalId } = req.query;
    if (!terminalId) {
      return res.status(400).json({ error: 'Terminal ID required.' });
    }
    
    const session = await posService.getCurrentSession(String(terminalId));
    res.json(session);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
};

export const getExpectedClosing = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required.' });
    }
    
    const expectedClosing = await posService.getExpectedClosing(String(sessionId));
    res.json(expectedClosing);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
};

export const getSessionSummary = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required.' });
    }
    
    const summary = await posService.getSessionSummary(String(sessionId));
    res.json(summary);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
};

export const generateVoucher = async (req: Request, res: Response) => {
  try {
    const { branchId, returnedItems, value, orderId } = req.body;

    // Delegate fully to posService which handles restock + voucher creation atomically
    const voucher = await posService.generateVoucher({ branchId, returnedItems, value, orderId });
    res.status(201).json(voucher);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
};

export const validateVoucher = async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    
    const voucher = await prisma.exchangeVoucher.findUnique({
      where: { code: code as string }
    });
    
    if (!voucher) {
      return res.status(404).json({ error: 'Voucher not found' });
    }
    if (voucher.status !== 'ACTIVE') {
      return res.status(400).json({ error: 'Voucher is already used or invalid' });
    }
    
    res.json(voucher);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
};

export const processPosOrder = async (req: Request, res: Response) => {
  try {
    const { 
      branchId, 
      sessionId, 
      customerId: providedCustomerId, 
      customerName, 
      customerPhone, 
      shippingAddress, 
      items, 
      paymentMethod, 
      appliedVouchers 
    } = req.body;
    
    const orderNumber = `POS-${Date.now()}`;
    
    // 1. Validate vouchers and calculate deductions
    let voucherDeduction = 0;
    const validVouchers = [];
    if (appliedVouchers && appliedVouchers.length > 0) {
      for (const vCode of appliedVouchers) {
        const voucher = await prisma.exchangeVoucher.findUnique({ where: { code: vCode } });
        if (voucher && voucher.status === 'ACTIVE') {
          voucherDeduction += voucher.value;
          validVouchers.push(voucher.id);
        }
      }
    }
    
    // 1.5 Server-side recalculation
    let calculatedSubtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const variant = await prisma.productVariant.findUnique({
        where: { id: item.variantId }
      });
      if (!variant) return res.status(400).json({ error: `Variant ${item.variantId} not found` });

      const price = variant.salePrice ?? variant.price;
      calculatedSubtotal += price * item.qty;

      orderItems.push({
        variantId: item.variantId,
        quantity: Math.max(1, Math.round(item.qty)),
        dispensedVolumeLiters: item.dispensedVolumeLiters || (item.qty % 1 !== 0 ? item.qty : null),
        priceAtPurchase: price,
        costPriceAtPurchase: variant.costPrice ?? 0
      });
    }

    const calculatedTax = 0;
    const calculatedTotal = Math.max(0, (calculatedSubtotal + calculatedTax) - voucherDeduction);

    // Validate branchId
    if (!branchId) {
      return res.status(400).json({ error: 'Branch ID is required to process a POS order.' });
    }
    const branchExists = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } });
    if (!branchExists) {
      return res.status(400).json({ error: `Branch "${branchId}" not found. Please ensure your account is assigned to a valid branch.` });
    }

    // 1.8 Inventory check
    for (const item of items) {
      const variant = await prisma.productVariant.findUnique({
        where: { id: item.variantId },
        include: { product: true }
      });
      if (variant?.product && (variant.product.trackInventory === false || variant.product.productType === 'SERVICE')) {
        continue;
      }

      const inventory = await prisma.inventoryItem.findUnique({
        where: { variantId_branchId: { variantId: item.variantId, branchId } }
      });
      if (!inventory || inventory.quantity < item.qty) {
        return res.status(400).json({ error: `Insufficient stock for variant ${item.variantId}. Available: ${inventory?.quantity || 0}, Requested: ${item.qty}` });
      }
    }

    // 1.9 Customer Resolution
    let finalCustomerId = providedCustomerId;
    if (!finalCustomerId && customerPhone) {
      let customer = await prisma.customer.findFirst({
        where: { phone: customerPhone },
      });

      if (!customer) {
        customer = await prisma.customer.create({
          data: {
            phone: customerPhone,
            firstName: customerName ? customerName.split(" ")[0] : "Guest",
            lastName: customerName ? customerName.split(" ").slice(1).join(" ") : "",
            isGuest: true,
          },
        });
      }
      finalCustomerId = customer.id;
    }

    const isCredit = paymentMethod === 'CREDIT_ACCOUNT' || paymentMethod === 'GARAGE_CREDIT';
    if (isCredit) {
      if (!finalCustomerId) {
        return res.status(400).json({ error: 'Customer / Garage account is required for Credit / Pay Later sales.' });
      }
      const customer = await prisma.customer.findUnique({ where: { id: finalCustomerId } });
      if (!customer) {
        return res.status(404).json({ error: 'Customer account not found.' });
      }
      if (customer.creditLimit > 0 && ((customer.creditBalance || 0) + calculatedTotal > customer.creditLimit)) {
        return res.status(400).json({ 
          error: `Credit limit exceeded! Customer Credit Limit: Rs. ${customer.creditLimit.toLocaleString()}, Current Balance: Rs. ${(customer.creditBalance || 0).toLocaleString()}, Attempted Charge: Rs. ${calculatedTotal.toLocaleString()}` 
        });
      }
    }

    // 2. Create Order
    const order = await prisma.order.create({
      data: {
        orderNumber,
        type: 'POS',
        status: 'DELIVERED', // POS orders are delivered instantly
        paymentStatus: isCredit ? 'UNPAID' : 'PAID',
        paymentMethod: isCredit ? 'CREDIT_ACCOUNT' : paymentMethod,
        subtotal: calculatedSubtotal,
        tax: calculatedTax,
        shippingFee: 0,
        total: calculatedTotal,
        branchId,
        posSessionId: sessionId,
        customerId: finalCustomerId || undefined,
        shippingAddress: shippingAddress || undefined,
        items: {
          create: orderItems
        }
      },
      include: {
        items: {
          include: { variant: { include: { product: true } } }
        },
        customer: true
      }
    });
    
    // 3. Update Vouchers
    if (validVouchers.length > 0) {
      await prisma.exchangeVoucher.updateMany({
        where: { id: { in: validVouchers } },
        data: { status: 'USED', usedAt: new Date(), orderId: order.id }
      });
    }

    // 3.5 Record Customer Credit Ledger if Credit Account
    if (isCredit && finalCustomerId) {
      const updatedCustomer = await prisma.customer.update({
        where: { id: finalCustomerId },
        data: { creditBalance: { increment: calculatedTotal } }
      });

      await prisma.customerCreditLedger.create({
        data: {
          customerId: finalCustomerId,
          orderId: order.id,
          type: 'CHARGE',
          amount: calculatedTotal,
          balanceAfter: updatedCustomer.creditBalance,
          paymentMethod: 'CREDIT_ACCOUNT',
          reference: order.orderNumber,
          notes: `POS Credit Sale Invoice #${order.orderNumber}`
        }
      });
    }

    // 3.8 Update POS Session Metrics
    if (sessionId) {
      if (paymentMethod === 'CASH') {
        await prisma.posSession.update({
          where: { id: sessionId },
          data: { totalCashSales: { increment: calculatedTotal } }
        }).catch(() => {});
      } else if (paymentMethod === 'CARD' || paymentMethod === 'VISA' || paymentMethod === 'MASTERCARD') {
        await prisma.posSession.update({
          where: { id: sessionId },
          data: { totalCardSales: { increment: calculatedTotal } }
        }).catch(() => {});
      } else if (isCredit) {
        await prisma.posSession.update({
          where: { id: sessionId },
          data: { totalCreditSales: { increment: calculatedTotal } }
        }).catch(() => {});
      }
    }
    
    // 4. Deduct Inventory
    const { inventoryService } = require('../services/inventory.service');
    for (const item of items) {
      await inventoryService.adjustStock({
        variantId: item.variantId,
        branchId,
        type: 'DEDUCT',
        quantity: Math.max(1, Math.ceil(item.qty)),
        reason: 'POS Sale',
        reference: order.id
      });
    }
    
    res.status(201).json(order);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
};

export const getCustomerCreditLedger = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        creditTransactions: {
          orderBy: { createdAt: 'desc' },
          take: 50
        }
      } as any
    });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    const availableCredit = customer.creditLimit > 0 ? Math.max(0, customer.creditLimit - (customer.creditBalance || 0)) : null;
    res.json({
      success: true,
      data: {
        customer: {
          id: customer.id,
          name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.companyName || 'Unknown',
          companyName: customer.companyName,
          phone: customer.phone,
          customerType: customer.customerType,
          creditLimit: customer.creditLimit,
          creditBalance: customer.creditBalance || 0,
          availableCredit,
          vehicleNumber: customer.vehicleNumber
        },
        transactions: (customer as any).creditTransactions || []
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
};

export const settleCustomerCredit = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { amount, paymentMethod, reference, notes, sessionId } = req.body;
    const settlementAmount = parseFloat(amount);
    if (isNaN(settlementAmount) || settlementAmount <= 0) {
      return res.status(400).json({ error: 'Valid positive settlement amount is required' });
    }

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const updatedCustomer = await prisma.customer.update({
      where: { id },
      data: { creditBalance: { decrement: settlementAmount } }
    });

    const ledger = await prisma.customerCreditLedger.create({
      data: {
        customerId: id,
        type: 'SETTLEMENT',
        amount: settlementAmount,
        balanceAfter: updatedCustomer.creditBalance,
        paymentMethod: paymentMethod || 'CASH',
        reference: reference || null,
        notes: notes || 'Debt Settlement payment received'
      }
    });

    if (sessionId && (paymentMethod === 'CASH' || !paymentMethod)) {
      await prisma.posSession.update({
        where: { id: sessionId },
        data: { totalCashSales: { increment: settlementAmount } }
      }).catch(() => {});
    }

    res.json({
      success: true,
      data: {
        newBalance: updatedCustomer.creditBalance,
        ledger
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
};

