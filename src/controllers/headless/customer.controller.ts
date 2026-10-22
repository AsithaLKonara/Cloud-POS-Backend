import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../../config/prisma';
import { requestContext } from '../../context/RequestContext';
import { generateAccessToken, verifyAccessToken } from '../../utils/jwt';

export class HeadlessCustomerController {
  async register(req: Request, res: Response): Promise<void> {
    try {
      const store = requestContext.getStore();
      const tenantId = store?.tenantId;
      if (!tenantId) {
        res.status(401).json({ success: false, message: 'Tenant context missing.' });
        return;
      }

      const { firstName, lastName, email, phone, password } = req.body;
      if (!firstName || (!email && !phone)) {
        res.status(400).json({ success: false, message: 'Name and Email or Phone are required.' });
        return;
      }

      // Check existing customer under this tenant
      const existing = await (prisma as any).customer.findFirst({
        where: {
          tenantId,
          OR: [
            ...(email ? [{ email }] : []),
            ...(phone ? [{ phone }] : []),
          ],
        },
      });

      if (existing) {
        res.status(409).json({ success: false, message: 'A customer with this email/phone already exists.' });
        return;
      }

      const passwordHash = password ? await bcrypt.hash(password, 10) : null;

      const customer = await (prisma as any).customer.create({
        data: {
          tenantId,
          firstName,
          lastName: lastName || '',
          email: email || null,
          phone: phone || null,
          status: 'ACTIVE',
          loyaltyPoints: 0,
        },
      });

      const token = generateAccessToken({
        userId: customer.id,
        email: customer.email || '',
        roles: ['CUSTOMER'],
        permissions: [],
        tenantId,
      });

      res.status(201).json({
        success: true,
        message: 'Customer registered successfully.',
        data: {
          customer: {
            id: customer.id,
            firstName: customer.firstName,
            lastName: customer.lastName,
            email: customer.email,
            phone: customer.phone,
            loyaltyPoints: customer.loyaltyPoints,
          },
          token,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  async login(req: Request, res: Response): Promise<void> {
    try {
      const store = requestContext.getStore();
      const tenantId = store?.tenantId;
      if (!tenantId) {
        res.status(401).json({ success: false, message: 'Tenant context missing.' });
        return;
      }

      const { emailOrPhone, password } = req.body;
      if (!emailOrPhone) {
        res.status(400).json({ success: false, message: 'Email or phone number is required.' });
        return;
      }

      const customer = await (prisma as any).customer.findFirst({
        where: {
          tenantId,
          OR: [{ email: emailOrPhone }, { phone: emailOrPhone }],
        },
      });

      if (!customer) {
        res.status(401).json({ success: false, message: 'Customer account not found.' });
        return;
      }

      const token = generateAccessToken({
        userId: customer.id,
        email: customer.email || '',
        roles: ['CUSTOMER'],
        permissions: [],
        tenantId,
      });

      res.status(200).json({
        success: true,
        data: {
          customer: {
            id: customer.id,
            firstName: customer.firstName,
            lastName: customer.lastName,
            email: customer.email,
            phone: customer.phone,
            loyaltyPoints: customer.loyaltyPoints,
          },
          token,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  async getProfile(req: Request, res: Response): Promise<void> {
    try {
      const store = requestContext.getStore();
      const tenantId = store?.tenantId;
      const authHeader = req.headers['x-customer-token'] as string || req.headers.authorization;
      const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;

      if (!token) {
        res.status(401).json({ success: false, message: 'Customer session token missing.' });
        return;
      }

      const payload = verifyAccessToken(token);
      if (!payload || !payload.userId) {
        res.status(401).json({ success: false, message: 'Invalid customer token.' });
        return;
      }

      const customer = await (prisma as any).customer.findFirst({
        where: { id: payload.userId, tenantId },
        include: {
          orders: {
            take: 5,
            orderBy: { createdAt: 'desc' },
            select: { id: true, orderNumber: true, total: true, status: true, createdAt: true },
          },
        },
      });

      if (!customer) {
        res.status(404).json({ success: false, message: 'Customer not found.' });
        return;
      }

      res.status(200).json({ success: true, data: customer });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}
