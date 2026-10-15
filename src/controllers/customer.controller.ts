import { Request, Response, NextFunction } from "express";
import { AppError } from "../middlewares/errorHandler";
import prisma from "../config/prisma";

export const getCustomers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = req.query.search as string;
    const type = req.query.type as string; // 'Registered', 'Guest'
    const sort = req.query.sort as string;

    const skip = (page - 1) * limit;

    let where: any = {};
    if (search) {
      where = {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } }
        ]
      };
    }
    
    if (type === "Registered") {
      where.isGuest = false;
    } else if (type === "Guest") {
      where.isGuest = true;
    }

    let orderBy: any = { createdAt: 'desc' };
    if (sort === "Sort By: Highest Spend") {
      orderBy = { orders: { _count: 'desc' } }; // Simplified, actual spend logic would require aggregation
    } else if (sort === "Sort By: Most Orders") {
      orderBy = { orders: { _count: 'desc' } };
    }

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          orders: { select: { total: true } }
        }
      }),
      prisma.customer.count({ where })
    ]);

    const mappedCustomers = customers.map((c: any) => {
      const ordersCount = c.orders.length;
      const spent = c.orders.reduce((acc: number, o: any) => acc + o.total, 0);
      
      return {
        id: c.id,
        name: `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.companyName || 'Unknown',
        companyName: c.companyName || null,
        phone: c.phone || 'N/A',
        email: c.email || 'N/A',
        customerType: c.customerType || (c.isGuest ? 'RETAIL' : 'REGISTERED'),
        creditLimit: c.creditLimit || 0,
        creditBalance: c.creditBalance || 0,
        vehicleNumber: c.vehicleNumber || null,
        type: c.customerType === 'GARAGE_WORKSHOP' ? 'Workshop / Garage' : c.customerType === 'COMMERCIAL_FLEET' ? 'Commercial Fleet' : (c.isGuest ? 'Retail' : 'Registered'),
        orders: ordersCount,
        spent: `Rs. ${spent.toLocaleString()}`,
        lastActive: c.updatedAt.toLocaleDateString()
      };
    });

    res.status(200).json({
      success: true,
      data: mappedCustomers,
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

export const getCustomerById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new AppError("Customer not found", 404);
    
    res.status(200).json({ success: true, data: customer });
  } catch (error) {
    next(error);
  }
};

export const createCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customer = await prisma.customer.create({ data: req.body });
    res.status(201).json({ success: true, data: customer });
  } catch (error) {
    next(error);
  }
};

export const updateCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const customer = await prisma.customer.update({ where: { id }, data: req.body });
    res.status(200).json({ success: true, data: customer });
  } catch (error) {
    next(error);
  }
};
