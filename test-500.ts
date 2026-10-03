import { initiateCheckout } from './src/controllers/checkout.controller';
import prisma from './src/config/prisma';
import { redisClient } from './src/config/redis';

const req = {
  headers: {
    'x-session-id': 'mock-session-123',
    'x-forwarded-for': '127.0.0.1'
  },
  body: {
    cartId: 'mock-session-123',
    customer: {
      phone: '0771234567',
      firstName: 'Test',
      lastName: 'User'
    },
    shippingAddress: {
      firstName: 'Test',
      lastName: 'User',
      addressLine1: '123 Test St',
      city: 'Colombo',
      phone: '0771234567'
    },
    paymentMethod: 'COD',
  }
};

const res = {
  statusCode: 200,
  status: function(code: any) {
    this.statusCode = code;
    return this;
  },
  json: function(data: any) {
    console.log(`Status: ${this.statusCode}`);
    console.log(`JSON Response:`, JSON.stringify(data, null, 2).substring(0, 500));
  }
};

async function run() {
  try {
    const product = await prisma.product.findFirst({ include: { variants: true } });
    if (!product || product.variants.length === 0) {
      console.error("No products found.");
      return;
    }
    const variant = product.variants[0];

    const mockCart = {
      id: 'mock-session-123',
      items: [
        {
          variantId: variant!.id,
          quantity: 1,
          variant: variant
        }
      ]
    };
    
    await redisClient.set('cart:mock-session-123', JSON.stringify(mockCart));
    
    console.log("Calling initiateCheckout...");
    await initiateCheckout(req as any, res as any);
  } catch (error) {
    console.error("Uncaught Test Error:", error);
  } finally {
    await prisma.$disconnect();
    redisClient.disconnect();
  }
}

run();
