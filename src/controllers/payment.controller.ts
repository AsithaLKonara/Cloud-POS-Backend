import { Request, Response, NextFunction } from "express";
import prisma from "../config/prisma";

export const handleWebhook = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { provider } = req.params;
    const signature = req.headers['x-webhook-signature'] as string | undefined;
    
    const { paymentService } = require('../services/payment.service');
    const result = await paymentService.handleWebhook(provider, req.body, signature);
    
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const handlePaymentReturn = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = req.query.orderId as string;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/checkout/success?orderNumber=${orderId}`);
  } catch (error) {
    next(error);
  }
};

export const handlePaymentCancel = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = req.query.orderId as string;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/checkout/failed?orderNumber=${orderId}`);
  } catch (error) {
    next(error);
  }
};

export const retryPayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderNumber = req.params.orderNumber as string;
    const { paymentMethod } = req.body;

    const order = await prisma.order.findFirst({ where: { orderNumber } });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    await prisma.order.update({
      where: { id: order.id },
      data: {
        paymentMethod: paymentMethod,
        status: (paymentMethod?.toLowerCase() === 'cod') ? 'PENDING' : 'AWAITING_PAYMENT'
      }
    });

    const { paymentService } = require('../services/payment.service');
    const paymentInfo = await paymentService.initiatePayment(order.id, paymentMethod);

    res.status(200).json({ success: true, payment: paymentInfo });
  } catch (error) {
    next(error);
  }
};

export const getPaymentTransactions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const gateway = req.query.gateway as string;
    const search = req.query.search as string;
    const status = req.query.status as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const skip = (page - 1) * limit;

    let where: any = {};
    if (gateway && gateway !== "All") {
      where.gateway = gateway;
    }
    if (status && status !== "All") {
      where.status = status;
    }
    if (startDate && endDate) {
      where.createdAt = {
        gte: new Date(startDate),
        lte: new Date(endDate + 'T23:59:59.999Z')
      };
    }

    if (search) {
      where.OR = [
        { id: { contains: search, mode: 'insensitive' } },
        { order: { orderNumber: { contains: search, mode: 'insensitive' } } },
        { customer: { firstName: { contains: search, mode: 'insensitive' } } },
        { customer: { lastName: { contains: search, mode: 'insensitive' } } }
      ];
    }

    const [transactions, total] = await Promise.all([
      prisma.paymentTransaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: true,
          order: { select: { orderNumber: true } }
        }
      }),
      prisma.paymentTransaction.count({ where })
    ]);

    const mappedTransactions = transactions.map((t: any) => ({
      id: t.id,
      order: t.order?.orderNumber || 'Unknown',
      customer: t.customer ? `${t.customer.firstName || ''} ${t.customer.lastName || ''}`.trim() : 'Guest',
      gateway: t.gateway,
      method: t.method,
      amount: t.amount,
      amountStr: `Rs. ${t.amount.toLocaleString()}`,
      status: t.status,
      created: t.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      date: t.createdAt.toISOString().split('T')[0]
    }));

    res.status(200).json({
      success: true,
      data: mappedTransactions,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getPaymentKpis = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const gateway = req.query.gateway as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    
    let where: any = {};
    if (gateway && gateway !== "All") {
      where.gateway = gateway;
    }
    if (startDate && endDate) {
      where.createdAt = {
        gte: new Date(startDate),
        lte: new Date(endDate + 'T23:59:59.999Z')
      };
    }

    const transactions = await prisma.paymentTransaction.findMany({ 
      where,
      orderBy: { createdAt: 'asc' }
    });

    const totalAmount = transactions.filter((t: any) => t.status === "Paid").reduce((acc: number, t: any) => acc + t.amount, 0);
    const successfulCount = transactions.filter((t: any) => t.status === "Paid").length;
    const pendingCount = transactions.filter((t: any) => t.status === "Pending").length;
    const failedCount = transactions.filter((t: any) => t.status === "Failed").length;
    const totalCount = transactions.length;
    const successRate = totalCount > 0 ? Math.round((successfulCount / totalCount) * 100) : 0;

    // Aggregations for charts
    const chartMap: Record<string, { collected: number, pending: number }> = {};
    const gatewayMap: Record<string, { value: number, transactions: number }> = {};

    transactions.forEach((t: any) => {
      const dateStr = t.createdAt.toISOString().split('T')[0];
      if (!chartMap[dateStr]) chartMap[dateStr] = { collected: 0, pending: 0 };
      if (t.status === 'Paid') chartMap[dateStr]!.collected += t.amount;
      if (t.status === 'Pending') chartMap[dateStr]!.pending += t.amount;

      if (!gatewayMap[t.gateway]) gatewayMap[t.gateway] = { value: 0, transactions: 0 };
      if (t.status === 'Paid') {
        gatewayMap[t.gateway]!.value += t.amount;
        gatewayMap[t.gateway]!.transactions += 1;
      }
    });

    const chartData = Object.keys(chartMap).map(date => ({
      date,
      collected: chartMap[date]!.collected,
      pending: chartMap[date]!.pending
    }));

    const gatewayData = Object.keys(gatewayMap).map(name => ({
      name,
      value: gatewayMap[name]!.value,
      transactions: gatewayMap[name]!.transactions
    })).filter(g => g.value > 0);

    // Calculate total pending amount
    const pendingAmount = transactions.filter((t: any) => t.status === "Pending").reduce((acc: number, t: any) => acc + t.amount, 0);

    res.status(200).json({
      success: true,
      data: {
        totalAmount,
        pendingAmount,
        successfulCount: successfulCount.toString(),
        pendingCount: pendingCount.toString(),
        failedCount: failedCount.toString(),
        successRate,
        chartData,
        gatewayData
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getPaymentMethods = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const setting = await prisma.setting.findUnique({
      where: { key: 'PAYMENT_METHODS' }
    });

    if (setting && setting.value) {
      try {
        const methods = JSON.parse(setting.value);
        return res.status(200).json({ success: true, data: methods });
      } catch (e) {
        console.error("Failed to parse PAYMENT_METHODS setting", e);
      }
    }

    // Default fallback if setting doesn't exist or is invalid
    const defaultMethods = [
      { id: "cod", name: "Cash on delivery", type: "offline", active: true },
      { id: "mintpay", name: "Mintpay", type: "bnpl", active: true, badge: "Pay Later" },
      { id: "koko", name: "Koko: BNPL", type: "bnpl", active: true, badge: "Pay Later" },
      { id: "payzy", name: "Payzy", type: "gateway", active: true },
      { id: "onepay", name: "Bank Card / Bank Account", type: "gateway", active: true }
    ];

    res.status(200).json({ success: true, data: defaultMethods });
  } catch (error) {
    next(error);
  }
};

export const getPaymentStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderNumber = req.params.orderNumber as string;
    const order = await prisma.order.findFirst({
      where: { orderNumber },
      select: { paymentStatus: true, status: true }
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.status(200).json({ success: true, paymentStatus: order.paymentStatus });
  } catch (error) {
    next(error);
  }
};
