import prisma from './src/config/prisma';

async function migrate() {
  const addresses = await prisma.address.findMany();
  for (const addr of addresses) {
    if (!addr.nearestCity) {
      await prisma.address.update({
        where: { id: addr.id },
        data: { nearestCity: addr.city } // Simple fallback: use city as nearestCity for existing entries
      });
    }
  }

  const orders = await prisma.order.findMany();
  for (const order of orders) {
    let updateNeeded = false;
    const shipping = order.shippingAddress as any;
    const billing = order.billingAddress as any;

    if (shipping && !shipping.nearestCity) {
      shipping.nearestCity = shipping.city;
      updateNeeded = true;
    }
    if (billing && !billing.nearestCity) {
      billing.nearestCity = billing.city;
      updateNeeded = true;
    }

    if (updateNeeded) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          shippingAddress: shipping,
          billingAddress: billing
        }
      });
    }
  }
  console.log("Migration complete.");
}

migrate().then(() => prisma.$disconnect()).catch(console.error);
