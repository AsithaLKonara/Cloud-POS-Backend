import { Request, Response } from 'express';
import prisma from '../../config/prisma';
import { requestContext } from '../../context/RequestContext';

export class HeadlessCatalogController {
  async getProducts(req: Request, res: Response): Promise<void> {
    try {
      const store = requestContext.getStore();
      const tenantId = store?.tenantId;
      if (!tenantId) {
        res.status(401).json({ success: false, message: 'Tenant context missing.' });
        return;
      }

      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
      const search = (req.query.search as string) || '';
      const categorySlug = req.query.category as string;

      const where: any = {
        tenantId,
        status: 'ACTIVE',
      };

      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { barcode: { contains: search, mode: 'insensitive' } },
          { sku: { contains: search, mode: 'insensitive' } },
        ];
      }

      if (categorySlug) {
        where.category = { slug: categorySlug };
      }

      const [products, total] = await Promise.all([
        (prisma as any).product.findMany({
          where,
          select: {
            id: true,
            name: true,
            slug: true,
            barcode: true,
            description: true,
            excerpt: true,
            productType: true,
            trackInventory: true,
            unit: true,
            brand: true,
            viscosity: true,
            oilType: true,
            partNumber: true,
            status: true,
            category: {
              select: { id: true, name: true, slug: true },
            },
            variants: {
              select: {
                id: true,
                name: true,
                sku: true,
                barcode: true,
                price: true,
                salePrice: true,
                stockStatus: true,
                quantity: true,
                featuredImage: true,
                gallery: true,
              },
            },
          },
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        (prisma as any).product.count({ where }),
      ]);

      res.status(200).json({
        success: true,
        data: products,
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  async getProduct(req: Request, res: Response): Promise<void> {
    try {
      const store = requestContext.getStore();
      const tenantId = store?.tenantId;
      const { slugOrId } = req.params;

      const product = await (prisma as any).product.findFirst({
        where: {
          tenantId,
          status: 'ACTIVE',
          OR: [{ id: slugOrId }, { slug: slugOrId }],
        },
        select: {
          id: true,
          name: true,
          slug: true,
          barcode: true,
          description: true,
          excerpt: true,
          productType: true,
          trackInventory: true,
          unit: true,
          brand: true,
          viscosity: true,
          oilType: true,
          partNumber: true,
          status: true,
          category: {
            select: { id: true, name: true, slug: true },
          },
          variants: {
            select: {
              id: true,
              name: true,
              sku: true,
              barcode: true,
              price: true,
              salePrice: true,
              stockStatus: true,
              quantity: true,
              featuredImage: true,
              gallery: true,
            },
          },
        },
      });

      if (!product) {
        res.status(404).json({ success: false, message: 'Product not found.' });
        return;
      }

      res.status(200).json({ success: true, data: product });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  async getCategories(req: Request, res: Response): Promise<void> {
    try {
      const store = requestContext.getStore();
      const tenantId = store?.tenantId;

      const categories = await (prisma as any).category.findMany({
        where: { tenantId },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          imageUrl: true,
          _count: {
            select: { products: true },
          },
        },
        orderBy: { name: 'asc' },
      });

      res.status(200).json({ success: true, data: categories });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
}
