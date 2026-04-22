/**
 * recalculateRoomRent — recalculates and persists rentAmount for every
 * occupied tenant in a room after an occupancy-changing event.
 *
 * Delegates all per-tenant math to the shared calculateRent engine so the
 * two are always in sync.
 *
 * @param {Object}  room      — mongoose Room document (baseRent, rentType, capacity)
 * @param {Object}  session   — mongoose ClientSession, or null outside transactions
 * @param {string}  reason    — 'assign' | 'vacate' | 'change_room' | 'extra_bed_change'
 *                              | 'base_rent_update' | 'rent_type_update'
 * @param {string}  [traceId] — reuse caller's traceId, or auto-generate one
 */

const crypto  = require('crypto');
const Bed     = require('../models/Bed');
const { calculateRent } = require('../../shared/calculateRent');

const logger = {
  info: (event, meta = {}) => console.log(JSON.stringify({ level: 'info', ts: new Date().toISOString(), event, ...meta })),
  warn: (event, meta = {}) => console.warn(JSON.stringify({ level: 'warn', ts: new Date().toISOString(), event, ...meta })),
};

const recalculateRoomRent = async (room, session, reason, traceId) => {
  const tid = traceId ?? crypto.randomUUID();

  // Fetch all active occupied beds, populating tenant for update.
  // Fix 4: pass session so this read participates in the caller's transaction
  // snapshot and sees the session's own prior writes (e.g. the vacating bed's
  // status was just changed to 'vacant' inside the same transaction).
  const bedQuery = Bed.find({
    room:     room._id,
    isActive: true,
    status:   'occupied',
  }).populate('tenant', 'rentAmount billingSnapshot rentHistory');
  if (session) bedQuery.session(session);
  const occupiedBeds = await bedQuery;

  const normalBeds  = occupiedBeds.filter((b) => !b.isExtra);
  const extraBeds   = occupiedBeds.filter((b) => b.isExtra);
  const normalCount = normalBeds.length;

  const saves = [];

  // ── Normal beds ──────────────────────────────────────────────────────────────
  for (const bed of normalBeds) {
    if (!bed.tenant) continue;

    const oldRent = bed.tenant.rentAmount ?? 0;   // capture BEFORE overwriting

    const { finalRent, source, meta } = calculateRent({
      room,
      bed,
      normalOccupied: normalCount,
    });

    const overrideApplied = source === 'override';

    bed.tenant.rentAmount      = finalRent;
    bed.tenant.billingSnapshot = {
      baseRent:        room.baseRent,
      rentType:        'per_bed',
      roomCapacity:    room.capacity,
      divisorUsed:     null,
      overrideApplied,
      overrideSource:  overrideApplied ? 'bed' : null,
      isExtra:         false,
      isChargeable:    true,
      extraCharge:     null,
      source,
      finalRent,
      traceId:         tid,
      assignedAt:      bed.tenant.billingSnapshot?.assignedAt ?? new Date(),
    };
    bed.tenant.rentHistory = [
      ...(bed.tenant.rentHistory ?? []),
      {
        oldRent,
        newRent:     finalRent,
        source,
        divisorUsed: null,
        reason,
        traceId:     tid,
        changedAt:   new Date(),
      },
    ];

    saves.push(bed.tenant.save({ session }));
  }

  // ── Extra beds ───────────────────────────────────────────────────────────────
  for (const bed of extraBeds) {
    if (!bed.tenant) continue;

    const oldRent = bed.tenant.rentAmount ?? 0;   // capture BEFORE overwriting

    // Extra beds never participate in the per-room divisor
    const { finalRent, source } = calculateRent({
      room,
      bed,
      normalOccupied: 0,
    });

    bed.tenant.rentAmount      = finalRent;
    bed.tenant.billingSnapshot = {
      baseRent:        room.baseRent,
      rentType:        room.rentType,
      roomCapacity:    room.capacity,
      divisorUsed:     null,
      overrideApplied: source === 'override',
      overrideSource:  null,
      isExtra:         true,
      isChargeable:    bed.isChargeable,
      extraCharge:     bed.extraCharge,
      source,
      finalRent,
      traceId:         tid,
      assignedAt:      bed.tenant.billingSnapshot?.assignedAt ?? new Date(),
    };
    bed.tenant.rentHistory = [
      ...(bed.tenant.rentHistory ?? []),
      { oldRent, newRent: finalRent, source, divisorUsed: null, reason, traceId: tid, changedAt: new Date() },
    ];

    saves.push(bed.tenant.save({ session }));
  }

  await Promise.all(saves);

  logger.info('rent.recalculated', {
    traceId:     tid,
    roomId:      room._id,
    reason,
    baseRent:    room.baseRent,
    normalCount,
    extraCount:  extraBeds.length,
    affected:    saves.length,
  });

  return tid;
};

module.exports = { recalculateRoomRent };
