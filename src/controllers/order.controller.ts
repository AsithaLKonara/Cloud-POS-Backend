import { Request, Response } from 'express';
import { orderService } from '../services/order.service';
import { WhatsAppService } from '../services/whatsapp.service';

export const searchCustomer = async (req: Request, res: Response) => {
  try {
    const { phone } = req.query;
    if (!phone || typeof phone !== 'string') {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const customer = await orderService.searchCustomerByPhone(phone);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json(customer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const createQuickDispatch = async (req: Request, res: Response) => {
  try {
    // Basic validation
    const { customer, branchId, items, paymentMethod } = req.body;
    
    if (!customer || !customer.phone || !customer.firstName || !customer.lastName || !customer.addressLine1 || !customer.city) {
      return res.status(400).json({ error: 'Incomplete customer details' });
    }
    
    if (!branchId) {
      return res.status(400).json({ error: 'Branch is required' });
    }

    if (!items || !items.length) {
      return res.status(400).json({ error: 'Order must contain at least one item' });
    }

    if (!paymentMethod) {
      return res.status(400).json({ error: 'Payment method is required' });
    }

    const order = await orderService.createQuickDispatchOrder(req.body);
    res.status(201).json(order);
  } catch (error: any) {
    console.error(error);
    res.status(400).json({ error: error.message || 'Failed to create order' });
  }
};

export const getOrders = async (req: Request, res: Response) => {
  try {
    const { status, paymentGateway, branchId, customerId, page, limit, type, search, startDate, endDate } = req.query;
    
    const skip = page ? (parseInt(page as string) - 1) * parseInt(limit as string || '20') : 0;
    const take = limit ? parseInt(limit as string) : 20;

    const result = await orderService.getOrders({
      status,
      paymentGateway,
      branchId,
      customerId,
      type,
      search,
      startDate,
      endDate
    }, { skip, take });

    res.json({
      data: result.orders,
      meta: {
        total: result.total,
        page: page ? parseInt(page as string) : 1,
        limit: take,
        totalPages: Math.ceil(result.total / take)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getOrderById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Order ID is required' });
    const order = await orderService.getOrderById(id as string);
    res.json(order);
  } catch (error: any) {
    console.error(error);
    if (error.message === "Order not found") {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
};

export const updateOrderStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, weightKg } = req.body;
    
    if (!id) return res.status(400).json({ error: 'Order ID is required' });
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    const order = await orderService.updateOrderStatus(id as string, status as string, weightKg as number);
    res.json(order);
  } catch (error: any) {
    console.error(error);
    res.status(400).json({ error: error.message || 'Failed to update order status' });
  }
};

export const refundOrder = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Order ID is required' });

    const order = await orderService.refundOrder(id as string);
    res.json(order);
  } catch (error: any) {
    console.error(error);
    res.status(400).json({ error: error.message || 'Failed to refund order' });
  }
};

export const refundPartialOrder = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { itemsToReturn, refundMethod } = req.body;
    if (!id) return res.status(400).json({ error: 'Order ID is required' });
    if (!itemsToReturn || !Array.isArray(itemsToReturn)) return res.status(400).json({ error: 'itemsToReturn array is required' });

    const order = await orderService.refundPartialOrder(id as string, itemsToReturn, refundMethod);
    res.json(order);
  } catch (error: any) {
    console.error(error);
    res.status(400).json({ error: error.message || 'Failed to process partial refund' });
  }
};
export const getOrderConfirmation = async (req: Request, res: Response) => {
  try {
    const { orderNumber } = req.params;
    if (!orderNumber) {
      return res.status(400).json({ error: 'Order number is required' });
    }

    const order = await orderService.getOrderConfirmation(orderNumber as string);
    res.json(order);
  } catch (error: any) {
    console.error(error);
    res.status(404).json({ error: error.message || 'Order not found' });
  }
};

export const trackOrder = async (req: Request, res: Response) => {
  try {
    const { orderNumber, phone } = req.query;
    if (!orderNumber || !phone) {
      return res.status(400).json({ error: 'orderNumber and phone are required' });
    }

    const order = await orderService.trackOrder(orderNumber as string, phone as string);
    res.json(order);
  } catch (error: any) {
    console.error(error);
    res.status(404).json({ error: error.message || 'Order not found' });
  }
};

export const trackOrdersByPhone = async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    if (!phone) {
      return res.status(400).json({ error: 'phone is required' });
    }

    const orders = await orderService.trackOrdersByPhone(phone as string);
    if (!orders || orders.length === 0) {
      return res.status(404).json({ error: 'No active orders found for this phone number' });
    }
    res.json(orders);
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Failed to track orders' });
  }
};

export const fardarWebhook = async (req: Request, res: Response) => {
  try {
    // Fardar Reverse API payload
    const { waybill_id, delivery_status, last_update_time } = req.body;
    
    if (!waybill_id) {
      return res.status(400).json({ error: 'waybill_id is required' });
    }

    // Call service to update the order
    await orderService.updateOrderFromFardarWebhook(waybill_id, delivery_status, last_update_time);
    
    // Fardar expects a 200 OK
    res.status(200).send('OK');
  } catch (error: any) {
    console.error('Fardar Webhook Error:', error);
    res.status(500).json({ error: error.message || 'Failed to process webhook' });
  }
};

export const sendWhatsAppReceipt = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { phone } = req.body;
    const userId = (req as any).user?.id;

    const result = await WhatsAppService.sendOrderReceipt(id as string, phone, userId);

    res.status(200).json({
      success: true,
      message: `WhatsApp digital e-bill successfully sent to ${result.recipient}`,
      data: result,
    });
  } catch (error: any) {
    console.error('Send WhatsApp Receipt Error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to dispatch WhatsApp receipt',
    });
  }
};
