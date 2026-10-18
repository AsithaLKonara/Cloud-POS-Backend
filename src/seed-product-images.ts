import prisma from './config/prisma';
import { logger } from './utils/logger';

const PRODUCT_IMAGE_MAP: Record<string, string> = {
  'ngk-iridium-ilkar7b11': '/products/ngk-iridium-spark-plug.jpg',
  'vic-air-filter-a-1014': '/products/vic-air-filter-a1014.jpg',
  'denso-oil-filter-90915-10003': '/products/denso-oil-filter-90915.jpg',
  'toyota-sllc-pink-4l': '/products/toyota-sllc-pink-coolant.jpg',
  'toyota-cvtf-fe': '/products/toyota-cvtf-fe-fluid.jpg',
  'caltex-delo-400-15w-40': '/products/caltex-delo-400-15w40.jpg',
  'shell-helix-hx7-10w-40': '/products/shell-helix-hx7-10w40.jpg',
  'castrol-edge-5w-30': '/products/castrol-edge-5w30.jpg',
  'mobil-1-0w-20': '/products/mobil-1-0w20.jpg',
};

async function seedProductImages() {
  logger.info('Starting Product Images update for POS terminal...');

  const products = await prisma.product.findMany({
    include: {
      variants: true,
    },
  });

  let updatedCount = 0;

  for (const product of products) {
    const imageUrl = PRODUCT_IMAGE_MAP[product.slug];
    if (imageUrl) {
      for (const variant of product.variants) {
        await prisma.productVariant.update({
          where: { id: variant.id },
          data: {
            featuredImage: imageUrl,
            gallery: [imageUrl],
          },
        });
        updatedCount++;
      }
      logger.info(`✓ Linked image ${imageUrl} to product [${product.name}] (${product.variants.length} variants)`);
    }
  }

  logger.info(`✅ Successfully updated ${updatedCount} product variants with high-definition product images.`);
  process.exit(0);
}

seedProductImages().catch((err) => {
  logger.error('Failed to seed product images:', err);
  process.exit(1);
});
