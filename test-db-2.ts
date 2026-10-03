import prisma from './src/config/prisma';
async function main() {
  const customers = await prisma.customer.findMany({
    where: { isGuest: true },
    include: {
      orders: {
        select: { id: true, orderNumber: true, status: true, paymentStatus: true }
      }
    }
  });
  console.log(JSON.stringify(customers, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
