import crypto from 'crypto';
import prisma from '../../config/prisma';

export interface OnePayCheckoutPayload {
  orderId: string;
  orderNumber: string;
  amount: number;
  currency?: string;
  customer?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
  };
}

export const onepayService = {
  get config() {
    return {
      appId: process.env.ONEPAY_APP_ID || '',
      appToken: process.env.ONEPAY_APP_TOKEN || '',
      hashSalt: process.env.ONEPAY_HASH_SALT || '',
      apiUrl: process.env.ONEPAY_API_URL || 'https://merchantapi.onepay.lk/v1/checkout/request/',
      storefrontUrl: process.env.STOREFRONT_URL || process.env.FRONTEND_URL || 'http://localhost:3000',
    };
  },

  /**
   * Generates a SHA-256 hash required by OnePay to secure transaction requests
   */
  generateHash(appId: string, reference: string, amount: string | number, currency: string, hashSalt: string): string {
    const rawString = `${appId}${reference}${amount}${currency}${hashSalt}`;
    return crypto.createHash('sha256').update(rawString).digest('hex');
  },

  /**
   * Creates a OnePay payment session and returns the gateway redirect URL
   */
  async createPaymentSession(order: any, customerDetails?: any) {
    const { appId, appToken, hashSalt, apiUrl, storefrontUrl } = this.config;
    const amount = Number(order.total).toFixed(2);
    const currency = 'LKR';
    const reference = order.orderNumber;
    const redirectUrl = `${storefrontUrl}/checkout/success?orderNumber=${order.orderNumber}&gateway=onepay`;

    // If OnePay credentials are not configured, provide a mock/sandbox flow for development
    if (!appId || !appToken || !hashSalt) {
      console.warn('[OnePay] Live credentials not set (ONEPAY_APP_ID / ONEPAY_APP_TOKEN / ONEPAY_HASH_SALT). Using sandbox simulation.');
      return {
        success: true,
        method: 'ONEPAY',
        redirectUrl: `${storefrontUrl}/checkout/success?orderNumber=${order.orderNumber}&gateway=onepay&simulated=true`,
        orderNumber: order.orderNumber,
        message: 'Redirecting to OnePay gateway (simulation mode)',
      };
    }

    const hash = this.generateHash(appId, reference, amount, currency, hashSalt);

    const shippingAddr = (order.shippingAddress as any) || {};
    const firstName = customerDetails?.firstName || shippingAddr.firstName || 'Customer';
    const lastName = customerDetails?.lastName || shippingAddr.lastName || 'Valued';
    const email = customerDetails?.email || 'customer@seramaaduwen.lk';
    let rawPhone = customerDetails?.phone || shippingAddr.phone || '0770000000';
    // Clean phone number: remove non-digits (or keep leading + if present)
    const phone = rawPhone.replace(/[^\d+]/g, '');

    const requestBody = {
      amount,
      app_id: appId,
      reference,
      customer_first_name: firstName,
      customer_last_name: lastName,
      customer_phone_number: phone,
      customer_email: email,
      transaction_redirect_url: redirectUrl,
      currency,
      hash,
    };

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': appToken,
        },
        body: JSON.stringify(requestBody),
      });

      const responseData: any = await response.json();

      if (!response.ok || (responseData.status && responseData.status !== 1000 && responseData.status !== 200 && responseData.status !== 'SUCCESS')) {
        throw new Error(responseData.message || `OnePay request failed with status: ${response.status}`);
      }

      // OnePay returns redirect url in data.gateway.redirect_url or data.redirect_url / data.ipg_url
      const paymentRedirectUrl =
        responseData.data?.gateway?.redirect_url ||
        responseData.data?.redirect_url ||
        responseData.data?.ipg_url ||
        responseData.data?.payment_url ||
        responseData.redirect_url;

      if (!paymentRedirectUrl) {
        throw new Error('OnePay did not return a valid payment redirect URL');
      }

      return {
        success: true,
        method: 'ONEPAY',
        redirectUrl: paymentRedirectUrl,
        orderNumber: order.orderNumber,
        message: 'Redirecting to OnePay payment gateway',
      };
    } catch (error: any) {
      console.error('[OnePay] Failed to initiate payment:', error.message);
      throw new Error(`Failed to initiate OnePay transaction: ${error.message}`);
    }
  },

  /**
   * Processes and verifies an IPN webhook callback received from OnePay
   */
  async processWebhook(payload: any) {
    const { appId, hashSalt } = this.config;
    
    // OnePay sends reference/order_id, status, amount, transaction_id, hash
    const orderNumber = payload.reference || payload.order_id || payload.orderNumber;
    const status = (payload.status || payload.transaction_status || '').toUpperCase();
    const amount = payload.amount;
    const transactionId = payload.transaction_id || payload.payment_id;

    if (!orderNumber) {
      throw new Error('Invalid OnePay webhook: missing order reference');
    }

    const order = await prisma.order.findFirst({
      where: { orderNumber },
    });

    if (!order) {
      throw new Error(`Order ${orderNumber} not found for OnePay callback`);
    }

    // Verify hash if salt is configured and hash is provided
    if (hashSalt && payload.hash && amount) {
      const computedHash = this.generateHash(appId, orderNumber, amount, 'LKR', hashSalt);
      if (computedHash.toLowerCase() !== payload.hash.toLowerCase()) {
        console.warn(`[OnePay Webhook] Hash mismatch for order ${orderNumber}`);
      }
    }

    const isSuccess =
      status === 'SUCCESS' ||
      status === 'COMPLETED' ||
      status === 'PAID' ||
      status === '1000' ||
      payload.status_code === 200 ||
      payload.status_code === 1000;

    if (isSuccess) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: 'PAID',
          status: 'PROCESSING',
        },
      });

      console.log(`[OnePay Webhook] Order ${orderNumber} marked as PAID.`);
      return { success: true, orderNumber, paymentStatus: 'PAID' };
    } else {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: 'FAILED',
        },
      });

      console.log(`[OnePay Webhook] Order ${orderNumber} marked as FAILED.`);
      return { success: true, orderNumber, paymentStatus: 'FAILED' };
    }
  },
};
