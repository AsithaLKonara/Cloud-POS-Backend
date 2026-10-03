import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  const addresses = await prisma.address.findMany({ select: { city: true } });
  const cities = new Set(addresses.map(a => a.city));
  console.log("Existing Address cities:", Array.from(cities));
}
run().then(() => prisma.$disconnect()).catch(console.error);
