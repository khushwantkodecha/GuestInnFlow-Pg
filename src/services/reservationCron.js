/**
 * reservationCron.js
 *
 * Background job that auto-expires stale reservations.
 * Runs every hour and flips beds with `reservedTill < now` back to vacant.
 *
 * IMPORTANT: must iterate per-bed (not bulk updateMany) so that:
 *   1. Reservation advances are reversed in the ledger.
 *   2. Linked reserved tenants are properly vacated.
 *   3. All state changes are auditable.
 */

const cron           = require('node-cron');
const Bed            = require('../models/Bed');
const Tenant         = require('../models/Tenant');
const LedgerEntry    = require('../models/LedgerEntry');
const { runWithRetry } = require('../utils/runWithRetry');

const logger = {
  info:  (event, meta = {}) => console.log(JSON.stringify({ level: 'info',  ts: new Date().toISOString(), event, ...meta })),
  warn:  (event, meta = {}) => console.warn(JSON.stringify({ level: 'warn',  ts: new Date().toISOString(), event, ...meta })),
  error: (event, meta = {}) => console.error(JSON.stringify({ level: 'error', ts: new Date().toISOString(), event, ...meta })),
};

const expireStaleReservations = async () => {
  let expiredCount   = 0;
  let advancedCount  = 0;
  let errCount       = 0;

  try {
    const expiredBeds = await Bed.find({
      status:       'reserved',
      reservedTill: { $lt: new Date() },
      isActive:     true,
    }).lean();

    if (expiredBeds.length === 0) return;

    logger.info('cron.reservation_expiry.processing', { count: expiredBeds.length });

    for (const expiredBed of expiredBeds) {
      try {
        const advAmt         = expiredBed.reservation?.reservationAmount ?? 0;
        const advMode        = expiredBed.reservation?.reservationMode   ?? null;
        const linkedTenantId = expiredBed.tenant;

        // Fix 6: wrap all per-bed state changes in a single transaction so that
        // a crash midway cannot leave a bed reserved but the tenant already vacated,
        // or an advance reversed but the bed still marked reserved.
        await runWithRetry(async (session) => {
          // ── Reverse the reservation advance credit ──────────────────────────
          // The credit was written at reserve time. The reservation is now expired,
          // so we must debit it back — the tenant never moved in.
          if (advAmt > 0 && linkedTenantId) {
            const linkedTenant = await Tenant.findById(linkedTenantId).select('ledgerBalance property').session(session);
            if (linkedTenant) {
              const prevBal = linkedTenant.ledgerBalance ?? 0;
              const newBal  = prevBal + advAmt;   // debit reverses the earlier credit
              await LedgerEntry.create([{
                tenant:        linkedTenant._id,
                property:      linkedTenant.property,
                type:          'debit',
                amount:        advAmt,
                balanceAfter:  newBal,
                referenceType: 'reservation_refunded',
                referenceId:   expiredBed._id,
                description:   `Reservation advance ₹${advAmt} auto-reversed — reservation expired (${advMode ?? 'unknown'} mode). Operator should manually confirm refund or forfeit.`,
              }], { session });
              await Tenant.updateOne(
                { _id: linkedTenant._id },
                { $set: { ledgerBalance: newBal } },
                { session }
              );
            }
          }

          // ── Vacate the linked reserved tenant ────────────────────────────────
          // Only vacate tenants whose status is still 'reserved'. Active/notice tenants
          // should not be touched — they may have been linked via Path A.
          if (linkedTenantId) {
            await Tenant.updateOne(
              { _id: linkedTenantId, status: 'reserved' },
              { $set: { status: 'vacated', bed: null } },
              { session }
            );
          }

          // ── Free the bed ────────────────────────────────────────────────────
          await Bed.updateOne(
            { _id: expiredBed._id },
            {
              $set: {
                status:                            'vacant',
                reservedTill:                      null,
                tenant:                            null,
                'reservation.tenantId':            null,
                'reservation.name':                null,
                'reservation.phone':               null,
                'reservation.moveInDate':          null,
                'reservation.notes':               null,
                // Preserve reservationAmount/Mode with 'cancelled' status for audit
                'reservation.reservationStatus':   advAmt > 0 ? 'cancelled' : null,
              },
            },
            { session }
          );
        });

        if (advAmt > 0) advancedCount++;
        expiredCount++;
        logger.info('cron.reservation_expiry.bed_freed', {
          bedId: expiredBed._id, linkedTenantId, hadAdvance: advAmt > 0,
        });

      } catch (bedErr) {
        errCount++;
        logger.error('cron.reservation_expiry.bed_error', {
          bedId: expiredBed._id, error: bedErr.message,
        });
      }
    }

    logger.info('cron.reservations_expired', {
      expiredCount,
      advancedCount,
      errCount,
    });

  } catch (err) {
    logger.error('cron.reservations_expired.failed', { error: err.message });
  }
};

/**
 * Start the reservation expiry cron job.
 * Schedule: top of every hour (0 * * * *)
 */
const startReservationCron = () => {
  cron.schedule('0 * * * *', expireStaleReservations, {
    scheduled: true,
    timezone: 'Asia/Kolkata',
  });
  logger.info('cron.reservation_expiry.started', {
    schedule: '0 * * * * (hourly)',
  });
};

module.exports = { startReservationCron, expireStaleReservations };
