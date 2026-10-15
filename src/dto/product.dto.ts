import { Prisma } from '@prisma/client';

export const variantBasicSelect = {
  id: true,
  productId: true,
  name: true,
  sku: true,
  price: true,
  salePrice: true,
  costPrice: true,
  wholesalePrice: true,
  packUnit: true,
  unitVolumeLiters: true,
  stockStatus: true,
  quantity: true,
  color: true,
  size: true,
  barcode: true,
  featuredImage: true,
  gallery: true,
  inventoryItems: {
    select: {
      id: true,
      branchId: true,
      quantity: true,
      branch: {
        select: {
          code: true
        }
      }
    }
  },
  flashSaleItems: {
    where: {
      flashSale: {
        status: 'ACTIVE'
      }
    },
    select: {
      salePrice: true,
      flashSale: {
        select: {
          name: true,
          discount: true,
          status: true,
          startDate: true,
          endDate: true
        }
      }
    }
  },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductVariantSelect;

export const productBasicSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  excerpt: true,
  status: true,
  productType: true,
  brand: true,
  viscosity: true,
  oilType: true,
  apiStandard: true,
  partNumber: true,
  compatibleVehicles: true,
  allowedPaymentMethods: true,
  sizeGuideEnabled: true,
  sizeGuideContent: true,
  sizeGuideImageUrl: true,
  categoryId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

export const productWithVariantsSelect = {
  ...productBasicSelect,
  variants: {
    select: variantBasicSelect
  },
  category: {
    select: {
      id: true,
      name: true,
      slug: true,
    }
  }
} satisfies Prisma.ProductSelect;
