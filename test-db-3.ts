import prisma from './src/config/prisma';
async function main() {
  const transactions = await prisma.loyaltyTransaction.findMany({
    include: {
      order: { select: { subtotal: true, total: true, shippingFee: true, status: true, orderNumber: true } }
    }
  });
  console.log('Transactions:', JSON.stringify(transactions, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
