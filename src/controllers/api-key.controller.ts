import { Request, Response } from 'express';
import { ApiKeyService } from '../services/api-key.service';
import { requestContext } from '../context/RequestContext';

export class ApiKeyController {
  async listKeys(req: Request, res: Response): Promise<void> {
    try {
      const store = requestContext.getStore();
      const tenantId = (req.params.tenantId as string) || store?.tenantId;
      if (!tenantId) {
        res.status(400).json({ success: false, message: 'Tenant context required' });
        return;
      }

      const keys = await ApiKeyService.listApiKeys(tenantId);
      res.status(200).json({ success: true, data: keys });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  async createKey(req: Request, res: Response): Promise<void> {
    try {
      const store = requestContext.getStore();
      const tenantId = (req.params.tenantId as string) || store?.tenantId;
      if (!tenantId) {
        res.status(400).json({ success: false, message: 'Tenant context required' });
        return;
      }

      const newKey = await ApiKeyService.createApiKey(tenantId, req.body);
      res.status(201).json({
        success: true,
        message: 'Headless API Key created successfully. Copy the secret now, it cannot be recovered!',
        data: newKey,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  async revokeKey(req: Request, res: Response): Promise<void> {
    try {
      const store = requestContext.getStore();
      const tenantId = (req.params.tenantId as string) || store?.tenantId;
      const keyId = req.params.id as string;

      if (!tenantId || !keyId) {
        res.status(400).json({ success: false, message: 'Tenant and key ID required' });
        return;
      }

      const revoked = await ApiKeyService.revokeApiKey(tenantId, keyId);
      res.status(200).json({
        success: true,
        message: 'API Key revoked successfully',
        data: revoked,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err.message });
    }
  }
}
