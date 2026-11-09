import { Request, Response } from 'express';
import { WhatsAppWebhookService } from '../services/whatsapp-webhook.service';
import { logger } from '../utils/logger';

export class WhatsAppWebhookController {
  /**
   * Handles Meta webhook verification challenge (GET).
   */
  async verifyWebhook(req: Request, res: Response): Promise<void> {
    const mode = (req.query['hub.mode'] as string) || '';
    const token = (req.query['hub.verify_token'] as string) || '';
    const challenge = (req.query['hub.challenge'] as string) || '';

    const result = WhatsAppWebhookService.verifyWebhook(mode, token, challenge);
    res.status(result.status).send(result.body);
  }

  /**
   * Handles inbound events and messages from Meta (POST).
   */
  async handleIncoming(req: Request, res: Response): Promise<void> {
    // Acknowledge receipt to Meta immediately within SLA (< 3 seconds)
    res.status(200).json({ status: 'success' });

    try {
      await WhatsAppWebhookService.processInboundPayload(req.body);
    } catch (err: any) {
      logger.error(`[WhatsApp Controller Error] Webhook processing failed: ${err.message}`, err);
    }
  }
}

