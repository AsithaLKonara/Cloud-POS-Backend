import { Request, Response } from 'express';
import { AiRagService } from '../services/ai-rag.service';

function getTenantId(req: Request): string | undefined {
  return (req as any).tenantId || (req as any).user?.tenantId;
}

export const chatWithAi = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const { message, history } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message is required and must be a non-empty string.' });
    }

    const userId = (req as any).user?.id;
    const result = await AiRagService.answerQuestion({
      tenantId,
      userId,
      message,
      history: Array.isArray(history) ? history : []
    });

    res.json({
      success: true,
      data: result
    });
  } catch (err: any) {
    console.error('Error in chatWithAi:', err);
    res.status(500).json({ error: err.message || 'Internal AI service error' });
  }
};

export const getSuggestedPrompts = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const liveMetrics = await AiRagService.fetchLiveTenantMetrics(tenantId);
    
    const prompts = [
      'What is our Accounts Receivable aging balance?',
      'How do I start and reconcile a physical stocktake?',
      'Is our General Ledger currently balanced?',
      'Show today\'s sales and revenue summary',
      'How are vendor bills matched and settled in AP?'
    ];

    res.json({
      success: true,
      tenant: liveMetrics ? {
        name: liveMetrics.tenantName,
        currency: liveMetrics.currency,
        isGlBalanced: liveMetrics.isGlBalanced,
        todaySales: liveMetrics.todaySales
      } : null,
      prompts
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getTenantKnowledge = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant context required' });
    }

    await AiRagService.ensureTenantKnowledgeLoaded(tenantId);
    const docs = AiRagService.getTenantDocuments(tenantId);
    res.json({ success: true, data: docs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const addTenantKnowledge = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant context required' });
    }

    const { title, category, content, tags } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    const doc = AiRagService.addTenantCustomDocument(tenantId, {
      title,
      category: category || 'GENERAL',
      content,
      tags: Array.isArray(tags) ? tags : []
    });

    res.status(201).json({ success: true, data: doc });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

export const deleteTenantKnowledge = async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant context required' });
    }

    const id = String(req.params.id);
    const deleted = AiRagService.deleteTenantDocument(tenantId, id);
    if (!deleted) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json({ success: true, message: 'Document deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
