import prisma from './src/config/prisma';
async function main() {
  const orders = await prisma.order.findMany({ select: { id: true, status: true, customerId: true, paymentStatus: true }});
  const loyaltyAccounts = await prisma.loyaltyAccount.findMany();
  const loyaltyTransactions = await prisma.loyaltyTransaction.findMany();
  console.log('Orders:', orders);
  console.log('Loyalty Accounts:', loyaltyAccounts);
  console.log('Loyalty Transactions:', loyaltyTransactions);
}
main().catch(console.error).finally(() => prisma.$disconnect());
