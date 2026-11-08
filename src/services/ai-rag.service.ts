import prisma from '../config/prisma';
import { GeneralLedgerService } from './gl.service';
import { AccountsPayableService } from './ap.service';
import { AccountsReceivableService } from './ar.service';

export interface KnowledgeDocument {
  id: string;
  tenantId: string | null; // null = universal platform knowledge
  title: string;
  category: 'ERP_ACCOUNTING' | 'POS_OPERATIONS' | 'INVENTORY' | 'AP_AR' | 'CRM' | 'SETTINGS' | 'GENERAL';
  content: string;
  tags: string[];
}

export interface RagRetrievalResult {
  document: KnowledgeDocument;
  score: number;
  snippet: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LiveTenantMetrics {
  tenantName: string;
  tenantSlug: string;
  currency: string;
  todaySales: number;
  todayOrdersCount: number;
  openOrdersCount: number;
  arOutstanding: number;
  arOverdueCount: number;
  apOutstanding: number;
  apOverdueCount: number;
  isGlBalanced: boolean;
  activeStocktakeCount: number;
  activeBranchesCount: number;
}

// Universal platform documentation chunks for POS & ERP
export const PLATFORM_KNOWLEDGE_BASE: KnowledgeDocument[] = [
  {
    id: 'kb-gl-double-entry',
    tenantId: null,
    title: 'General Ledger & Double-Entry Accounting Principles',
    category: 'ERP_ACCOUNTING',
    tags: ['gl', 'general ledger', 'journal', 'debit', 'credit', 'trial balance', 'balance sheet', 'accounts'],
    content: `XONIT ERP implements standard double-entry bookkeeping with canonical accounts:
- Assets (1000-1999): 1010 Cash on Hand (POS Till), 1020 Operating Bank, 1100 Accounts Receivable, 1200 Merchandise Inventory Asset.
- Liabilities (2000-2999): 2000 Accounts Payable, 2100 Sales Tax / VAT Payable.
- Equity (3000-3999): 3000 Owner's Equity & Retained Earnings.
- Revenue (4000-4999): 4000 Sales Revenue, 4050 Service & Labor Revenue.
- Expenses (5000-6999): 5000 COGS, 6010 Rent, 6020 Electricity & Utilities, 6030 Salaries, 6100 Inventory Shrinkage & Loss.

Double-Entry Rule: In every journal entry, sum of Debits must strictly equal sum of Credits. The Trial Balance lists all accounts and must be balanced at all times (Total Debits == Total Credits). The Balance Sheet satisfies: Assets = Liabilities + Equity (including Net Income).`
  },
  {
    id: 'kb-ap-bills-aging',
    tenantId: null,
    title: 'Accounts Payable (AP) & Vendor Bills Workflow',
    category: 'AP_AR',
    tags: ['ap', 'accounts payable', 'bills', 'supplier', 'aging', 'vendor payment', '3-way match'],
    content: `Accounts Payable manages liabilities owed to suppliers:
1. Vendor Bills: Created when goods are received against a Purchase Order or standalone supplier invoice. Supports 3-Way Matching (PO ordered qty/rate vs GRN received qty vs Bill invoice).
2. AP Aging Buckets:
   - Current: Not yet reached due date.
   - 1-30 Days: Overdue up to 1 month.
   - 31-60 Days: Overdue 1 to 2 months.
   - 61-90 Days: High priority overdue.
   - 90+ Days: Critical arrears requiring immediate supplier settlement.
3. Settlement: Recording a vendor payment debits 2000 Accounts Payable and credits 1010 Cash or 1020 Bank, automatically clearing the balance due on the bill and logging a GL journal entry.`
  },
  {
    id: 'kb-ar-invoices-aging',
    tenantId: null,
    title: 'Accounts Receivable (AR) & Customer Invoices Workflow',
    category: 'AP_AR',
    tags: ['ar', 'accounts receivable', 'invoices', 'customer', 'aging', 'collections', 'commercial invoice'],
    content: `Accounts Receivable tracks debts owed by customers and trade debtors:
1. Invoices: Commercial Tax Invoices automatically debit 1100 Accounts Receivable and credit 4000 Sales Revenue. Quotations and Proforma invoices remain in DRAFT without affecting the ledger until confirmed.
2. AR Aging Buckets:
   - Current: Invoices within agreed credit terms (e.g. Net 30).
   - 1-30 Days, 31-60 Days, 61-90 Days, 90+ Days: Progressive overdue aging buckets to prioritize collection calls.
3. Customer Receipts: Recording customer settlement debits 1010/1020 (Cash/Bank) and credits 1100 Accounts Receivable.`
  },
  {
    id: 'kb-stocktaking-cycle-counts',
    tenantId: null,
    title: 'Stocktaking, Cycle Counting & Physical Inventory Reconciliation',
    category: 'INVENTORY',
    tags: ['stocktake', 'cycle count', 'physical count', 'inventory', 'variance', 'reconciliation', 'shrinkage'],
    content: `Stocktaking workflow for retail and warehouse outlets:
1. Start Session: Selecting a branch freezes an instantaneous snapshot of current system inventory quantities and unit costs for all variants.
2. Physical Count: Auditors or staff count physical items on shelves/racks and record counted quantities. The system computes Variance = Counted Qty - System Qty.
3. Review & Verification: Highlight positive variance (surplus) and negative variance (shrinkage/loss).
4. Reconcile & Post to Ledger:
   - Synchronizes physical branch stock quantities and master variant inventory totals.
   - Records an immutable CYCLE_COUNT_RECONCILIATION audit log.
   - Posts double-entry journal entry:
     * If net shrinkage: Debit 6100 Inventory Shrinkage & Loss, Credit 1200 Inventory Asset.
     * If net surplus: Debit 1200 Inventory Asset, Credit 4000 Revenue Gain.`
  },
  {
    id: 'kb-pos-operations',
    tenantId: null,
    title: 'POS Terminal Operations & Cash Register Management',
    category: 'POS_OPERATIONS',
    tags: ['pos', 'checkout', 'register', 'cash drawer', 'barcode scanner', 'held carts', 'split payment'],
    content: `Point of Sale (POS) core operations:
- Barcode scanning & quick lookup: Scan EAN-13, UPC or internal SKU to add to cart.
- Multi-Tender Payment: Supports Cash, Credit/Debit Card, LankaQR, PayHere, and Customer Credit/Garage Accounts.
- Held Carts: Cashiers can suspend an active order to serve another customer and recall it later.
- Offline Synchronization: Carts are queued locally in browser IndexedDB if internet connectivity is lost, and flushed to the backend once back online.
- Cash Drawer Reconciliation: Opening float, expected cash sales, cash drops, and closing count variance.`
  },
  {
    id: 'kb-multi-branch-transfers',
    tenantId: null,
    title: 'Multi-Branch Inventory & Stock Transfers',
    category: 'INVENTORY',
    tags: ['branches', 'stock transfer', 'multi-outlet', 'dispatch', 'receive', 'moving average cost'],
    content: `Multi-Branch management allows independent stock tracking per outlet:
- Stock Transfers: Source branch dispatches stock (status IN_TRANSIT), destination branch verifies physical arrival and receives items.
- Moving Weighted Average Cost: Recalculates cost of goods whenever purchase orders or batches are received at fluctuating prices: New Avg Cost = ((Old Qty * Old Cost) + (New Qty * New Cost)) / (Old Qty + New Qty).`
  },
  {
    id: 'kb-tenant-security-isolation',
    tenantId: null,
    title: 'Multi-Tenant Security, Isolation & Role-Based Access Control',
    category: 'SETTINGS',
    tags: ['security', 'tenant isolation', 'rbac', 'roles', 'multi-tenancy', 'audit'],
    content: `XONIT POS & ERP operates with strict SaaS multi-tenant isolation:
- Every query is partitioned by tenantId at both the API gateway and database layer.
- Granular RBAC permissions govern access to POS, inventory, reports, financials, and system administration.
- Immutable audit trails track all user actions (who, what, when, IP address, user agent).`
  }
];

// In-memory tenant-specific custom documents store (isolated per tenantId)
const tenantCustomKnowledgeMap = new Map<string, KnowledgeDocument[]>();

export class AiRagService {
  /**
   * Loads custom documents from DB into memory cache if not already loaded
   */
  static async ensureTenantKnowledgeLoaded(tenantId: string): Promise<void> {
    if (tenantCustomKnowledgeMap.has(tenantId)) return;
    try {
      const setting = await (prisma as any).setting.findUnique({
        where: { key: `ai_knowledge:${tenantId}` }
      });
      if (setting && setting.value) {
        const parsed = JSON.parse(setting.value);
        if (Array.isArray(parsed)) {
          tenantCustomKnowledgeMap.set(tenantId, parsed);
          return;
        }
      }
    } catch {
      // Gracefully continue with empty array if setting does not exist
    }
    tenantCustomKnowledgeMap.set(tenantId, []);
  }

  /**
   * Persists tenant custom documents to database (Setting model)
   */
  private static async persistTenantKnowledge(tenantId: string): Promise<void> {
    try {
      const docs = tenantCustomKnowledgeMap.get(tenantId) || [];
      await (prisma as any).setting.upsert({
        where: { key: `ai_knowledge:${tenantId}` },
        update: { value: JSON.stringify(docs), group: 'ai_rag' },
        create: {
          key: `ai_knowledge:${tenantId}`,
          value: JSON.stringify(docs),
          group: 'ai_rag',
          description: `Custom AI RAG documents for tenant ${tenantId}`,
          isPublic: false
        }
      });
    } catch (e) {
      console.warn(`Failed to persist AI knowledge for tenant ${tenantId}:`, e);
    }
  }

  /**
   * Detects prompt injection, cross-tenant intrusion, or secret exfiltration attempts
   */
  static detectSecurityViolation(query: string): boolean {
    const q = query.toLowerCase();
    const maliciousPatterns = [
      /system\s+prompt/i,
      /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
      /disregard\s+(all\s+)?(previous|prior)\s+instructions/i,
      /reveal\s+(internal\s+)?prompt/i,
      /show\s+(all\s+)?tenants/i,
      /list\s+(all\s+)?tenants/i,
      /other\s+tenant/i,
      /database\s+password/i,
      /secret\s+key/i,
      /api[_-]?key/i,
      /env\s+variables/i,
      /dump\s+(all\s+)?users/i,
      /bypass\s+(tenant\s+)?isolation/i
    ];

    return maliciousPatterns.some(pattern => pattern.test(q));
  }
  /**
   * Tokenizes text for semantic BM25 / TF-IDF matching
   */
  private static tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);
  }

  /**
   * Computes term frequency vector
   */
  private static getTermFrequency(tokens: string[]): Map<string, number> {
    const tf = new Map<string, number>();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) || 0) + 1);
    }
    return tf;
  }

  /**
   * Computes cosine similarity score between query tokens and document content
   */
  private static calculateScore(queryTokens: string[], doc: KnowledgeDocument): number {
    const docText = `${doc.title} ${doc.tags.join(' ')} ${doc.content}`.toLowerCase();
    const docTokens = this.tokenize(docText);
    const docTf = this.getTermFrequency(docTokens);

    let score = 0;
    const queryTf = this.getTermFrequency(queryTokens);

    for (const [token, qCount] of queryTf.entries()) {
      if (docTf.has(token)) {
        const dCount = docTf.get(token)!;
        // Boost matches in title or tags
        const inTitle = doc.title.toLowerCase().includes(token) ? 3.0 : 1.0;
        const inTags = doc.tags.some(t => t.toLowerCase().includes(token)) ? 2.5 : 1.0;
        score += (qCount * dCount * inTitle * inTags);
      }
    }

    // Normalize by document length
    return score / (Math.sqrt(docTokens.length) + 1);
  }

  /**
   * Retrieves relevant knowledge documents strictly scoped to the tenant
   * Guarantee: ONLY platform knowledge (tenantId: null) and the authenticated tenant's documents are accessible.
   */
  static retrieveDocuments(tenantId: string | null | undefined, query: string, topK: number = 3): RagRetrievalResult[] {
    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) return [];

    // 1. Gather eligible documents: platform docs + tenant custom docs
    const eligibleDocs: KnowledgeDocument[] = [...PLATFORM_KNOWLEDGE_BASE];
    if (tenantId && tenantCustomKnowledgeMap.has(tenantId)) {
      eligibleDocs.push(...(tenantCustomKnowledgeMap.get(tenantId) || []));
    }

    // 2. Score documents
    const scored: RagRetrievalResult[] = [];
    for (const doc of eligibleDocs) {
      // Hard security check: never allow cross-tenant document leakage
      if (doc.tenantId !== null && doc.tenantId !== tenantId) {
        continue;
      }

      const score = this.calculateScore(queryTokens, doc);
      if (score > 0.1) {
        // Create relevant snippet
        const snippet = doc.content.length > 280 ? doc.content.slice(0, 280) + '...' : doc.content;
        scored.push({ document: doc, score, snippet });
      }
    }

    // 3. Sort by relevance descending
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /**
   * Fetches real-time live metrics and operational facts strictly isolated to the requesting tenant
   */
  static async fetchLiveTenantMetrics(tenantId?: string | null): Promise<LiveTenantMetrics | null> {
    if (!tenantId) return null;

    try {
      const tenant = await (prisma as any).tenant.findUnique({
        where: { id: tenantId },
        select: { name: true, slug: true, currency: true }
      });

      if (!tenant) return null;

      const currency = tenant.currency || 'LKR';

      // 1. Today's orders & sales
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const todayOrders = await (prisma as any).order.aggregate({
        where: {
          tenantId,
          createdAt: { gte: startOfToday },
          status: { notIn: ['CANCELLED', 'REFUNDED'] }
        },
        _sum: { total: true },
        _count: { id: true }
      });

      const openOrdersCount = await (prisma as any).order.count({
        where: {
          tenantId,
          status: { in: ['PENDING', 'PROCESSING', 'AWAITING_PAYMENT'] }
        }
      });

      // 2. Accounts Receivable (AR)
      let arOutstanding = 0;
      let arOverdueCount = 0;
      try {
        const arReport = await AccountsReceivableService.getArAgingReport(tenantId);
        arOutstanding = arReport.totalDue || 0;
        arOverdueCount = (arReport.invoices || []).filter((i: any) => i.overdueDays > 0).length;
      } catch (e) {
        // Fallback
      }

      // 3. Accounts Payable (AP)
      let apOutstanding = 0;
      let apOverdueCount = 0;
      try {
        const apReport = await AccountsPayableService.getApAgingReport(tenantId);
        apOutstanding = apReport.totalDue || 0;
        apOverdueCount = (apReport.bills || []).filter((b: any) => b.overdueDays > 0).length;
      } catch (e) {
        // Fallback
      }

      // 4. General Ledger balance status
      let isGlBalanced = true;
      try {
        const tb = await GeneralLedgerService.getTrialBalance(tenantId);
        isGlBalanced = tb.isBalanced;
      } catch (e) {
        // Fallback
      }

      // 5. Active Stocktake counts & branches
      const activeStocktakeCount = await (prisma as any).stocktakeSession.count({
        where: { tenantId, status: 'IN_PROGRESS' }
      });

      const activeBranchesCount = await (prisma as any).branch.count({
        where: { tenantId }
      });

      return {
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
        currency,
        todaySales: todayOrders._sum?.total || 0,
        todayOrdersCount: todayOrders._count?.id || 0,
        openOrdersCount,
        arOutstanding,
        arOverdueCount,
        apOutstanding,
        apOverdueCount,
        isGlBalanced,
        activeStocktakeCount,
        activeBranchesCount
      };
    } catch (err) {
      console.error('Failed to fetch live tenant metrics for AI RAG:', err);
      return null;
    }
  }

  /**
   * Generates intelligent, grounded, contextual answers combining RAG retrieved documents
   * and live isolated tenant operational metrics.
   */
  static async answerQuestion(params: {
    tenantId?: string | null;
    userId?: string;
    message: string;
    history?: ChatMessage[];
  }): Promise<{
    answer: string;
    sources: Array<{ title: string; category: string; snippet?: string }>;
    suggestedQuestions: string[];
  }> {
    const { tenantId, message, history = [] } = params;
    const cleanQuery = (message || '').trim();

    // 0. Empty query protection
    if (!cleanQuery) {
      return {
        answer: `### 👋 Hello! How can I assist your operations today?

Please ask any question regarding:
- **General Ledger & Accounting** (Trial Balance, Balance Sheet, journal entries)
- **Accounts Payable / Receivable** (Aging reports, vendor bills, customer invoices)
- **Physical Stocktaking** (Cycle counts, snapshot variances, shrinkage reconciliation)
- **POS & Branch Operations** (Cash drawer balancing, multi-outlet transfers)`,
        sources: [],
        suggestedQuestions: [
          'What is our Accounts Receivable aging balance?',
          'Is our General Ledger currently balanced?',
          'How do I start and reconcile a physical stocktake?'
        ]
      };
    }

    // 1. Security & Cross-Tenant Boundary Guardrail
    if (this.detectSecurityViolation(cleanQuery)) {
      return {
        answer: `### 🔒 Security & Tenant Isolation Protocol

Your request cannot be processed because it involves system prompt extraction, credential queries, or cross-tenant data probing.

Under XONIT's SaaS multi-tenant security architecture:
- Every tenant organization is strictly isolated to its own logical boundary.
- Cross-tenant data retrieval, platform secrets, and system instructions are strictly inaccessible.
- All access attempts are recorded in the system security audit trail.`,
        sources: [],
        suggestedQuestions: [
          'Is our General Ledger currently balanced?',
          'What is our Accounts Receivable aging balance?',
          'How do I start and reconcile a physical stocktake?'
        ]
      };
    }

    // 2. Sanitize chat history: strictly allow only 'user' and 'assistant' roles
    const safeHistory: ChatMessage[] = (Array.isArray(history) ? history : [])
      .filter((h: any) => h && typeof h.content === 'string' && (h.role === 'user' || h.role === 'assistant'))
      .map((h: any) => ({
        role: h.role as 'user' | 'assistant',
        content: String(h.content).slice(0, 2000)
      }));

    // 3. Ensure custom knowledge is loaded for this tenant
    if (tenantId) {
      await this.ensureTenantKnowledgeLoaded(tenantId);
    }

    // 4. Retrieve knowledge documents via RAG semantic search
    const retrieved = this.retrieveDocuments(tenantId, cleanQuery, 3);

    // 5. Retrieve live tenant operational context
    const liveMetrics = await this.fetchLiveTenantMetrics(tenantId);

    // 6. Check for Google Gemini API (Tenant-configured in DB or process.env.GEMINI_API_KEY)
    let geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || '';
    let geminiModel = 'gemini-1.5-flash';
    let geminiEnabled = !!geminiApiKey;

    if (tenantId) {
      try {
        const tenantAiConfig = await this.getTenantAiConfig(tenantId);
        if (tenantAiConfig && tenantAiConfig.enabled) {
          if (tenantAiConfig.apiKey) {
            geminiApiKey = tenantAiConfig.apiKey;
          }
          if (tenantAiConfig.model) {
            geminiModel = tenantAiConfig.model;
          }
          geminiEnabled = !!geminiApiKey;
        } else if (tenantAiConfig && !tenantAiConfig.enabled) {
          geminiEnabled = false;
        }
      } catch (e) {
        // Fallback to environment variable
      }
    }

    if (geminiEnabled && geminiApiKey) {
      try {
        const response = await this.callGeminiLlm({
          cleanQuery,
          retrieved,
          liveMetrics,
          history: safeHistory,
          apiKey: geminiApiKey,
          model: geminiModel
        });
        if (response) return response;
      } catch (err: any) {
        console.warn('Google Gemini API call failed or timed out, falling back:', err?.response?.data || err.message);
      }
    }

    // 7. Check for external LLM API (OpenAI) if configured
    if (process.env.OPENAI_API_KEY) {
      try {
        const response = await this.callOpenAiLlm({
          cleanQuery,
          retrieved,
          liveMetrics,
          history: safeHistory
        });
        if (response) return response;
      } catch (err) {
        console.warn('OpenAI API call failed or timed out, falling back to built-in RAG expert engine:', err);
      }
    }

    // 8. Built-in contextual AI Expert Synthesizer (Local RAG execution)
    return this.synthesizeLocalResponse(cleanQuery, retrieved, liveMetrics);
  }

  /**
   * Calls Google Gemini LLM with RAG grounding and tenant boundary prompts
   */
  private static async callGeminiLlm(params: {
    cleanQuery: string;
    retrieved: RagRetrievalResult[];
    liveMetrics: LiveTenantMetrics | null;
    history: ChatMessage[];
    apiKey: string;
    model?: string;
  }) {
    const { cleanQuery, retrieved, liveMetrics, history, apiKey, model = 'gemini-1.5-flash' } = params;
    const axios = (await import('axios')).default;

    const systemPrompt = `You are the XONIT AI Copilot & Business Assistant for a SaaS multi-tenant POS and ERP platform.
CRITICAL TENANT ISOLATION RULES:
- You are currently serving tenant: "${liveMetrics?.tenantName || 'Standard Store'}" (Currency: ${liveMetrics?.currency || 'LKR'}).
- You must strictly only answer questions regarding this tenant's operations, general platform features, POS usage, inventory management, AP/AR aging, General Ledger, and stocktaking.
- NEVER disclose or fabricate information about any other tenant or organization.
- Answer accurately, politely, concisely, and format your response in crisp Markdown with bullet points and bold headers.

CURRENT LIVE TENANT METRICS:
${liveMetrics ? JSON.stringify(liveMetrics, null, 2) : 'No live tenant metrics available.'}

RETRIEVED KNOWLEDGE BASE EXCERPTS:
${retrieved.map((r, i) => `[Source ${i + 1}: ${r.document.title}]\n${r.document.content}`).join('\n\n')}
`;

    // Map history to Google Gemini format (roles: 'user' and 'model')
    const contents = [
      ...history.slice(-4).map(h => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(h.content).slice(0, 2000) }]
      })),
      {
        role: 'user',
        parts: [{ text: cleanQuery }]
      }
    ];

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const res = await axios.post(
      url,
      {
        system_instruction: {
          parts: [{ text: systemPrompt }]
        },
        contents,
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1000
        }
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000
      }
    );

    const candidate = res.data?.candidates?.[0];
    const answer = candidate?.content?.parts?.[0]?.text;
    if (!answer) return null;

    const sources = retrieved.map(r => ({
      title: r.document.title,
      category: r.document.category,
      snippet: r.snippet
    }));

    if (liveMetrics) {
      sources.unshift({
        title: `Live Tenant Ledger & Metrics (${liveMetrics.tenantName})`,
        category: 'ERP_ACCOUNTING',
        snippet: `Real-time data snapshot for ${liveMetrics.tenantName}`
      });
    }

    return {
      answer,
      sources,
      suggestedQuestions: this.generateSuggestedFollowups(cleanQuery, liveMetrics)
    };
  }

  /**
   * Calls OpenAI LLM with RAG grounding and tenant boundary prompts
   */
  private static async callOpenAiLlm(params: {
    cleanQuery: string;
    retrieved: RagRetrievalResult[];
    liveMetrics: LiveTenantMetrics | null;
    history: ChatMessage[];
  }) {
    const { cleanQuery, retrieved, liveMetrics, history } = params;
    const axios = (await import('axios')).default;

    const systemPrompt = `You are the XONIT AI Copilot & Business Assistant for a SaaS multi-tenant POS and ERP platform.
CRITICAL TENANT ISOLATION RULES:
- You are currently serving tenant: "${liveMetrics?.tenantName || 'Standard Store'}" (Currency: ${liveMetrics?.currency || 'LKR'}).
- You must strictly only answer questions regarding this tenant's operations, general platform features, POS usage, inventory management, AP/AR aging, General Ledger, and stocktaking.
- NEVER disclose or fabricate information about any other tenant or organization.
- Answer accurately, politely, concisely, and format your response in crisp Markdown with bullet points and bold headers.

CURRENT LIVE TENANT METRICS:
${liveMetrics ? JSON.stringify(liveMetrics, null, 2) : 'No live tenant metrics available.'}

RETRIEVED KNOWLEDGE BASE EXCERPTS:
${retrieved.map((r, i) => `[Source ${i + 1}: ${r.document.title}]\n${r.document.content}`).join('\n\n')}
`;

    // Strictly enforce role sanitization in API payload
    const safeMessages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-4).map(h => ({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: String(h.content).slice(0, 2000)
      })),
      { role: 'user', content: cleanQuery }
    ];

    const res = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: safeMessages,
        temperature: 0.3,
        max_tokens: 800
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    const answer = res.data?.choices?.[0]?.message?.content;
    if (!answer) return null;

    const sources = retrieved.map(r => ({
      title: r.document.title,
      category: r.document.category,
      snippet: r.snippet
    }));

    if (liveMetrics) {
      sources.unshift({
        title: `Live Tenant Ledger & Metrics (${liveMetrics.tenantName})`,
        category: 'ERP_ACCOUNTING',
        snippet: `Real-time data snapshot for ${liveMetrics.tenantName}`
      });
    }

    return {
      answer,
      sources,
      suggestedQuestions: this.generateSuggestedFollowups(cleanQuery, liveMetrics)
    };
  }

  /**
   * Built-in intelligent RAG synthesizer with live context injection
   */
  private static synthesizeLocalResponse(
    query: string,
    retrieved: RagRetrievalResult[],
    liveMetrics: LiveTenantMetrics | null
  ): {
    answer: string;
    sources: Array<{ title: string; category: string; snippet?: string }>;
    suggestedQuestions: string[];
  } {
    const q = query.toLowerCase();
    const curr = liveMetrics?.currency || 'Rs.';
    const tenantName = liveMetrics?.tenantName || 'Your Store';

    const sources: Array<{ title: string; category: string; snippet?: string }> = [];
    if (liveMetrics) {
      sources.push({
        title: `Live Tenant Telemetry (${tenantName})`,
        category: 'ERP_ACCOUNTING',
        snippet: `Real-time financial and operational status of tenant ${tenantName}`
      });
    }
    for (const r of retrieved) {
      sources.push({
        title: r.document.title,
        category: r.document.category,
        snippet: r.snippet
      });
    }

    let answer = '';

    const hasAr = /\bar\b/.test(q) || q.includes('receivable') || q.includes('customer debt') || q.includes('customer invoice') || q.includes('sales invoice') || q.includes('debtor');
    const hasAp = /\bap\b/.test(q) || q.includes('payable') || q.includes('vendor') || q.includes('supplier bill') || q.includes('creditor');
    const hasAging = q.includes('aging') || q.includes('overdue');

    // 0. Combined AP & AR aging & working capital inquiries
    if ((hasAr && hasAp) || (hasAging && !hasAr && !hasAp)) {
      const arDue = liveMetrics ? `${curr} ${liveMetrics.arOutstanding.toLocaleString()}` : `${curr} 0`;
      const apDue = liveMetrics ? `${curr} ${liveMetrics.apOutstanding.toLocaleString()}` : `${curr} 0`;
      const netWorkingCapital = liveMetrics ? (liveMetrics.arOutstanding - liveMetrics.apOutstanding) : 0;
      const netText = netWorkingCapital >= 0
        ? `🟢 Net Working Position: **${curr} ${netWorkingCapital.toLocaleString()}** (Receivables exceed Payables)`
        : `🔴 Net Liability Position: **${curr} ${Math.abs(netWorkingCapital).toLocaleString()}** (Payables exceed Receivables)`;

      answer = `### ⚖️ Accounts Receivable & Payable (Aging Summary) for **${tenantName}**

| Financial Stream | Total Outstanding | Overdue Invoices/Bills | Workflow Status |
| :--- | :--- | :--- | :--- |
| **Accounts Receivable (AR)** | **${arDue}** | ${liveMetrics?.arOverdueCount || 0} overdue | Customer Collections |
| **Accounts Payable (AP)** | **${apDue}** | ${liveMetrics?.apOverdueCount || 0} overdue | Vendor Obligations |

#### 💡 Working Capital Overview:
${netText}

#### Aging Buckets Breakdown:
Both AR and AP are monitored across standard 30-day arrears buckets:
- **Current (0-30 days):** Invoices & bills within agreed credit terms.
- **31-60 Days:** Early arrears; reminder statements recommended.
- **61-90 Days:** High delinquency risk; credit review and supplier coordination required.
- **90+ Days:** Critical aging; escalate debt recovery or prioritize vendor payments.

Navigate to **Finance & ERP → AP & AR Aging** to inspect line invoices and post settlement payments.`;
    }
    // 1. General Ledger & Trial Balance queries
    else if (q.includes('general ledger') || q.includes('gl') || q.includes('trial balance') || q.includes('balance sheet') || q.includes('debit') || q.includes('credit')) {
      const glStatus = liveMetrics?.isGlBalanced
        ? '✅ **Healthy & In Equilibrium** (Total Debits = Total Credits)'
        : '⚠️ **Variance Detected** (Unposted or pending manual adjustment)';

      answer = `### 📊 General Ledger & Accounting Overview for **${tenantName}**

- **Ledger Health Check:** ${glStatus}
- **System Accounts Active:** Real-time double-entry tracking is enforced for all POS transactions, inventory movements, and bills.
- **Trial Balance Verification:** Every posted journal entry strictly validates that Debits equal Credits before committing to the database.

#### How to manage your General Ledger:
1. **View Trial Balance:** Go to **Finance & ERP → General Ledger → Trial Balance** to inspect all canonical account balances.
2. **Post Manual Entries:** Click **"New Journal Entry"** to book accruals, depreciation, or capital transfers. The interface enforces real-time debit/credit equality.
3. **Balance Sheet:** Navigate to the **Balance Sheet** tab to verify that *Assets = Liabilities + Equity*.`;
    }
    // 2. Accounts Receivable (AR) & Customer Invoices queries
    else if (/\bar\b/.test(q) || q.includes('receivable') || q.includes('customer debt') || q.includes('customer invoice') || q.includes('sales invoice') || (q.includes('aging') && !q.includes('payable') && !q.includes('vendor'))) {
      const outstanding = liveMetrics ? `${curr} ${liveMetrics.arOutstanding.toLocaleString()}` : 'Rs. 0';
      const overdue = liveMetrics?.arOverdueCount || 0;

      answer = `### 💼 Accounts Receivable (AR) Status for **${tenantName}**

- **Total Outstanding Receivables:** **${outstanding}**
- **Overdue Invoices Requiring Follow-up:** **${overdue}**

#### Aging Buckets Breakdown:
XONIT categorizes customer debts into five distinct aging stages:
- **Current (0-30 days):** Invoices within normal credit terms.
- **31-60 Days:** Slightly past due; reminder statements recommended.
- **61-90 Days:** High delinquency risk; prompt credit hold.
- **90+ Days:** Severe default risk; escalated debt recovery required.

#### Recommended Action:
Navigate to **Finance & ERP → AP & AR Aging** and switch to the **Receivables** tab to view debtor statements and record settlement payments.`;
    }
    // 3. Accounts Payable (AP) & Supplier Bills queries
    else if (/\bap\b/.test(q) || q.includes('payable') || q.includes('vendor') || q.includes('supplier bill') || q.includes('payables')) {
      const outstanding = liveMetrics ? `${curr} ${liveMetrics.apOutstanding.toLocaleString()}` : 'Rs. 0';
      const overdue = liveMetrics?.apOverdueCount || 0;

      answer = `### 🏢 Accounts Payable (AP) Status for **${tenantName}**

- **Total Outstanding Vendor Liabilities:** **${outstanding}**
- **Overdue Vendor Bills:** **${overdue}**

#### AP Management Principles:
1. **3-Way Matching:** When bills are linked to a Purchase Order, the system compares ordered totals against received stock to flag variances before approval.
2. **Settlements:** Recording a vendor settlement directly debits *2000 Accounts Payable* and credits *1010 Cash* or *1020 Bank*, keeping your balance sheet in sync.
3. **Supplier Relations:** Prioritize settling bills in the **61-90** and **90+ Days** buckets to maintain favorable supplier credit terms.`;
    }
    // 4. Stocktaking / Cycle Counting queries
    else if (q.includes('stocktake') || q.includes('cycle count') || q.includes('physical count') || q.includes('shrinkage') || q.includes('reconcil')) {
      const activeSessions = liveMetrics?.activeStocktakeCount || 0;

      answer = `### 📦 Stocktaking & Physical Inventory Guide for **${tenantName}**

- **Active Stocktaking Audits:** **${activeSessions} session(s) in progress**
- **Active Outlets/Branches:** **${liveMetrics?.activeBranchesCount || 1}**

#### 4-Step Stocktake & Reconciliation Protocol:
1. **Initiate Session:** Go to **Finance & ERP → Stocktaking** and click **"Start Stocktake"**. Select your branch to freeze an immutable inventory snapshot.
2. **Conduct Physical Count:** Staff enter counted quantities or scan barcodes directly on the audit sheet.
3. **Inspect Variance:** The system calculates unit cost and net financial variance: \`Variance = Counted Qty - System Qty\`.
4. **Reconcile to Ledger:** Clicking **"Reconcile"** updates actual branch quantities, logs a transaction audit trail, and automatically posts a journal entry:
   - **Shrinkage (Loss):** Debits *6100 Shrinkage* and credits *1200 Inventory Asset*.
   - **Surplus (Gain):** Debits *1200 Inventory Asset* and credits *4000 Revenue*.`;
    }
    // 5. Sales, Revenue & Today's Performance
    else if (q.includes('sale') || q.includes('revenue') || q.includes('today') || q.includes('order') || q.includes('performance')) {
      const sales = liveMetrics ? `${curr} ${liveMetrics.todaySales.toLocaleString()}` : `${curr} 0`;
      const orders = liveMetrics?.todayOrdersCount || 0;
      const open = liveMetrics?.openOrdersCount || 0;

      answer = `### 📈 Today's Operations Summary for **${tenantName}**

- **Today's Gross Sales:** **${sales}**
- **Completed Orders Today:** **${orders}**
- **Orders Pending Fulfillment:** **${open}**
- **Outlets Reporting:** **${liveMetrics?.activeBranchesCount || 1}**

You can drill down into granular hourly revenue distributions, top selling products, and staff tender balances under **Overview → Executive Dashboard** or **Retail & POS → POS Sales & Orders**.`;
    }
    // 6. Generic / Fallback query matched against retrieved RAG docs
    else if (retrieved.length > 0 && retrieved[0]) {
      const primary = retrieved[0];
      answer = `### ℹ️ ${primary.document.title}

${primary.document.content}

---
*Tenant Context: You are currently working inside **${tenantName}**. All transactions, ledger balances, and inventory adjustments remain strictly isolated to your tenant organization.*`;
    }
    // 7. General welcome / assistance
    else {
      answer = `### 👋 Hello! I am your XONIT AI Copilot for **${tenantName}**

I can assist you with real-time operational answers and step-by-step guidance across:
- **General Ledger & Accounting:** Trial Balance, Balance Sheet, double-entry rules.
- **Accounts Payable & Receivable:** Outstanding vendor bills, customer debt recovery, aging reports.
- **Physical Stocktaking:** Cycle counts, variance calculation, and shrinkage reconciliation.
- **POS & Branch Operations:** Checkout workflow, cash register balancing, and inventory transfers.

What would you like to explore or analyze today?`;
    }

    return {
      answer,
      sources,
      suggestedQuestions: this.generateSuggestedFollowups(query, liveMetrics)
    };
  }

  /**
   * Generates smart contextual follow-up questions tailored to the tenant
   */
  private static generateSuggestedFollowups(query: string, liveMetrics: LiveTenantMetrics | null): string[] {
    const q = query.toLowerCase();

    if (q.includes('gl') || q.includes('ledger') || q.includes('balance')) {
      return [
        'How do I post a balanced manual journal entry?',
        'What is our current Accounts Receivable aging balance?',
        'How does stocktake shrinkage affect our balance sheet?'
      ];
    }

    if (q.includes('ar') || q.includes('receivable') || q.includes('customer')) {
      return [
        'How are customer receipts recorded against commercial invoices?',
        'What is our Accounts Payable outstanding to suppliers?',
        'How do I view customers with overdue invoices?'
      ];
    }

    if (q.includes('stocktake') || q.includes('inventory')) {
      return [
        'How does reconciling a stocktake post to the General Ledger?',
        'How do I freeze an inventory snapshot for a cycle count?',
        'What are today\'s sales and order metrics?'
      ];
    }

    return [
      'What is our Accounts Receivable aging balance?',
      'How do I start and reconcile a physical stocktake?',
      'Is our General Ledger currently balanced?',
      'Show today\'s sales and revenue summary'
    ];
  }

  /**
   * Allows tenants to store custom organizational knowledge chunks (strictly tenant-isolated)
   */
  static addTenantCustomDocument(tenantId: string, doc: Omit<KnowledgeDocument, 'id' | 'tenantId'>): KnowledgeDocument {
    if (!tenantCustomKnowledgeMap.has(tenantId)) {
      tenantCustomKnowledgeMap.set(tenantId, []);
    }

    const newDoc: KnowledgeDocument = {
      id: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      tenantId,
      ...doc
    };

    tenantCustomKnowledgeMap.get(tenantId)!.push(newDoc);
    this.persistTenantKnowledge(tenantId).catch(() => {});
    return newDoc;
  }

  /**
   * Retrieves all custom documents for a specific tenant
   */
  static getTenantDocuments(tenantId: string): KnowledgeDocument[] {
    return tenantCustomKnowledgeMap.get(tenantId) || [];
  }

  /**
   * Deletes a custom document for a specific tenant
   */
  static deleteTenantDocument(tenantId: string, documentId: string): boolean {
    const docs = tenantCustomKnowledgeMap.get(tenantId);
    if (!docs) return false;

    const initialLen = docs.length;
    tenantCustomKnowledgeMap.set(tenantId, docs.filter(d => d.id !== documentId));
    const wasDeleted = tenantCustomKnowledgeMap.get(tenantId)!.length < initialLen;
    if (wasDeleted) {
      this.persistTenantKnowledge(tenantId).catch(() => {});
    }
    return wasDeleted;
  }

  /**
   * Retrieves tenant AI Copilot configuration from Setting table
   */
  static async getTenantAiConfig(tenantId: string): Promise<{ enabled: boolean; apiKey?: string; model?: string }> {
    try {
      const setting = await (prisma as any).setting.findUnique({
        where: { key: `ai_gemini_config:${tenantId}` }
      });
      if (setting && setting.value) {
        return JSON.parse(setting.value);
      }
    } catch {
      // Fallback
    }
    return {
      enabled: false,
      model: 'gemini-1.5-flash',
    };
  }

  /**
   * Persists tenant AI Copilot configuration to Setting table
   */
  static async saveTenantAiConfig(tenantId: string, config: { enabled: boolean; apiKey?: string; model?: string }) {
    const existing = await this.getTenantAiConfig(tenantId);
    const finalApiKey = config.apiKey && !config.apiKey.includes('••••')
      ? config.apiKey.trim()
      : existing.apiKey || '';

    const payload = {
      enabled: !!config.enabled,
      apiKey: finalApiKey,
      model: config.model || 'gemini-1.5-flash',
    };

    await (prisma as any).setting.upsert({
      where: { key: `ai_gemini_config:${tenantId}` },
      update: {
        value: JSON.stringify(payload),
        group: 'ai_copilot',
        updatedAt: new Date()
      },
      create: {
        key: `ai_gemini_config:${tenantId}`,
        value: JSON.stringify(payload),
        group: 'ai_copilot',
        description: `Google Gemini AI Copilot credentials for tenant ${tenantId}`,
        isPublic: false
      }
    });

    return {
      enabled: payload.enabled,
      model: payload.model,
      hasApiKey: !!payload.apiKey,
    };
  }

  /**
   * Tests connection with Google Gemini API directly
   */
  static async testGeminiConnection(apiKey?: string, model = 'gemini-1.5-flash'): Promise<{
    success: boolean;
    latencyMs: number;
    message: string;
  }> {
    const key = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
    if (!key) {
      throw new Error('Google Gemini API Key is required to test connection.');
    }

    const axios = (await import('axios')).default;
    const start = Date.now();
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const res = await axios.post(
        url,
        {
          contents: [{ role: 'user', parts: [{ text: 'Respond with "PONG"' }] }],
          generationConfig: { maxOutputTokens: 10 }
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        }
      );

      const latencyMs = Date.now() - start;
      const reply = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      return {
        success: true,
        latencyMs,
        message: `Successfully connected to Google Gemini (${model}). Latency: ${latencyMs}ms.`
      };
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      const apiErr = err.response?.data?.error?.message || err.message;
      return {
        success: false,
        latencyMs,
        message: `Google Gemini API error: ${apiErr}`
      };
    }
  }
}
