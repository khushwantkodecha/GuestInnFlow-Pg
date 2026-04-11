/**
 * reservationCron.js
 *
 * Background job that auto-expires stale reservations.
 * Runs every hour and flips beds with `reservedTill < now` back to vacant.
 */

const cron = require('node-cron');
const Bed  = require('../models/Bed');

const logger = {
  info:  (event, meta = {}) => console.log(JSON.stringify({ level: 'info',  ts: new Date().toISOString(), event, ...meta })),
  error: (event, meta = {}) => console.error(JSON.stringify({ level: 'error', ts: new Date().toISOString(), event, ...meta })),
};

const expireStaleReservations = async () => {
  try {
    const result = await Bed.updateMany(
      {
        status:       'reserved',
        reservedTill: { $lt: new Date() },
        isActive:     true,
      },
      { $set: {
        status:       'vacant',
        reservedTill: null,
        'reservation.name':       null,
        'reservation.phone':      null,
        'reservation.moveInDate': null,
        'reservation.notes':      null,
      } }
    );

    if (result.modifiedCount > 0) {
      logger.info('cron.reservations_expired', {
        expiredCount: result.modifiedCount,
      });
    }
  } catch (err) {
    logger.error('cron.reservations_expired.failed', {
      error: err.message,
    });
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
