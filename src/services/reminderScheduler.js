/**
 * reminderScheduler.js
 *
 * Registers the daily reminder cron job.
 * Runs at 09:00 IST every day — after tenants are awake but before business hours.
 *
 * Follows the same pattern as recurringExpenseCron.js.
 */

const cron = require('node-cron');
const { runDailyReminders, retryFailedReminders } = require('./reminderService');

const logger = {
  info:  (event, meta = {}) =>
    console.log(JSON.stringify({ level: 'info',  ts: new Date().toISOString(), event, ...meta })),
  error: (event, meta = {}) =>
    console.error(JSON.stringify({ level: 'error', ts: new Date().toISOString(), event, ...meta })),
};

const startReminderScheduler = () => {
  // Daily at 09:00 IST
  cron.schedule(
    '0 9 * * *',
    async () => {
      logger.info('cron.reminders.started');
      try {
        const stats = await runDailyReminders();
        logger.info('cron.reminders.completed', stats);
      } catch (err) {
        logger.error('cron.reminders.failed', { error: err.message });
      }
    },
    { scheduled: true, timezone: 'Asia/Kolkata' }
  );

  logger.info('cron.reminders.scheduled', { schedule: '0 9 * * * (daily 09:00 IST)' });

  // Retry failed reminders at 10:00 IST — 1 hour after the main run.
  // Finds failed logs from the last 24 h with retryCount < 3 and re-attempts delivery.
  cron.schedule(
    '0 10 * * *',
    async () => {
      logger.info('cron.reminders_retry.started');
      try {
        const stats = await retryFailedReminders();
        logger.info('cron.reminders_retry.completed', stats);
      } catch (err) {
        logger.error('cron.reminders_retry.failed', { error: err.message });
      }
    },
    { scheduled: true, timezone: 'Asia/Kolkata' }
  );

  logger.info('cron.reminders_retry.scheduled', { schedule: '0 10 * * * (daily 10:00 IST)' });
};

module.exports = { startReminderScheduler };
