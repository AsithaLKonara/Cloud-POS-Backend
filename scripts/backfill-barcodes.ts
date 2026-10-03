import prisma from '../src/config/prisma';

function generateBarcode(): string {
  return Math.floor(1000000000 + Math.random() * 9000000000).toString();
}

async function main() {
  console.log('Starting barcode backfill...');

  // 1. Backfill Products
  const productsWithoutBarcode = await prisma.product.findMany({
    where: { OR: [{ barcode: null }, { barcode: '' }] }
  });
  
  console.log(`Found ${productsWithoutBarcode.length} products without barcode.`);
  
  for (const product of productsWithoutBarcode) {
    let barcode = generateBarcode();
    // Ensure uniqueness across products (basic retry if clash, unlikely but safe)
    let exists = await prisma.product.findUnique({ where: { barcode } });
    while (exists) {
      barcode = generateBarcode();
      exists = await prisma.product.findUnique({ where: { barcode } });
    }
    await prisma.product.update({
      where: { id: product.id },
      data: { barcode }
    });
  }
  console.log('Finished updating products.');

  // 2. Backfill Product Variants
  const variantsWithoutBarcode = await prisma.productVariant.findMany({
    where: { OR: [{ barcode: null }, { barcode: '' }] }
  });
  
  console.log(`Found ${variantsWithoutBarcode.length} product variants without barcode.`);
  
  for (const variant of variantsWithoutBarcode) {
    let barcode = generateBarcode();
    // Ensure uniqueness across variants
    let exists = await prisma.productVariant.findUnique({ where: { barcode } });
    while (exists) {
      barcode = generateBarcode();
      exists = await prisma.productVariant.findUnique({ where: { barcode } });
    }
    await prisma.productVariant.update({
      where: { id: variant.id },
      data: { barcode }
    });
  }
  console.log('Finished updating product variants.');

  console.log('Barcode backfill complete!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
