import prisma from '../config/prisma';
import { logger } from '../utils/logger';

export interface CreateTableDTO {
  name: string;
  zone?: string;
  capacity?: number;
  branchId: string;
}

export class TableService {
  static async getTables(branchId?: string) {
    const where: any = {};
    if (branchId) {
      where.branchId = branchId;
    }

    return (prisma as any).diningTable.findMany({
      where,
      orderBy: [{ zone: 'asc' }, { name: 'asc' }],
      include: {
        orders: {
          where: {
            status: { in: ['PENDING', 'PROCESSING', 'DELIVERED'] },
            paymentStatus: { in: ['UNPAID', 'PARTIALLY_PAID'] },
          },
          select: {
            id: true,
            orderNumber: true,
            total: true,
            status: true,
            paymentStatus: true,
            createdAt: true,
          },
        },
      },
    });
  }

  static async createTable(data: CreateTableDTO) {
    return (prisma as any).diningTable.create({
      data: {
        name: data.name.trim(),
        zone: data.zone || 'MAIN',
        capacity: data.capacity || 4,
        branchId: data.branchId,
        status: 'AVAILABLE',
      },
    });
  }

  static async updateTableStatus(tableId: string, status: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'BILL_REQUESTED' | 'CLEANING') {
    return (prisma as any).diningTable.update({
      where: { id: tableId },
      data: { status },
    });
  }

  static async deleteTable(tableId: string) {
    return (prisma as any).diningTable.delete({
      where: { id: tableId },
    });
  }
}
