/**
 * billingCycleScheduler.js
 *
 * Daily cron job that auto-generates rent records for tenants whose personal
 * billing cycle starts today (i.e., their billingDay == today's day-of-month).
 *
 * Runs at 00:05 IST every day — just after midnight so each tenant's cycle
 * record is created at the start of their billing day.
 *
 * generateRentForProperty handles all deduplication and "future cycle" guards,
 * so calling it daily is safe to re-run if the cron fires more than once.
 *
 * Follows the same pattern as reminderScheduler.js.
 */

const cron    = require('node-cron');
const Tenant  = require('../models/Tenant');
const rentService = require('./rentService');

const logger = {
  info:  (event, meta = {}) =>
    console.log(JSON.stringify({ level: 'info',  ts: new Date().toISOString(), event, ...meta })),
  error: (event, meta = {}) =>
    console.error(JSON.stringify({ level: 'error', ts: new Date().toISOString(), event, ...meta })),
};

/**
 * runBillingCycleGeneration
 *
 * Called by the cron (and optionally from a manual API endpoint for testing).
 * Finds all property IDs that have active tenants whose billingDay matches
 * today, then calls generateRentForProperty for each.
 *
 * generateRentForProperty already skips tenants whose cycle hasn't started
 * or whose record already exists — so safe to call for the full property.
 */
const runBillingCycleGeneration = async () => {
  const today    = new Date();
  const todayDay = today.getDate();
  const month    = today.getMonth() + 1;
  const year     = today.getFullYear();

  // Find properties that have at least one active tenant whose billing day = today
  const tenants = await Tenant.find({
    status: { $in: ['active', 'notice'] },
  }).select('_id property billingStartDate checkInDate').lean();

  // Collect unique property IDs where any tenant has billingDay = todayDay
  const propertySet = new Set();
  for (const t of tenants) {
    const anchor = t.billingStartDate || t.checkInDate;
    if (!anchor) continue;
    const billingDay = new Date(anchor).getDate();
    if (billingDay === todayDay) {
      propertySet.add(t.property.toString());
    }
  }

  if (propertySet.size === 0) {
    return { properties: 0, created: 0, skipped: 0 };
  }

  let totalCreated = 0;
  let totalSkipped = 0;

  for (const propertyId of propertySet) {
    try {
      const result = await rentService.generateRentForProperty(propertyId, month, year);
      totalCreated += result.created.length;
      totalSkipped += result.skipped.length;
    } catch (err) {
      logger.error('cron.billing.property_failed', {
        propertyId,
        error: err.message,
      });
    }
  }

  return { properties: propertySet.size, created: totalCreated, skipped: totalSkipped };
};

const startBillingCycleScheduler = () => {
  // Daily at 00:05 IST — just after midnight
  cron.schedule(
    '5 0 * * *',
    async () => {
      logger.info('cron.billing.started');
      try {
        const stats = await runBillingCycleGeneration();
        logger.info('cron.billing.completed', stats);
      } catch (err) {
        logger.error('cron.billing.failed', { error: err.message });
      }
    },
    { scheduled: true, timezone: 'Asia/Kolkata' }
  );

  logger.info('cron.billing.scheduled', { schedule: '5 0 * * * (daily 00:05 IST)' });
};

module.exports = { startBillingCycleScheduler, runBillingCycleGeneration };
