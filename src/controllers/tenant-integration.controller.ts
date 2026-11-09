import { Request, Response } from 'express';
import { TenantIntegrationService } from '../services/tenant-integration.service';
import { WhatsAppService } from '../services/whatsapp.service';

export class TenantIntegrationController {
  async getIntegrations(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.params.tenantId as string;
      const unmasked = req.query.unmasked === 'true';
      const integrations = await TenantIntegrationService.getTenantIntegrations(tenantId, !unmasked);
      res.status(200).json({ success: true, data: integrations });
    } catch (err: any) {
      res.status(404).json({ success: false, message: err.message || 'Failed to fetch integrations' });
    }
  }

  async updatePaymentGateway(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.params.tenantId as string;
      const gateway = req.params.gateway as any;
      const updated = await TenantIntegrationService.updatePaymentGateway(
        tenantId,
        gateway,
        req.body
      );
      res.status(200).json({
        success: true,
        message: `Payment gateway ${gateway} configuration saved`,
        data: updated,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to update gateway' });
    }
  }

  async updateCourier(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.params.tenantId as string;
      const courier = req.params.courier as any;
      const updated = await TenantIntegrationService.updateCourier(
        tenantId,
        courier,
        req.body
      );
      res.status(200).json({
        success: true,
        message: `Courier ${courier} configuration saved`,
        data: updated,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to update courier' });
    }
  }

  async updateMessaging(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.params.tenantId as string;
      const provider = req.params.provider as any;
      const updated = await TenantIntegrationService.updateMessaging(
        tenantId,
        provider,
        req.body
      );
      res.status(200).json({
        success: true,
        message: `Messaging provider ${provider} configuration saved in encrypted vault`,
        data: updated,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to update messaging provider' });
    }
  }

  async testConnection(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.params.tenantId as string;
      const { type, provider } = req.body;
      const result = await TenantIntegrationService.testConnection(tenantId, type, provider);
      res.status(200).json({ success: true, data: result });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Connection test failed' });
    }
  }

  async sendTestWhatsAppMessage(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.params.tenantId as string;
      const { phone } = req.body;
      if (!phone) {
        res.status(400).json({ success: false, message: 'Recipient phone number is required.' });
        return;
      }
      const result = await WhatsAppService.sendTestMessage(tenantId, phone);
      res.status(200).json({
        success: true,
        message: 'Test WhatsApp message dispatched successfully',
        data: result,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message || 'Failed to send test message' });
    }
  }
}
