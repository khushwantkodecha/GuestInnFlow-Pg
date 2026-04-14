/**
 * overdueSyncScheduler.js
 *
 * Nightly cron that flips all pending/partial RentPayments whose dueDate has
 * passed to 'overdue' — across every active property.
 *
 * Without this cron, overdue status is only set lazily when a read endpoint
 * is called for a specific property. Direct DB reads, reporting queries, and
 * dashboards that bypass the API would see stale 'pending' statuses.
 *
 * Runs at 01:00 IST every night — after billingCycleScheduler (00:05 IST) so
 * any rent records generated today are already in place before the overdue sweep.
 *
 * syncOverdueRents is idempotent — safe to call multiple times for the same property.
 */

const cron        = require('node-cron');
const Property    = require('../models/Property');
const rentService = require('./rentService');

const logger = {
  info:  (event, meta = {}) =>
    console.log(JSON.stringify({ level: 'info',  ts: new Date().toISOString(), event, ...meta })),
  error: (event, meta = {}) =>
    console.error(JSON.stringify({ level: 'error', ts: new Date().toISOString(), event, ...meta })),
};

/**
 * runOverdueSyncForAll
 *
 * Fetches every active property and calls syncOverdueRents for each.
 * Per-property errors are caught and logged — one failure does not stop others.
 *
 * Returns: { properties: number, updated: number }
 */
const runOverdueSyncForAll = async () => {
  const properties = await Property.find({ isActive: true }).select('_id').lean();

  if (properties.length === 0) {
    return { properties: 0, updated: 0 };
  }

  let totalUpdated = 0;

  for (const { _id: propertyId } of properties) {
    try {
      const updated = await rentService.syncOverdueRents(propertyId);
      totalUpdated += updated;
    } catch (err) {
      logger.error('cron.overdue_sync.property_failed', {
        propertyId: propertyId.toString(),
        error:      err.message,
      });
    }
  }

  return { properties: properties.length, updated: totalUpdated };
};

const startOverdueSyncScheduler = () => {
  // Nightly at 01:00 IST — after billing cycle cron (00:05 IST)
  cron.schedule(
    '0 1 * * *',
    async () => {
      logger.info('cron.overdue_sync.started');
      try {
        const stats = await runOverdueSyncForAll();
        logger.info('cron.overdue_sync.completed', stats);
      } catch (err) {
        logger.error('cron.overdue_sync.failed', { error: err.message });
      }
    },
    { scheduled: true, timezone: 'Asia/Kolkata' }
  );

  logger.info('cron.overdue_sync.scheduled', { schedule: '0 1 * * * (nightly 01:00 IST)' });
};

module.exports = { startOverdueSyncScheduler, runOverdueSyncForAll };
