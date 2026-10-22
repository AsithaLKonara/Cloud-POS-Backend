import crypto from 'crypto';
import prisma from '../config/prisma';
import { logger } from '../utils/logger';

export class WebhookDispatcherService {
  /**
   * Dispatches an event payload asynchronously to all subscribed tenant endpoints.
   */
  static async dispatchWebhook(tenantId: string, event: string, payload: any): Promise<void> {
    try {
      const endpoints = await (prisma as any).tenantWebhookEndpoint.findMany({
        where: {
          tenantId,
          isActive: true,
        },
      });

      if (!endpoints || endpoints.length === 0) return;

      const matchingEndpoints = endpoints.filter((ep: any) =>
        ep.subscribedEvents.includes('*') || ep.subscribedEvents.includes(event)
      );

      for (const ep of matchingEndpoints) {
        // Fire-and-forget in background without blocking main thread
        this.sendWebhookPayload(ep, event, payload).catch((err) => {
          logger.error(`Webhook delivery failure to [${ep.targetUrl}]: ${err.message}`);
        });
      }
    } catch (err: any) {
      logger.error(`Webhook dispatch lookup error: ${err.message}`);
    }
  }

  private static async sendWebhookPayload(endpoint: any, event: string, payload: any): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000);
    const serializedPayload = JSON.stringify(payload);
    
    // HMAC-SHA256 signature
    const signature = crypto
      .createHmac('sha256', endpoint.secretKey)
      .update(`${timestamp}.${serializedPayload}`)
      .digest('hex');

    const headerSignature = `t=${timestamp},v1=${signature}`;

    let responseCode: number | null = null;
    let responseBody = '';
    let status = 'FAILED';

    try {
      const response = await fetch(endpoint.targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'XONIT-Webhook-Dispatcher/2.0',
          'X-Xonit-Signature': headerSignature,
          'X-Xonit-Event': event,
        },
        body: serializedPayload,
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      responseCode = response.status;
      responseBody = (await response.text()).slice(0, 500); // capped

      if (response.ok) {
        status = 'SUCCESS';
        if (endpoint.failureCount > 0) {
          await (prisma as any).tenantWebhookEndpoint.update({
            where: { id: endpoint.id },
            data: { failureCount: 0 },
          });
        }
      } else {
        await (prisma as any).tenantWebhookEndpoint.update({
          where: { id: endpoint.id },
          data: { failureCount: { increment: 1 } },
        });
      }
    } catch (err: any) {
      responseBody = err.message || 'Network / Timeout error';
      await (prisma as any).tenantWebhookEndpoint.update({
        where: { id: endpoint.id },
        data: { failureCount: { increment: 1 } },
      });
    }

    // Record delivery log
    await (prisma as any).webhookDeliveryLog.create({
      data: {
        endpointId: endpoint.id,
        event,
        payload,
        responseCode,
        responseBody,
        attempt: 1,
        status,
      },
    }).catch(() => {});
  }
}
