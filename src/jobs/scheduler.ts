import cron from 'node-cron';
import { auditDigestService } from '../services/auditDigest.service';
import { dbBackupService } from './dbBackup';
import { SubscriptionService } from '../services/subscription.service';
import { logger } from '../utils/logger';

const PENTEST_REMINDER_MESSAGE = [
  '🔴 *Quarterly Penetration Test Reminder*',
  '',
  'A scheduled penetration test is due in 7 days.',
  '',
  '*Pre-test checklist:*',
  '• Notify hosting provider (CloudFlare, AWS) to whitelist pentest IP',
  '• Create isolated pentest user accounts (`pentest@laural.com`)',
  '• Take a full database snapshot before testing begins',
  '• Review `PenetrationTestSchedule.md` for full scope & checklist',
  '• Confirm `SLACK_WEBHOOK_URL` is active for real-time alerts during test',
  '',
  'See: `PenetrationTestSchedule.md` for the full scope and test checklist.',
].join('\n');

async function sendPentestReminder() {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    logger.warn('[Scheduler] SLACK_WEBHOOK_URL not configured — pentest reminder not sent');
    return;
  }
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: PENTEST_REMINDER_MESSAGE }),
  });
  logger.info('[Scheduler] Quarterly pentest reminder sent to Slack');
}

/**
 * Registers all recurring background jobs.
 * Call once on server startup from index.ts.
 */
export function registerScheduledJobs() {
  // Weekly security audit digest — every Monday at 08:00 UTC
  cron.schedule('0 8 * * 1', async () => {
    logger.info('[Scheduler] Running weekly security audit log digest...');
    await auditDigestService.generateWeeklyDigest();
  }, { timezone: 'UTC' });

  // Quarterly pentest reminders — 7 days before each scheduled test window
  // Q1: Dec 30 | Q2: Mar 31 | Q3: Jun 30 | Q4: Sep 30 — all at 08:00 UTC
  const pentestCrons = [
    '0 8 30 12 *',  // Dec 30 — Q1 reminder (test Jan 6–10)
    '0 8 31 3  *',  // Mar 31 — Q2 reminder (test Apr 7–11)
    '0 8 30 6  *',  // Jun 30 — Q3 reminder (test Jul 7–11)
    '0 8 30 9  *',  // Sep 30 — Q4 reminder (test Oct 6–10)
  ];

  for (const expression of pentestCrons) {
    cron.schedule(expression.trim(), sendPentestReminder, { timezone: 'UTC' });
  }

  // Daily Encrypted Database Backup at 02:00 UTC
  cron.schedule('0 2 * * *', async () => {
    logger.info('[Scheduler] Running daily encrypted database backup...');
    await dbBackupService.runEncryptedBackup();
  }, { timezone: 'UTC' });

  // Daily Automated SaaS Dunning & Grace Period Check at 04:00 UTC
  cron.schedule('0 4 * * *', async () => {
    logger.info('[Scheduler] Running daily SaaS dunning & subscription grace period audit...');
    try {
      const result = await SubscriptionService.runDunningCheck();
      logger.info(`[Scheduler] Dunning check completed: ${result.processedCount} tenants checked, ${result.suspended.length} suspended, ${result.inGracePeriod.length} in grace period.`);
    } catch (err) {
      logger.error('[Scheduler] SaaS dunning audit failed:', err);
    }
  }, { timezone: 'UTC' });

  logger.info('[Scheduler] Registered jobs: [weekly-audit-digest @ Monday 08:00], [quarterly-pentest-reminder x4], [daily-db-backup @ 02:00 UTC], [daily-saas-dunning @ 04:00 UTC]');
}
