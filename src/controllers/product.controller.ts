import { Request, Response } from 'express';
import { productService } from '../services/product.service';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

const productVariantSchema = z.object({
  size: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  barcode: z.string().optional().nullable(),
  price: z.number(),
  salePrice: z.number().optional().nullable(),
  costPrice: z.number().optional().nullable().default(0),
  wholesalePrice: z.number().optional().nullable(),
  packUnit: z.string().optional().nullable(),
  unitVolumeLiters: z.number().optional().nullable(),
  quantity: z.number(),
  stockStatus: z.string().optional(),
  featuredImage: z.string().optional().nullable(),
  gallery: z.array(z.string()).optional(),
  inventoryItems: z.any().optional()
});

const productSchema = z.object({
  name: z.string().min(1, 'Product name is required'),
  slug: z.string().optional(),
  barcode: z.string().optional().nullable(),
  description: z.string().optional(),
  categoryId: z.string().optional(),
  productType: z.string().optional().default('LUBRICANT'),
  brand: z.string().optional().nullable(),
  viscosity: z.string().optional().nullable(),
  oilType: z.string().optional().nullable(),
  apiStandard: z.string().optional().nullable(),
  partNumber: z.string().optional().nullable(),
  compatibleVehicles: z.string().optional().nullable(),
  collectionId: z.string().optional(),
  sizeGuideEnabled: z.boolean().optional(),
  sizeGuideContent: z.string().optional().nullable(),
  sizeGuideImageUrl: z.string().optional().nullable(),
  allowedPaymentMethods: z.array(z.string()).optional(),
  variants: z.object({
    create: z.array(productVariantSchema).optional(),
    update: z.array(z.any()).optional(),
    delete: z.array(z.any()).optional(),
    deleteMany: z.any().optional()
  }).optional()
});

export class ProductController {
  async getAllProducts(req: Request, res: Response) {
    try {
      const skip = req.query.skip ? parseInt(req.query.skip as string, 10) : undefined;
      const take = req.query.take ? parseInt(req.query.take as string, 10) : undefined;
      const search = req.query.search as string | undefined;
      const category = req.query.category as string | undefined;
      const productType = req.query.productType as string | undefined;
      const brand = req.query.brand as string | undefined;
      const viscosity = req.query.viscosity as string | undefined;
      const oilType = req.query.oilType as string | undefined;
      const color = req.query.color as string | undefined;
      const size = req.query.size as string | undefined;
      const minPrice = req.query.minPrice ? parseFloat(req.query.minPrice as string) : undefined;
      const maxPrice = req.query.maxPrice ? parseFloat(req.query.maxPrice as string) : undefined;
      const status = req.query.status as string | undefined;

      const result = await productService.getAllProducts({
        skip,
        take,
        search,
        category,
        productType,
        brand,
        viscosity,
        oilType,
        color,
        size,
        minPrice,
        maxPrice,
        status
      });
      res.status(200).json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
  }

  async getFilters(req: Request, res: Response) {
    try {
      const filters = await productService.getFilters();
      res.status(200).json(filters);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
  }

  async getProductById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const product = await productService.getProductById(id as string);
      
      if (!product) {
        res.status(404).json({ error: 'Product not found' });
        return;
      }
      
      res.status(200).json(product);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
  }

  async getProductBySlug(req: Request, res: Response) {
    try {
      const { slug } = req.params;
      const product = await productService.getProductBySlug(slug as string);
      
      if (!product) {
        res.status(404).json({ error: 'Product not found' });
        return;
      }
      
      res.status(200).json(product);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
  }

  async getProductBySku(req: Request, res: Response) {
    try {
      const { sku } = req.params;
      const product = await productService.getProductBySku(sku as string);
      
      if (!product) {
        res.status(404).json({ error: 'Product not found' });
        return;
      }
      
      res.status(200).json(product);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
  }



  async createProduct(req: Request, res: Response) {
    try {
      const validatedData = productSchema.parse(req.body);
      const product = await productService.createProduct(validatedData as any);
      res.status(201).json(product);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation Error', details: error.errors });
        return;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = Array.isArray(error.meta?.target) ? error.meta.target.join(', ') : (typeof error.meta?.target === 'string' ? error.meta.target : 'field (SKU, barcode, or slug)');
        res.status(400).json({ error: 'Validation Error', details: [{ message: `The ${target} you provided is already in use. Please use a unique value.` }] });
        return;
      }
      console.error("CREATE PRODUCT ERROR", error); res.status(400).json({ error: error.message || 'Bad Request' });
    }
  }

  async updateProduct(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const validatedData = productSchema.parse(req.body);
      const product = await productService.updateProduct(id as string, validatedData as any);
      res.status(200).json(product);
    } catch (error: any) {
      console.error('[updateProduct] Error:', error?.message, error?.code, error?.stack?.split('\n')[1]);
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation Error', details: error.errors });
        return;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = (error.meta?.target as string[]) || [];
        res.status(400).json({ error: 'Validation Error', details: [{ message: `The ${target.join(', ')} you provided is already in use. Please use a unique value.` }] });
        return;
      }
      console.error("CREATE PRODUCT ERROR", error); res.status(400).json({ error: error.message || 'Bad Request' });
    }
  }

  async deleteProduct(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await productService.deleteProduct(id as string);
      res.status(204).send();
    } catch (error: any) {
      console.error("CREATE PRODUCT ERROR", error); res.status(400).json({ error: error.message || 'Bad Request' });
    }
  }

  async bulkEditProducts(req: Request, res: Response) {
    try {
      const { productIds, data } = req.body;
      if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
        res.status(400).json({ error: 'productIds array is required' });
        return;
      }
      const result = await productService.bulkEditProducts(productIds, data);
      res.status(200).json(result);
    } catch (error: any) {
      console.error("CREATE PRODUCT ERROR", error); res.status(400).json({ error: error.message || 'Bad Request' });
    }
  }
}

export const productController = new ProductController();
