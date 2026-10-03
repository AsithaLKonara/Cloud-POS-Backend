import prisma from '../src/config/prisma';

async function main() {
  const deliveredOrders = await prisma.order.findMany({
    where: {
      paymentStatus: 'PAID',
    },
  });

  let backfillCount = 0;

  for (const order of deliveredOrders) {
    const existing = await prisma.paymentTransaction.findFirst({
      where: { orderId: order.id }
    });

    if (!existing) {
      await prisma.paymentTransaction.create({
        data: {
          orderId: order.id,
          customerId: order.customerId,
          gateway: order.paymentMethod || 'MANUAL',
          method: order.paymentMethod || 'MANUAL',
          amount: order.total,
          status: 'Paid'
        }
      });
      backfillCount++;
    }
  }

  console.log(`Backfilled ${backfillCount} missing payment transactions.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
