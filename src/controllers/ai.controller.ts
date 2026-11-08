import { Request, Response } from 'express';
import { AiRagService } from '../services/ai-rag.service';
import prisma from '../config/prisma';

async function resolveTenantId(req: Request): Promise<string> {
  const explicit =
    (req as any).tenantId ||
    (req as any).user?.tenantId ||
    (req.headers['x-tenant-id'] as string) ||
    (req.body?.tenantId as string) ||
    (req.query?.tenantId as string);

  if (explicit && typeof explicit === 'string' && explicit.trim()) {
    return explicit.trim();
  }

  // Fallback for platform admins, superadmins, or single-tenant operations
  try {
    const activeTenant = await (prisma as any).tenant.findFirst({
      where: { status: 'ACTIVE' },
      select: { id: true },
      orderBy: { createdAt: 'asc' }
    });
    if (activeTenant?.id) {
      return activeTenant.id;
    }

    const anyTenant = await (prisma as any).tenant.findFirst({
      select: { id: true },
      orderBy: { createdAt: 'asc' }
    });
    if (anyTenant?.id) {
      return anyTenant.id;
    }
  } catch (err) {
    console.warn('Error resolving fallback tenant in ai.controller:', err);
  }

  return 'global';
}

export const chatWithAi = async (req: Request, res: Response) => {
  try {
    const tenantId = await resolveTenantId(req);
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
    const tenantId = await resolveTenantId(req);
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
    const tenantId = await resolveTenantId(req);
    await AiRagService.ensureTenantKnowledgeLoaded(tenantId);
    const docs = AiRagService.getTenantDocuments(tenantId);
    res.json({ success: true, data: docs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const addTenantKnowledge = async (req: Request, res: Response) => {
  try {
    const tenantId = await resolveTenantId(req);
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
    const tenantId = await resolveTenantId(req);
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

export const getAiConfig = async (req: Request, res: Response) => {
  try {
    const tenantId = await resolveTenantId(req);
    const config = await AiRagService.getTenantAiConfig(tenantId);
    // Mask API key for UI display
    const maskedKey = config.apiKey
      ? config.apiKey.slice(0, 4) + '••••••••••••' + config.apiKey.slice(-4)
      : '';

    res.json({
      success: true,
      data: {
        enabled: config.enabled,
        model: config.model || 'auto',
        apiKey: maskedKey,
        isConfigured: !!config.apiKey || !!process.env.GEMINI_API_KEY,
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getAvailableModels = async (req: Request, res: Response) => {
  try {
    const tenantId = await resolveTenantId(req);
    let apiKey = req.query.apiKey as string | undefined;

    if (!apiKey || apiKey.includes('••••')) {
      const stored = await AiRagService.getTenantAiConfig(tenantId);
      apiKey = stored.apiKey || process.env.GEMINI_API_KEY;
    }

    if (!apiKey) {
      return res.json({
        success: true,
        data: {
          detectedModel: 'gemini-3.5-flash',
          models: [
            { id: 'auto', displayName: '✨ Auto-Detect (Recommended: Best Stable Model with Quota)' },
            { id: 'gemini-3.5-flash', displayName: 'Gemini 3.5 Flash (Recommended: Ultra-fast & High Quota)' },
            { id: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash Lite (High Speed)' },
            { id: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash (Latest Preview)' },
            { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
            { id: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash' },
            { id: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro' },
          ]
        }
      });
    }

    let fetchedModels: Array<{ id: string; displayName: string }> = [];
    try {
      const models = await AiRagService.fetchAvailableGeminiModels(apiKey);
      fetchedModels = models.map(m => ({ id: m.id, displayName: `${m.displayName} (${m.id})` }));
    } catch {
      // Fallback if list endpoint restricted
    }

    const detected = await AiRagService.resolveBestGeminiModel(apiKey, 'auto');

    const options = [
      { id: 'auto', displayName: `✨ Auto-Detect from API Key (Active: ${detected})` },
      ...(fetchedModels.length > 0 ? fetchedModels : [
        { id: 'gemini-3.5-flash', displayName: 'Gemini 3.5 Flash (Recommended: Ultra-fast & High Quota)' },
        { id: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash Lite (High Speed)' },
        { id: 'gemini-3.8-flash', displayName: 'Gemini 3.8 Flash (Latest Preview)' },
        { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
        { id: 'gemini-1.5-flash', displayName: 'Gemini 1.5 Flash' },
        { id: 'gemini-1.5-pro', displayName: 'Gemini 1.5 Pro' },
      ])
    ];

    res.json({
      success: true,
      data: {
        detectedModel: detected,
        models: options
      }
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

export const updateAiConfig = async (req: Request, res: Response) => {
  try {
    const tenantId = await resolveTenantId(req);
    const { enabled, apiKey, model } = req.body;
    const result = await AiRagService.saveTenantAiConfig(tenantId, {
      enabled,
      apiKey,
      model: model || 'auto'
    });

    res.json({
      success: true,
      message: 'AI Copilot integration updated successfully',
      data: result
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
};

export const testAiConnection = async (req: Request, res: Response) => {
  try {
    const tenantId = await resolveTenantId(req);
    const { apiKey, model } = req.body;

    let keyToTest = apiKey;
    if (!keyToTest || keyToTest.includes('••••')) {
      const stored = await AiRagService.getTenantAiConfig(tenantId);
      keyToTest = stored.apiKey || process.env.GEMINI_API_KEY;
    }

    const result = await AiRagService.testGeminiConnection(keyToTest, model || 'auto');
    res.json({
      success: result.success,
      data: result
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      error: err.message || 'Connection test failed'
    });
  }
};
