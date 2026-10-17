import prisma from '../config/prisma';

export interface CreateSupplierDTO {
  name: string;
  code?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  taxNumber?: string;
  paymentTerms?: string;
}

export class SupplierService {
  static async getSuppliers(search?: string) {
    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { contactName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }
    return (prisma as any).supplier.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { purchaseOrders: true },
        },
      },
    });
  }

  static async createSupplier(data: CreateSupplierDTO) {
    let code = data.code?.trim().toUpperCase();
    if (!code) {
      const count = await (prisma as any).supplier.count();
      code = `SUP-${String(count + 1).padStart(4, '0')}`;
    }

    return (prisma as any).supplier.create({
      data: {
        name: data.name.trim(),
        code,
        contactName: data.contactName,
        email: data.email,
        phone: data.phone,
        address: data.address,
        taxNumber: data.taxNumber,
        paymentTerms: data.paymentTerms || 'NET_30',
      },
    });
  }

  static async getSupplierById(id: string) {
    return (prisma as any).supplier.findUnique({
      where: { id },
      include: {
        purchaseOrders: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
  }

  static async updateSupplier(id: string, data: Partial<CreateSupplierDTO>) {
    return (prisma as any).supplier.update({
      where: { id },
      data,
    });
  }
}
