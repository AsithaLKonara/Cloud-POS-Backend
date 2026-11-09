import { WhatsAppWebhookService } from '../services/whatsapp-webhook.service';
import prisma from '../config/prisma';

describe('WhatsApp Webhook & Interactive Conversational Engine', () => {
  jest.setTimeout(30000);

  const testTenantId = 'c9731788-2234-4734-ab77-295f6c561bef';
  const testPhoneId = '1048592019482';
  const testWabaId = '1029482019482';
  const customerPhone = '94770001122';

  describe('Meta Webhook Subscription Handshake', () => {
    it('should verify challenge when mode=subscribe and verify_token matches', () => {
      const result = WhatsAppWebhookService.verifyWebhook(
        'subscribe',
        'xonit_whatsapp_verify_token_2026',
        'challenge_123456789'
      );

      expect(result.status).toBe(200);
      expect(result.body).toBe('challenge_123456789');
    });

    it('should reject handshake with status 403 when verify_token is invalid', () => {
      const result = WhatsAppWebhookService.verifyWebhook(
        'subscribe',
        'invalid_token_xyz',
        'challenge_123456789'
      );

      expect(result.status).toBe(403);
      expect(result.body).toBe('Forbidden');
    });
  });

  describe('Inbound Payload Processing & Database Persistence', () => {
    it('should process incoming text query and log both inbound and outbound AI reply', async () => {
      const inboundPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: testWabaId,
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '15551234567',
                    phone_number_id: testPhoneId,
                  },
                  contacts: [
                    {
                      profile: { name: 'Unit Test Customer' },
                      wa_id: customerPhone,
                    },
                  ],
                  messages: [
                    {
                      from: customerPhone,
                      id: `wamid.test_inbound_${Date.now()}`,
                      timestamp: `${Math.floor(Date.now() / 1000)}`,
                      text: { body: 'What are your store business hours?' },
                      type: 'text',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      await WhatsAppWebhookService.processInboundPayload(inboundPayload);

      // Verify customer record created or matched
      const customer = await (prisma as any).customer.findFirst({
        where: { tenantId: testTenantId, phone: { contains: customerPhone.slice(-9) } },
      });
      expect(customer).toBeTruthy();

      // Verify inbound message logged
      const inboundMsg = await (prisma as any).whatsAppMessage.findFirst({
        where: {
          tenantId: testTenantId,
          phone: customerPhone,
          direction: 'INBOUND',
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(inboundMsg).toBeTruthy();
      expect(inboundMsg.content).toContain('store business hours');

      // Verify outbound reply logged
      const outboundReply = await (prisma as any).whatsAppMessage.findFirst({
        where: {
          tenantId: testTenantId,
          phone: customerPhone,
          direction: 'OUTBOUND',
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(outboundReply).toBeTruthy();
      expect(outboundReply.content.length).toBeGreaterThan(5);
    });

    it('should process button click and dispatch instant payment link', async () => {
      const buttonPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: testWabaId,
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '15551234567',
                    phone_number_id: testPhoneId,
                  },
                  contacts: [
                    {
                      profile: { name: 'Unit Test Customer' },
                      wa_id: customerPhone,
                    },
                  ],
                  messages: [
                    {
                      from: customerPhone,
                      id: `wamid.test_btn_${Date.now()}`,
                      timestamp: `${Math.floor(Date.now() / 1000)}`,
                      type: 'interactive',
                      interactive: {
                        type: 'button_reply',
                        button_reply: {
                          id: 'btn_pay_lankaqr',
                          title: 'Pay LankaQR 💳',
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      await WhatsAppWebhookService.processInboundPayload(buttonPayload);

      // Verify outbound message contains payment link
      const paymentMsg = await (prisma as any).whatsAppMessage.findFirst({
        where: {
          tenantId: testTenantId,
          phone: customerPhone,
          direction: 'OUTBOUND',
          content: { contains: 'LankaQR' },
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(paymentMsg).toBeTruthy();
      expect(paymentMsg.content).toContain('lankaqr');
    });
  });
});
