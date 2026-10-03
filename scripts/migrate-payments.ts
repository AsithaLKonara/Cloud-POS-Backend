import prisma from '../src/config/prisma';

async function main() {
  console.log('Migrating existing orders to PaymentTransactions...');
  const orders = await prisma.order.findMany({
    include: { payments: true }
  });

  let created = 0;
  for (const order of orders) {
    if (order.payments.length === 0) {
      let status = 'Pending';
      if (order.paymentStatus === 'PAID') status = 'Paid';
      if (order.paymentStatus === 'FAILED') status = 'Failed';

      let method = order.paymentMethod || 'MANUAL';
      
      await prisma.paymentTransaction.create({
        data: {
          orderId: order.id,
          customerId: order.customerId,
          gateway: method,
          method: method,
          amount: order.total,
          status: status,
          createdAt: order.createdAt
        }
      });
      created++;
    }
  }

  console.log(`Successfully migrated ${created} orders.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
