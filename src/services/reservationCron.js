/**
 * reservationCron.js
 *
 * Background job that auto-expires stale reservations.
 * Runs every hour and flips beds with `reservedTill < now` back to vacant.
 *
 * IMPORTANT: must iterate per-bed (not bulk updateMany) so that:
 *   1. Linked reserved tenants are properly vacated.
 *   2. Reservation documents are marked 'expired'.
 *   3. All state changes are auditable.
 *
 * No LedgerEntry is written here — advance amounts were stored only in
 * tenant.reservationAmount (not in the ledger) at reservation time.
 * The amount is cleared on expiry; the operator should reconcile refunds manually.
 */

const cron           = require('node-cron');
const Bed            = require('../models/Bed');
const Tenant         = require('../models/Tenant');
const Reservation    = require('../models/Reservation');
const Room           = require('../models/Room');
const { runWithRetry } = require('../utils/runWithRetry');
const { sendReservationExpiredEmail } = require('./emailService');

const logger = {
  info:  (event, meta = {}) => console.log(JSON.stringify({ level: 'info',  ts: new Date().toISOString(), event, ...meta })),
  warn:  (event, meta = {}) => console.warn(JSON.stringify({ level: 'warn',  ts: new Date().toISOString(), event, ...meta })),
  error: (event, meta = {}) => console.error(JSON.stringify({ level: 'error', ts: new Date().toISOString(), event, ...meta })),
};

const expireStaleReservations = async () => {
  let expiredCount  = 0;
  let errCount      = 0;

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
        const linkedTenantId = expiredBed.tenant;

        await runWithRetry(async (session) => {
          // ── Vacate the linked reserved tenant ────────────────────────────────
          // Only vacate tenants still in 'reserved' status.
          // Clear reservationAmount — operator must reconcile refund/forfeit separately.
          if (linkedTenantId) {
            await Tenant.updateOne(
              { _id: linkedTenantId, status: 'reserved' },
              { $set: { status: 'vacated', bed: null, reservationAmount: 0 } },
              { session }
            );
          }

          // ── Free the bed ────────────────────────────────────────────────────
          await Bed.updateOne(
            { _id: expiredBed._id },
            {
              $set: {
                status:       'vacant',
                reservedTill: null,
                tenant:       null,
                'reservation.tenantId':          null,
                'reservation.name':              null,
                'reservation.phone':             null,
                'reservation.moveInDate':        null,
                'reservation.notes':             null,
                'reservation.reservationStatus': advAmt > 0 ? 'cancelled' : null,
              },
            },
            { session }
          );
        });

        // ── Mark Reservation document as expired ─────────────────────────────
        await Reservation.updateOne(
          { tenant: linkedTenantId, bed: expiredBed._id, status: 'active' },
          { $set: { status: 'expired', expiredAt: new Date() } }
        );

        expiredCount++;
        logger.info('cron.reservation_expiry.bed_freed', {
          bedId: expiredBed._id, linkedTenantId, hadAdvance: advAmt > 0,
        });

        // Notify tenant by email (non-blocking)
        if (linkedTenantId) {
          try {
            const expiredTenant = await Tenant.findById(linkedTenantId).select('name email').lean();
            const expiredRoom   = await Room.findById(expiredBed.room).select('roomNumber').lean();
            if (expiredTenant?.email && expiredRoom) {
              sendReservationExpiredEmail({
                name:         expiredTenant.name,
                email:        expiredTenant.email,
                roomNumber:   expiredRoom.roomNumber,
                bedNumber:    expiredBed.bedNumber,
                reservedTill: expiredBed.reservedTill,
                advanceAmount: advAmt,
              }).catch(() => {});
            }
          } catch (_) {}
        }

      } catch (bedErr) {
        errCount++;
        logger.error('cron.reservation_expiry.bed_error', {
          bedId: expiredBed._id, error: bedErr.message,
        });
      }
    }

    logger.info('cron.reservations_expired', { expiredCount, errCount });

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
  logger.info('cron.reservation_expiry.started', { schedule: '0 * * * * (hourly)' });
};

module.exports = { startReservationCron, expireStaleReservations };
