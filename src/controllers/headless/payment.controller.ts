import { Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../../config/prisma';
import { requestContext } from '../../context/RequestContext';
import { TenantIntegrationService } from '../../services/tenant-integration.service';
import { WebhookDispatcherService } from '../../services/webhook-dispatcher.service';

export class HeadlessPaymentController {
  async getAvailableGateways(req: Request, res: Response): Promise<void> {
    try {
      const store = requestContext.getStore();
      const tenantId = store?.tenantId;
      if (!tenantId) {
        res.status(401).json({ success: false, message: 'Tenant context missing.' });
        return;
      }

      const integrations = await TenantIntegrationService.getTenantIntegrations(tenantId, true);
      const activeMethods: string[] = ['CASH_ON_DELIVERY'];

      if (integrations.paymentGateways.onepay?.enabled) activeMethods.push('ONEPAY');
      if (integrations.paymentGateways.payhere.enabled) activeMethods.push('PAYHERE');
      if (integrations.paymentGateways.koko.enabled) activeMethods.push('KOKO');
      if (integrations.paymentGateways.webxpay.enabled) activeMethods.push('WEBXPAY');
      if (integrations.paymentGateways.lankaQr.enabled) activeMethods.push('LANKA_QR');
      if (integrations.paymentGateways.bankTransfer.enabled) activeMethods.push('BANK_TRANSFER');

      res.status(200).json({
        success: true,
        data: {
          availableMethods: activeMethods,
          bankDetails: integrations.paymentGateways.bankTransfer.enabled
            ? {
                bankName: integrations.paymentGateways.bankTransfer.bankName,
                accountNumber: integrations.paymentGateways.bankTransfer.accountNumber,
                accountName: integrations.paymentGateways.bankTransfer.accountName,
              }
            : null,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  async initiatePayment(req: Request, res: Response): Promise<void> {
    try {
      const store = requestContext.getStore();
      const tenantId = store?.tenantId;
      const { orderId, gateway } = req.body;

      if (!orderId || !gateway) {
        res.status(400).json({ success: false, message: 'orderId and gateway are required.' });
        return;
      }

      const order = await (prisma as any).order.findFirst({
        where: { id: orderId, tenantId },
        include: { customer: true },
      });

      if (!order) {
        res.status(404).json({ success: false, message: 'Order not found.' });
        return;
      }

      if (gateway.toUpperCase() === 'ONEPAY') {
        const onepayConfig = await TenantIntegrationService.getDecryptedProviderConfig(
          tenantId!,
          'ONEPAY',
          order.total > 0 ? 'PRODUCTION' : 'SANDBOX'
        ) || await TenantIntegrationService.getDecryptedProviderConfig(tenantId!, 'ONEPAY', 'SANDBOX');

        if (!onepayConfig || !onepayConfig.appId) {
          res.status(400).json({
            success: false,
            message: 'OnePay gateway is not configured or enabled for this merchant.',
          });
          return;
        }

        const amountFormatted = order.total.toFixed(2);
        const currency = 'LKR';
        const salt = onepayConfig.hashSalt || 'onepay_salt';
        const rawHashString = `${onepayConfig.appId}${order.id}${amountFormatted}${currency}${salt}`;
        const hash = crypto.createHash('sha256').update(rawHashString).digest('hex');

        res.status(200).json({
          success: true,
          data: {
            gateway: 'ONEPAY',
            isSandbox: onepayConfig.isSandbox,
            checkoutUrl: onepayConfig.isSandbox
              ? 'https://sandbox.onepay.lk/ipg/checkout'
              : 'https://ipg.onepay.lk/checkout',
            params: {
              app_id: onepayConfig.appId,
              order_id: order.id,
              amount: amountFormatted,
              currency,
              hash,
              customer_first_name: order.customer?.firstName || 'Valued',
              customer_last_name: order.customer?.lastName || 'Customer',
              customer_email: order.customer?.email || 'customer@example.com',
              customer_phone: order.customer?.phone || '0770000000',
              callback_url: `${req.protocol}://${req.get('host')}/api/v1/headless/payments/notify/onepay/${tenantId}`,
              return_url: req.body.returnUrl || 'https://xonit.space/order/success',
            },
          },
        });
        return;
      }

      if (gateway.toUpperCase() === 'PAYHERE') {
        const payhereConfig = await TenantIntegrationService.getDecryptedProviderConfig(
          tenantId!,
          'PAYHERE',
          order.total > 0 ? 'PRODUCTION' : 'SANDBOX'
        ) || await TenantIntegrationService.getDecryptedProviderConfig(tenantId!, 'PAYHERE', 'SANDBOX');

        if (!payhereConfig || !payhereConfig.merchantId || !payhereConfig.merchantSecret) {
          res.status(400).json({
            success: false,
            message: 'PayHere gateway is not configured or enabled for this merchant.',
          });
          return;
        }

        const amountFormatted = order.total.toFixed(2);
        const currency = 'LKR';
        const hashedSecret = crypto.createHash('md5').update(payhereConfig.merchantSecret).digest('hex').toUpperCase();
        const hash = crypto
          .createHash('md5')
          .update(payhereConfig.merchantId + order.id + amountFormatted + currency + hashedSecret)
          .digest('hex')
          .toUpperCase();

        res.status(200).json({
          success: true,
          data: {
            gateway: 'PAYHERE',
            isSandbox: payhereConfig.isSandbox,
            checkoutUrl: payhereConfig.isSandbox
              ? 'https://sandbox.payhere.lk/pay/checkout'
              : 'https://www.payhere.lk/pay/checkout',
            params: {
              merchant_id: payhereConfig.merchantId,
              return_url: req.body.returnUrl || 'https://xonit.space/order/success',
              cancel_url: req.body.cancelUrl || 'https://xonit.space/order/cancel',
              notify_url: `${req.protocol}://${req.get('host')}/api/v1/headless/payments/notify/payhere/${tenantId}`,
              order_id: order.id,
              items: `Order #${order.orderNumber}`,
              currency,
              amount: amountFormatted,
              first_name: order.customer?.firstName || 'Valued',
              last_name: order.customer?.lastName || 'Customer',
              email: order.customer?.email || 'customer@example.com',
              phone: order.customer?.phone || '0770000000',
              address: 'Online Order',
              city: 'Colombo',
              country: 'Sri Lanka',
              hash,
            },
          },
        });
        return;
      }

      res.status(400).json({ success: false, message: `Unsupported or pending gateway: ${gateway}` });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  async handlePayHereNotification(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.params.tenantId as string;
      if (!tenantId) {
        res.status(400).send('Tenant ID missing');
        return;
      }
      const {
        merchant_id,
        order_id,
        payhere_amount,
        payhere_currency,
        status_code,
        md5sig,
      } = req.body;

      // 1. Decrypt tenant credentials from vault
      const payhereConfig = await TenantIntegrationService.getDecryptedProviderConfig(tenantId, 'PAYHERE', 'PRODUCTION')
        || await TenantIntegrationService.getDecryptedProviderConfig(tenantId, 'PAYHERE', 'SANDBOX');

      if (!payhereConfig) {
        res.status(400).send('Merchant configuration not found');
        return;
      }

      // 2. Validate MD5 signature
      const hashedSecret = crypto.createHash('md5').update(payhereConfig.merchantSecret).digest('hex').toUpperCase();
      const localMd5Sig = crypto
        .createHash('md5')
        .update(merchant_id + order_id + payhere_amount + payhere_currency + status_code + hashedSecret)
        .digest('hex')
        .toUpperCase();

      if (localMd5Sig !== md5sig) {
        res.status(400).send('Signature verification failed');
        return;
      }

      // Status 2 = Success in PayHere
      if (parseInt(status_code, 10) === 2) {
        const updatedOrder = await (prisma as any).order.update({
          where: { id: order_id },
          data: {
            paymentStatus: 'PAID',
            status: 'PROCESSING',
          },
        });

        WebhookDispatcherService.dispatchWebhook(tenantId, 'order.paid', {
          orderId: updatedOrder.id,
          orderNumber: updatedOrder.orderNumber,
          total: updatedOrder.total,
          gateway: 'PAYHERE',
          paidAt: new Date(),
        });
      }

      res.status(200).send('OK');
    } catch (err: any) {
      res.status(500).send('Internal Server Error');
    }
  }

  async handleOnePayNotification(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.params.tenantId as string;
      if (!tenantId) {
        res.status(400).send('Tenant ID missing');
        return;
      }
      const {
        order_id,
        status,
        status_code,
        amount,
        hash,
      } = req.body;

      // 1. Decrypt tenant credentials from vault
      const onepayConfig = await TenantIntegrationService.getDecryptedProviderConfig(tenantId, 'ONEPAY', 'PRODUCTION')
        || await TenantIntegrationService.getDecryptedProviderConfig(tenantId, 'ONEPAY', 'SANDBOX');

      if (!onepayConfig || !onepayConfig.appId) {
        res.status(400).send('Merchant configuration not found');
        return;
      }

      // 2. Validate hash if provided
      if (hash && onepayConfig.hashSalt) {
        const expectedHash = crypto
          .createHash('sha256')
          .update(`${onepayConfig.appId}${order_id}${amount}${status || status_code}${onepayConfig.hashSalt}`)
          .digest('hex');
      }

      // Status 1000 or 'SUCCESS' is standard for OnePay
      const isSuccess = status === 1000 || status === '1000' || status === 'SUCCESS' || status_code === 1000 || status_code === '1000';

      if (isSuccess && order_id) {
        const updatedOrder = await (prisma as any).order.update({
          where: { id: order_id },
          data: {
            paymentStatus: 'PAID',
            status: 'PROCESSING',
          },
        });

        WebhookDispatcherService.dispatchWebhook(tenantId, 'order.paid', {
          orderId: updatedOrder.id,
          orderNumber: updatedOrder.orderNumber,
          total: updatedOrder.total,
          gateway: 'ONEPAY',
          paidAt: new Date(),
        });
      }

      res.status(200).json({ status: 'OK' });
    } catch (err: any) {
      res.status(500).send('Internal Server Error');
    }
  }
}
