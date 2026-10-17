import prisma from '../config/prisma';
import { Prisma } from '@prisma/client';
import { productWithVariantsSelect } from '../dto/product.dto';
import { withCache, invalidateCache } from '../utils/cache.util';
import { inventoryService } from './inventory.service';

export async function signImageUrl(url: string | null): Promise<string | null> {
  // S3 has been removed; media is served locally or statically.
  // Return the original URL directly.
  return url;
}

async function processProductImageUrls(product: any) {
  if (!product.variants) return product;
  
  for (const variant of product.variants) {
    variant.featuredImage = await signImageUrl(variant.featuredImage);
    if (variant.gallery && variant.gallery.length > 0) {
      variant.gallery = await Promise.all(variant.gallery.map((url: string) => signImageUrl(url)));
    }
  }
  return product;
}

export class ProductService {
  async getAllProducts(params: {
    skip?: number;
    take?: number;
    search?: string;
    category?: string;
    productType?: string;
    brand?: string;
    viscosity?: string;
    oilType?: string;
    color?: string;
    size?: string;
    minPrice?: number;
    maxPrice?: number;
    status?: string;
  }) {
    const { skip = 0, take = 50, search, category, productType, brand, viscosity, oilType, color, size, minPrice, maxPrice, status } = params;
    const cacheKey = `products:all:skip:${skip}:take:${take}:search:${search || 'none'}:category:${category || 'none'}:type:${productType || 'none'}:brand:${brand || 'none'}:visc:${viscosity || 'none'}:oilType:${oilType || 'none'}:color:${color || 'none'}:size:${size || 'none'}:minP:${minPrice || 'none'}:maxP:${maxPrice || 'none'}:status:${status || 'none'}`;

    return withCache(cacheKey, 900, async () => {
      const where: Prisma.ProductWhereInput = {
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
                { brand: { contains: search, mode: 'insensitive' } },
                { partNumber: { contains: search, mode: 'insensitive' } },
                { viscosity: { contains: search, mode: 'insensitive' } },
                { compatibleVehicles: { contains: search, mode: 'insensitive' } },
                { variants: { some: { sku: { contains: search, mode: 'insensitive' } } } },
                { variants: { some: { barcode: { contains: search, mode: 'insensitive' } } } },
              ],
            }
          : {}),
        ...(productType ? { productType: { equals: productType, mode: 'insensitive' } } : {}),
        ...(brand ? { brand: { equals: brand, mode: 'insensitive' } } : {}),
        ...(viscosity ? { viscosity: { equals: viscosity, mode: 'insensitive' } } : {}),
        ...(oilType ? { oilType: { equals: oilType, mode: 'insensitive' } } : {}),
        ...(category
          ? {
              category: { slug: category }
            }
          : {}),
        ...((color || size || minPrice !== undefined || maxPrice !== undefined)
          ? {
              variants: {
                some: {
                  ...(color ? { color: { equals: color, mode: 'insensitive' } } : {}),
                  ...(size ? { size: { equals: size, mode: 'insensitive' } } : {}),
                  ...(minPrice !== undefined ? { price: { gte: minPrice } } : {}),
                  ...(maxPrice !== undefined ? { price: { lte: maxPrice } } : {}),
                }
              }
            }
          : {}),
        // If no status is specified, exclude ARCHIVED by default
        ...(status && status !== 'ALL' 
          ? { status: { equals: status, mode: 'insensitive' } } 
          : (!status ? { status: { not: 'ARCHIVED' } } : {})),
      };

      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          skip,
          take,
          select: productWithVariantsSelect,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.product.count({ where }),
      ]);

      const processedProducts = await Promise.all(products.map((p: any) => processProductImageUrls(p)));

      return {
        data: processedProducts,
        meta: {
          total,
          skip,
          take,
        },
      };
    });
  }

  async getProductById(id: string) {
    return withCache(`product:id:${id}`, 900, async () => {
      const product = await prisma.product.findUnique({
        where: { id },
        select: productWithVariantsSelect,
      });
      return product ? processProductImageUrls(product) : null;
    });
  }

  async getProductBySlug(slug: string) {
    return withCache(`product:slug:${slug}`, 900, async () => {
      const product = await prisma.product.findFirst({
        where: { slug },
        select: productWithVariantsSelect,
      });
      return product ? processProductImageUrls(product) : null;
    });
  }

  async getProductBySku(sku: string) {
    return withCache(`product:sku:${sku.toLowerCase()}`, 900, async () => {
      const searchSku = sku.trim();
      const lowerSku = searchSku.toLowerCase();
      
      const variant = await prisma.productVariant.findFirst({
        where: { 
          OR: [
            { sku: { equals: searchSku, mode: 'insensitive' } }, 
            { barcode: { equals: searchSku, mode: 'insensitive' } },
            { sku: { startsWith: searchSku, mode: 'insensitive' } },
            { barcode: { startsWith: searchSku, mode: 'insensitive' } },
            { id: { startsWith: lowerSku } },
            { productId: { startsWith: lowerSku } }
          ] 
        },
        select: { product: { select: productWithVariantsSelect } },
      });
      return variant && variant.product ? processProductImageUrls(variant.product) : null;
    });
  }

  async createProduct(data: any) {
    if (!data.slug) {
      let baseSlug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      let slug = baseSlug;
      let counter = 1;
      while (await prisma.product.findFirst({ where: { slug } })) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }
      data.slug = slug;
    }

    const generateUniqueBarcode = async (): Promise<string> => {
      for (let i = 0; i < 10; i++) {
        const code = `20${Math.floor(10000000000 + Math.random() * 89999999999)}`;
        const existing = await prisma.productVariant.findFirst({ where: { barcode: code } });
        if (!existing) return code;
      }
      return `20${Date.now().toString().slice(-10)}`;
    };

    // collectionId is on the CollectionProduct join table, not a direct Product scalar
    const { collectionId, ...productData } = data;
    
    const variantsData = productData.variants?.create || [];
    
    // Auto-generate missing barcodes for new variants
    for (const v of variantsData) {
      if (!v.barcode || typeof v.barcode !== 'string' || v.barcode.trim() === '') {
        v.barcode = await generateUniqueBarcode();
      }
    }

    // Extract inventory intent keyed by variant SKU+size+color for reliable post-create matching
    const pendingInventory: { key: string; items: any[] }[] = [];

    variantsData.forEach((v: any) => {
      if (v.inventoryItems?.create && v.inventoryItems.create.length > 0) {
        const key = `${v.sku || ''}|${v.size || ''}|${v.color || ''}`;
        pendingInventory.push({ key, items: v.inventoryItems.create });
      }
      delete v.inventoryItems;
    });

    const result = await prisma.product.create({
      data: productData,
      include: { variants: true }
    });

    for (const pending of pendingInventory) {
      // Match by SKU first, then fall back to size+color
      const [sku, size, color] = pending.key.split('|');
      const variant = result.variants.find(v =>
        (sku && v.sku === sku) ||
        ((v.size || '') === size && (v.color || '') === color)
      );
      if (variant) {
        for (const inv of pending.items) {
          if (inv.quantity >= 0) {
            await inventoryService.adjustStock({
              variantId: variant.id,
              branchId: inv.branchId,
              type: 'RECEIVE',
              quantity: inv.quantity,
              reason: 'Initial Stock Upload'
            });
          }
        }
      }
    }

    await invalidateCache('product*');
    
    // Return the fully updated product with fresh inventory state
    return prisma.product.findUnique({
      where: { id: result.id },
      include: { variants: true }
    });
  }

  async updateProduct(id: string, data: any) {
    const pendingCreateInventory: { key: string; items: any[] }[] = [];
    const pendingUpdateInventory: any[] = [];
    const pendingDeleteInventory: any[] = [];

    // collectionId is on the CollectionProduct join table, not a direct Product scalar - strip it
    const { collectionId, ...productData } = data;

    if (productData.variants?.create) {
      for (const v of productData.variants.create) {
        if (!v.barcode || typeof v.barcode !== 'string' || v.barcode.trim() === '') {
          v.barcode = `20${Math.floor(10000000000 + Math.random() * 89999999999)}`;
        }
        if (v.inventoryItems?.create && v.inventoryItems.create.length > 0) {
          const key = `${v.sku || ''}|${v.size || ''}|${v.color || ''}`;
          pendingCreateInventory.push({ key, items: v.inventoryItems.create });
        }
        delete v.inventoryItems;
      }
    }

    if (productData.variants?.update) {
      productData.variants.update.forEach((v: any) => {
        const variantId = v.where?.id;
        
        // Auto-generate barcode if it's missing during update
        if (v.data && (!v.data.barcode || typeof v.data.barcode !== 'string' || v.data.barcode.trim() === '')) {
          v.data.barcode = `20${Math.floor(10000000000 + Math.random() * 89999999999)}`;
        }

        if (variantId && v.data?.inventoryItems) {
           if (v.data.inventoryItems.create) {
             pendingUpdateInventory.push({ variantId, creates: v.data.inventoryItems.create });
           }
           if (v.data.inventoryItems.update) {
             pendingUpdateInventory.push({ variantId, updates: v.data.inventoryItems.update });
           }
           if (v.data.inventoryItems.deleteMany) {
             pendingDeleteInventory.push({ variantId });
           }
           delete v.data.inventoryItems;
        }
      });
    }

    const result = await prisma.product.update({
      where: { id },
      data: productData,
      include: { variants: true }
    });

    // Process new variant inventory - match by SKU/size+color
    for (const pending of pendingCreateInventory) {
      const [sku, size, color] = pending.key.split('|');
      const variant = result.variants.find(v =>
        (sku && v.sku === sku) ||
        ((v.size || '') === size && (v.color || '') === color)
      );
      if (variant) {
        for (const inv of pending.items) {
          if (inv.quantity >= 0) {
            await inventoryService.adjustStock({
              variantId: variant.id,
              branchId: inv.branchId,
              type: 'RECEIVE',
              quantity: inv.quantity,
              reason: 'New Variant Added'
            });
          }
        }
      }
    }

    // Process updates
    for (const pending of pendingUpdateInventory) {
      if (pending.creates) {
        for (const inv of pending.creates) {
          if (inv.quantity >= 0) {
            await inventoryService.adjustStock({
              variantId: pending.variantId,
              branchId: inv.branchId,
              type: 'RECEIVE',
              quantity: inv.quantity,
              reason: 'Branch Stock Added'
            });
          }
        }
      }
      if (pending.updates) {
        for (const update of pending.updates) {
          // Frontend sends absolute quantity to update to. We need the delta.
          const existingItem = await prisma.inventoryItem.findUnique({ where: { id: update.where.id } });
          if (existingItem) {
            const newQty = update.data.quantity;
            const delta = newQty - existingItem.quantity;
            if (delta !== 0) {
              await inventoryService.adjustStock({
                variantId: pending.variantId,
                branchId: existingItem.branchId,
                type: delta > 0 ? 'RECEIVE' : 'DEDUCT',
                quantity: Math.abs(delta),
                reason: 'Admin Override'
              });
            }
          }
        }
      }
    }

    // Process soft-deletions
    for (const pending of pendingDeleteInventory) {
      const currentItems = await prisma.inventoryItem.findMany({ where: { variantId: pending.variantId } });
      for (const item of currentItems) {
        if (item.quantity > 0) {
          await inventoryService.adjustStock({
            variantId: pending.variantId,
            branchId: item.branchId,
            type: 'DEDUCT',
            quantity: item.quantity,
            reason: 'Variant Soft-Deleted'
          });
        }
      }
    }

    await invalidateCache('product*');
    
    // Return the fully updated product with fresh inventory state
    return prisma.product.findUnique({
      where: { id: result.id },
      include: { variants: true }
    });
  }

  async deleteProduct(id: string) {
    const result = await prisma.product.update({
      where: { id },
      data: { status: 'ARCHIVED' }
    });
    await invalidateCache('product*');
    return result;
  }

  async bulkEditProducts(productIds: string[], data: any) {
    const result = await prisma.product.updateMany({
      where: { id: { in: productIds } },
      data,
    });
    await invalidateCache('product*');
    return result;
  }

  async getFilters() {
    return withCache('product_filters', 3600, async () => {
      const colors = await prisma.productVariant.findMany({
        where: { color: { not: null } },
        select: { color: true },
        distinct: ['color'],
      });

      const sizes = await prisma.productVariant.findMany({
        where: { size: { not: null } },
        select: { size: true },
        distinct: ['size'],
      });

      return {
        colors: colors.map((c) => c.color).filter(Boolean) as string[],
        sizes: sizes.map((s) => s.size).filter(Boolean) as string[],
      };
    });
  }
}

export const productService = new ProductService();
