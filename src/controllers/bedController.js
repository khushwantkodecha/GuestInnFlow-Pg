const crypto      = require('crypto');
const Bed         = require('../models/Bed');
const Room        = require('../models/Room');
const Property    = require('../models/Property');
const Tenant      = require('../models/Tenant');
const RentPayment  = require('../models/RentPayment');
const LedgerEntry  = require('../models/LedgerEntry');
const asyncHandler = require('../utils/asyncHandler');
const { runWithRetry } = require('../utils/runWithRetry');
const { generateBedLabel } = require('../utils/numberingUtils');
const { recalculateRoomRent } = require('../utils/recalculateRoomRent');
const { calculateRent }       = require('../../shared/calculateRent');
const rentService             = require('../services/rentService');
const { vacateBedCore }       = require('../services/vacateService');

// ── Minimal structured logger ────────────────────────────────────────────────
const logger = {
  info:  (event, meta = {}) => console.log(JSON.stringify({ level: 'info',  ts: new Date().toISOString(), event, ...meta })),
  warn:  (event, meta = {}) => console.warn(JSON.stringify({ level: 'warn', ts: new Date().toISOString(), event, ...meta })),
  error: (event, meta = {}) => console.error(JSON.stringify({ level: 'error', ts: new Date().toISOString(), event, ...meta })),
};

// ── Constants ────────────────────────────────────────────────────────────────
// Non-dormitory types have a fixed capacity — no manual bed add/remove allowed
const FIXED_CAPACITY_TYPES = new Set(['single', 'double', 'triple']);
const MAX_EXTRA_BEDS_PER_ROOM = 2;

// recalculateRoomRent is shared with roomController — lives in utils/

// Verify the room exists and belongs to a property owned by the user
const verifyRoomOwnership = async (roomId, propertyId, userId) => {
  const property = await Property.findOne({ _id: propertyId, owner: userId, isActive: true });
  if (!property) return null;
  const room = await Room.findOne({ _id: roomId, property: propertyId, isActive: true });
  return room;
};

// Fetch an active bed by id+room, populating tenant with necessary fields
const fetchBed = (bedId, roomId) =>
  Bed.findOne({ _id: bedId, room: roomId, isActive: true })
    .populate('tenant', 'name phone status checkInDate billingStartDate rentAmount depositAmount bed billingSnapshot');

// GET /api/properties/:propertyId/rooms/:roomId/beds
const getBeds = asyncHandler(async (req, res) => {
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  const { status } = req.query;
  const filter = { room: req.params.roomId, isActive: true };
  if (status) filter.status = status;

  const beds = await Bed.find(filter)
    .collation({ locale: 'en', numericOrdering: true })
    .sort({ isExtra: 1, bedNumber: 1 })
    .populate('tenant', 'name phone status checkInDate billingStartDate rentAmount depositAmount depositPaid depositReturned billingSnapshot profileStatus aadharNumber address emergencyContact ledgerBalance bed');

  // ── Freshen ledgerBalance from LedgerEntry (avoids stale-cache mismatch) ─────
  // The cached tenant.ledgerBalance can lag behind when payments are recorded on
  // another page. One aggregation fetch per room-load keeps the tooltip accurate.
  const tenantsInBeds = beds.filter(b => b.tenant?._id);
  if (tenantsInBeds.length > 0) {
    const tenantIds = tenantsInBeds.map(b => b.tenant._id);
    const latestEntries = await LedgerEntry.aggregate([
      { $match: { tenant: { $in: tenantIds } } },
      { $sort:  { createdAt: -1 } },
      { $group: { _id: '$tenant', balanceAfter: { $first: '$balanceAfter' } } },
    ]);
    const balanceMap = new Map(latestEntries.map(e => [e._id.toString(), e.balanceAfter]));
    for (const bed of tenantsInBeds) {
      const fresh = balanceMap.get(bed.tenant._id.toString());
      if (fresh !== undefined) bed.tenant.ledgerBalance = fresh;
    }
  }

  res.json({ success: true, count: beds.length, data: beds });
});

// GET /api/properties/:propertyId/rooms/:roomId/beds/:id
const getBed = asyncHandler(async (req, res) => {
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  const bed = await Bed.findOne({ _id: req.params.id, room: req.params.roomId })
    .populate('tenant', 'name phone status checkInDate rentAmount billingSnapshot');
  if (!bed) {
    return res.status(404).json({ success: false, message: 'Bed not found' });
  }
  res.json({ success: true, data: bed });
});

// POST /api/properties/:propertyId/rooms/:roomId/beds
// Only allowed for dormitory rooms
const createBed = asyncHandler(async (req, res) => {
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  // ── Capacity guard: non-dormitory rooms have fixed beds ──────────────────────
  if (FIXED_CAPACITY_TYPES.has(room.type)) {
    return res.status(400).json({
      success: false,
      message: `Cannot add beds to a ${room.type} room — capacity is fixed at ${room.capacity}. Use "Add Extra Bed" instead.`,
      code: 'FIXED_CAPACITY',
    });
  }

  // ── Dormitory: enforce max capacity ─────────────────────────────────────────
  const normalBedCount = await Bed.countDocuments({
    room: req.params.roomId,
    isExtra: false,
    isActive: true,
  });
  if (normalBedCount >= room.capacity) {
    return res.status(400).json({
      success: false,
      message: `Room is at full capacity (${room.capacity} beds). Increase room capacity or add an extra bed.`,
      code: 'CAPACITY_FULL',
    });
  }

  // Auto-generate the next bed label using the room's bedNumberingType
  const bnType = room.bedNumberingType ?? 'alphabet';
  const bedNumber = generateBedLabel(bnType, normalBedCount);

  // Collision guard — in case of gaps from manual deletions
  const collision = await Bed.findOne({ room: req.params.roomId, bedNumber, isActive: true });
  if (collision) {
    return res.status(409).json({
      success: false,
      message: `Bed label "${bedNumber}" already exists in this room`,
      code:    'BED_DUPLICATE',
    });
  }

  const bed = await Bed.create({
    room:      req.params.roomId,
    property:  req.params.propertyId,
    bedNumber,
    isExtra:   false,
    status:    ['maintenance', 'blocked'].includes(room.status) ? 'blocked' : 'vacant',
  });
  res.status(201).json({ success: true, data: bed });
});

// POST /api/properties/:propertyId/rooms/:roomId/beds/extra
// Allowed for all room types — creates a temporary overflow bed
const createExtraBed = asyncHandler(async (req, res) => {
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  // ── Purge stale soft-deleted extras to free up label slots ──────────────────
  // Without this, the unique index on { room, bedNumber } would reject reuse of
  // X1/X2 labels even after a soft delete, causing a spurious E11000 error.
  await Bed.deleteMany({ room: req.params.roomId, isExtra: true, isActive: false });

  // ── Check extra bed limit (active only) ─────────────────────────────────────
  const existingExtras = await Bed.find({
    room:     req.params.roomId,
    isExtra:  true,
    isActive: true,
  }).select('bedNumber').sort({ createdAt: 1 });

  if (existingExtras.length >= MAX_EXTRA_BEDS_PER_ROOM) {
    logger.warn('bed.extra.limit_exceeded', {
      roomId:  req.params.roomId,
      limit:   MAX_EXTRA_BEDS_PER_ROOM,
      current: existingExtras.length,
      userId:  req.user._id,
    });
    return res.status(400).json({
      success: false,
      message: `Maximum ${MAX_EXTRA_BEDS_PER_ROOM} extra beds allowed per room`,
      code:    'EXTRA_BED_LIMIT',
    });
  }

  // ── Gap-filling label assignment (X1 → X2, fills gaps left by deletions) ────
  const usedLabels = new Set(existingExtras.map((b) => b.bedNumber));
  let bedNumber;
  for (let i = 1; i <= MAX_EXTRA_BEDS_PER_ROOM; i++) {
    if (!usedLabels.has(`X${i}`)) { bedNumber = `X${i}`; break; }
  }
  if (!bedNumber) {
    // Defensive: should be caught by length check above, but guard anyway
    return res.status(400).json({
      success: false,
      message: `Maximum ${MAX_EXTRA_BEDS_PER_ROOM} extra beds allowed per room`,
      code:    'EXTRA_BED_LIMIT',
    });
  }

  const { isChargeable = true, extraCharge = 0 } = req.body;

  const bed = await Bed.create({
    room:         req.params.roomId,
    property:     req.params.propertyId,
    bedNumber,
    isExtra:      true,
    isChargeable: Boolean(isChargeable),
    extraCharge:  Number(extraCharge) || 0,
    status:       'vacant',
  });

  logger.info('bed.extra.created', {
    bedId:        bed._id,
    bedNumber:    bed.bedNumber,
    roomId:       req.params.roomId,
    isChargeable: bed.isChargeable,
    extraCharge:  bed.extraCharge,
    userId:       req.user._id,
  });

  // Rule 3 — recalculate after extra bed is added (no-op when room is empty,
  // but ensures any future edge-case doesn't leave rents stale).
  const rcTraceId = crypto.randomUUID();
  recalculateRoomRent(room, null, 'extra_bed_change', rcTraceId)
    .catch((err) => logger.warn('bed.extra.recalc_failed', {
      bedId: bed._id, roomId: req.params.roomId, traceId: rcTraceId, error: err.message,
    }));

  res.status(201).json({ success: true, data: bed });
});

// PATCH /api/properties/:propertyId/rooms/:roomId/beds/:id/extra-settings
// Update isChargeable / extraCharge on an existing extra bed.
// Triggers rent recalculation so the assigned tenant's rentAmount stays in sync.
const updateExtraBedSettings = asyncHandler(async (req, res) => {
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  const bed = await Bed.findOne({ _id: req.params.id, room: req.params.roomId, isActive: true });
  if (!bed) return res.status(404).json({ success: false, message: 'Bed not found' });
  if (!bed.isExtra) {
    return res.status(400).json({ success: false, message: 'This bed is not an extra bed' });
  }

  const { isChargeable, extraCharge } = req.body;
  if (isChargeable === undefined && extraCharge === undefined) {
    return res.status(400).json({ success: false, message: 'Provide isChargeable or extraCharge to update' });
  }

  if (isChargeable !== undefined) bed.isChargeable = Boolean(isChargeable);
  if (extraCharge  !== undefined) bed.extraCharge  = Math.max(0, Number(extraCharge) || 0);
  await bed.save();

  // Recalculate rent synchronously so the response carries the updated rentAmount.
  // The frontend refetches beds immediately after save — awaiting here guarantees
  // the tenant's rentAmount is already updated when that refetch lands.
  const rcTraceId = crypto.randomUUID();
  try {
    await recalculateRoomRent(room, null, 'extra_bed_change', rcTraceId);
  } catch (err) {
    logger.warn('bed.extra.recalc_failed', {
      bedId: bed._id, roomId: req.params.roomId, traceId: rcTraceId, error: err.message,
    });
  }

  // Sync the current-month RentPayment + ledger after the charge change.
  // recalculateRoomRent only updates tenant.rentAmount — it doesn't touch existing
  // RentPayment records. This sync ensures the Rent page and Due balance stay accurate.
  if (bed.status === 'occupied' && bed.tenant) {
    try {
      // Re-read tenant AFTER recalculation to get the updated rentAmount.
      const freshTenant = await Tenant.findById(bed.tenant)
        .select('_id rentAmount property')
        .lean();

      if (!freshTenant) {
        logger.warn('bed.extra.sync_no_tenant', { bedId: bed._id });
      } else {
        const now       = new Date();
        const month     = now.getMonth() + 1;
        const year      = now.getFullYear();
        const newAmount = freshTenant.rentAmount;

        logger.info('bed.extra.sync_start', {
          bedId: bed._id, tenantId: freshTenant._id, newAmount, month, year,
        });

        const pendingPayment = await RentPayment.findOne({
          tenant: freshTenant._id,
          month,
          year,
          status: { $in: ['pending', 'overdue'] },
        });

        if (!pendingPayment && newAmount > 0) {
          // No existing payment but charge was just enabled — create one now.
          await rentService.ensureCurrentCycleRentForTenant(freshTenant._id, freshTenant.property);
          logger.info('bed.extra.sync_created_payment', {
            bedId: bed._id, tenantId: freshTenant._id, newAmount,
          });

        } else if (pendingPayment) {
          const oldAmount = pendingPayment.amount;
          const diff      = newAmount - oldAmount;

          logger.info('bed.extra.sync_found_payment', {
            bedId: bed._id, tenantId: freshTenant._id,
            paymentId: pendingPayment._id, oldAmount, newAmount, diff,
          });

          if (diff !== 0) {
            // Step 1 — update the RentPayment amount atomically (bypasses pre-save hook
            // issues; we also update `balance` directly to keep it consistent).
            await RentPayment.updateOne(
              { _id: pendingPayment._id },
              { $set: {
                amount:  newAmount,
                balance: Math.max(0, newAmount - (pendingPayment.paidAmount ?? 0)),
              }}
            );
            logger.info('bed.extra.sync_payment_updated', {
              bedId: bed._id, tenantId: freshTenant._id, oldAmount, newAmount,
            });

            // Step 2 — append an adjustment LedgerEntry + update ledgerBalance cache.
            // These are best-effort: payment was already updated; a ledger failure
            // leaves only the cached balance stale, which self-corrects on next fetch.
            try {
              // Use the live ledger balance (latest LedgerEntry.balanceAfter) rather than
              // the potentially stale tenant.ledgerBalance field.
              const currentBalance = await rentService.getTenantBalance(freshTenant._id);
              const newBalance     = currentBalance + diff;

              await LedgerEntry.create({
                tenant:        freshTenant._id,
                property:      freshTenant.property,
                type:          diff > 0 ? 'debit' : 'credit',
                amount:        Math.abs(diff),
                balanceAfter:  newBalance,
                referenceType: 'adjustment',
                referenceId:   pendingPayment._id,
                description:   `Extra bed charge updated (${bed.bedNumber}): ₹${oldAmount} → ₹${newAmount}`,
              });

              await Tenant.findByIdAndUpdate(freshTenant._id, { ledgerBalance: newBalance });

              logger.info('bed.extra.sync_ledger_updated', {
                bedId: bed._id, tenantId: freshTenant._id,
                oldBalance: currentBalance, newBalance,
              });
            } catch (ledgerErr) {
              // Ledger update is non-fatal — payment amount is already corrected.
              logger.warn('bed.extra.sync_ledger_failed', {
                bedId: bed._id, tenantId: freshTenant._id, error: ledgerErr.message,
              });
            }
          }
        } else {
          // newAmount = 0 and no pending payment — nothing to sync.
          logger.info('bed.extra.sync_skipped', {
            bedId: bed._id, tenantId: freshTenant._id,
            reason: 'amount=0 and no pending payment',
          });
        }
      }
    } catch (syncErr) {
      logger.warn('bed.extra.sync_failed', {
        bedId: bed._id, roomId: req.params.roomId, error: syncErr.message,
      });
    }
  }

  logger.info('bed.extra.settings_updated', {
    bedId:        bed._id,
    bedNumber:    bed.bedNumber,
    roomId:       req.params.roomId,
    isChargeable: bed.isChargeable,
    extraCharge:  bed.extraCharge,
    userId:       req.user._id,
  });

  res.json({ success: true, data: bed });
});

// PUT /api/properties/:propertyId/rooms/:roomId/beds/:id
const updateBed = asyncHandler(async (req, res) => {
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  // Prevent manually overriding status/tenant via generic update
  const { status, tenant, isExtra, ...safeUpdate } = req.body;

  const bed = await Bed.findOneAndUpdate(
    { _id: req.params.id, room: req.params.roomId },
    safeUpdate,
    { new: true, runValidators: true }
  );
  if (!bed) {
    return res.status(404).json({ success: false, message: 'Bed not found' });
  }
  res.json({ success: true, data: bed });
});

// DELETE /api/properties/:propertyId/rooms/:roomId/beds/:id  — soft delete
const deleteBed = asyncHandler(async (req, res) => {
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found', code: 'ROOM_NOT_FOUND' });
  }

  const bed = await Bed.findOne({ _id: req.params.id, room: req.params.roomId });
  if (!bed) {
    return res.status(404).json({ success: false, message: 'Bed not found', code: 'BED_NOT_FOUND' });
  }

  if (bed.status === 'occupied') {
    return res.status(400).json({
      success: false,
      message: 'Vacate the tenant before removing this bed.',
      code: 'BED_OCCUPIED',
    });
  }

  // ── Extra bed blocked: must unblock first ────────────────────────────────────
  if (bed.isExtra && bed.status === 'blocked') {
    return res.status(400).json({
      success: false,
      message: 'Cannot remove extra bed unless it is vacant. Unblock it first.',
      code: 'EXTRA_BED_REMOVE_BLOCKED',
    });
  }

  // ── Reserved: block unless the reservation has expired ──────────────────────
  if (bed.status === 'reserved') {
    const isExpired = bed.reservedTill && new Date(bed.reservedTill) < new Date();
    if (!isExpired) {
      return res.status(400).json({
        success: false,
        message: 'Cancel the reservation before removing this bed.',
        code: 'BED_RESERVED',
      });
    }

    // Reservation is expired — clean up stale links before deactivating
    logger.warn('bed.delete.expired_reservation_cleanup', {
      bedId: bed._id, roomId: room._id, reservedTill: bed.reservedTill,
    });
    if (bed.tenant) {
      // Reserved tenant linked to an expired hold — clear their bed reference
      await Tenant.findOneAndUpdate(
        { _id: bed.tenant, status: 'reserved' },
        { $unset: { bed: 1 }, $set: { status: 'vacated', reservationAmount: 0 } },
      );
    }
    bed.tenant       = undefined;
    bed.reservation  = undefined;
    bed.reservedTill = undefined;
    bed.status       = 'vacant';
  }

  // ── Fixed-capacity rooms: only extra beds may be deleted ────────────────────
  if (!bed.isExtra && FIXED_CAPACITY_TYPES.has(room.type)) {
    return res.status(400).json({
      success: false,
      message: `Cannot remove a normal bed from a ${room.type} room — capacity is fixed.`,
      code: 'FIXED_CAPACITY',
    });
  }

  bed.isActive = false;
  await bed.save();

  logger.info('bed.deleted', {
    bedId:   bed._id,
    isExtra: bed.isExtra,
    roomId:  req.params.roomId,
    userId:  req.user._id,
  });

  // Rule 3 — recalculate after an extra bed is removed so per-room normal
  // tenants can be re-checked (extra beds don't affect the divisor, but
  // keeping this symmetric with createExtraBed prevents any future drift).
  if (bed.isExtra) {
    const rcTraceId = crypto.randomUUID();
    recalculateRoomRent(room, null, 'extra_bed_change', rcTraceId)
      .catch((err) => logger.warn('bed.delete.recalc_failed', {
        bedId: bed._id, roomId: req.params.roomId, traceId: rcTraceId, error: err.message,
      }));
  }

  res.json({ success: true, message: 'Bed deactivated' });
});

// PATCH /api/properties/:propertyId/rooms/:roomId/beds/:id/assign
// Body: { tenantId, rentOverride?, deposit?, depositCollected?, moveInDate? }
// depositCollected (default: true) — when false, deposit amount is saved on the tenant
// as an expected/pending deposit but NOT marked as paid (no ledger entry written).
const assignBed = asyncHandler(async (req, res) => {
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  const { tenantId, rentOverride, deposit, depositCollected, moveInDate, advanceDisposition } = req.body;
  // advanceDisposition: 'adjust' (default) | 'convert_deposit' | 'keep'
  // Only relevant when bed is reserved and has a reservation advance > 0.

  const bed = await fetchBed(req.params.id, req.params.roomId);
  if (!bed) {
    return res.status(404).json({ success: false, message: 'Bed not found' });
  }

  if (bed.status === 'occupied') {
    logger.warn('bed.assign.already_occupied', { bedId: bed._id, roomId: req.params.roomId });
    return res.status(409).json({
      success: false,
      message: 'Bed is already occupied',
      code: 'BED_NOT_AVAILABLE',
    });
  }

  if (bed.status === 'blocked') {
    return res.status(409).json({
      success: false,
      message: 'Bed is blocked. Unblock it before assigning.',
      code: 'BED_NOT_AVAILABLE',
    });
  }

  // Accept vacant OR reserved
  if (bed.status !== 'vacant' && bed.status !== 'reserved') {
    return res.status(409).json({
      success: false,
      message: `Bed status '${bed.status}' does not allow assignment`,
      code: 'INVALID_STATE',
    });
  }

  const tenant = await Tenant.findOne({ _id: tenantId, property: req.params.propertyId });
  if (!tenant) {
    return res.status(404).json({
      success: false,
      message: 'Tenant not found in this property',
      code: 'TENANT_NOT_FOUND',
    });
  }

  if (tenant.status === 'merged') {
    return res.status(409).json({
      success: false,
      message: 'Cannot assign a merged tenant to a bed. Use the active profile this tenant was merged into.',
      code: 'TENANT_MERGED',
    });
  }

  // Fix 7: block vacated tenants — they must be explicitly reactivated before reassignment.
  // Heal any stale bed reference first so it does not pollute future queries, then reject.
  if (tenant.status === 'vacated') {
    if (tenant.bed) {
      logger.warn('assign.stale_bed_ref.heal', { tenantId: tenant._id, staleBed: tenant.bed });
      tenant.bed = null;
      await tenant.save();
    }
    return res.status(409).json({
      success: false,
      message: 'Cannot assign a vacated tenant to a bed. Create a new tenant record or reuse an existing active profile.',
      code: 'TENANT_VACATED',
    });
  }

  // Authoritative check: query the Bed collection, not tenant.bed (which can be stale)
  const existingAssignment = await Bed.findOne({ tenant: tenantId, status: 'occupied', isActive: true });
  if (existingAssignment) {
    logger.warn('bed.assign.tenant_already_assigned', { tenantId, existingBedId: existingAssignment._id });
    return res.status(400).json({
      success: false,
      message: 'Tenant is already assigned to a bed. Check out first.',
      code: 'TENANT_ALREADY_ASSIGNED',
    });
  }

  // ── Billing anchor guard ───────────────────────────────────────────────────
  // checkInDate is the immutable anchor for all billing cycle calculations.
  // Reject activation if neither the request body nor the existing tenant doc has one.
  if (!moveInDate && !tenant.checkInDate) {
    return res.status(400).json({
      success: false,
      message:  'moveInDate (check-in date) is required to activate a tenant. Billing cycles cannot be calculated without it.',
      code:     'CHECKIN_DATE_REQUIRED',
    });
  }

  // ── Room configuration guard ───────────────────────────────────────────────
  if (!room.baseRent || room.baseRent <= 0 || !room.capacity || room.capacity < 1) {
    logger.error('bed.assign.invalid_room_config', {
      roomId: req.params.roomId, baseRent: room.baseRent, capacity: room.capacity,
    });
    return res.status(400).json({
      success: false,
      message: 'Invalid room configuration: baseRent and capacity must be positive',
      code: 'INVALID_ROOM_CONFIG',
    });
  }

  // ── Hard assignment guard — overflow protection ────────────────────────────
  const totalActiveBeds = await Bed.countDocuments({ room: req.params.roomId, isActive: true });
  const totalOccupied   = await Bed.countDocuments({ room: req.params.roomId, isActive: true, status: 'occupied' });
  if (totalOccupied >= totalActiveBeds) {
    logger.warn('bed.assign.room_full', {
      roomId:    req.params.roomId,
      totalBeds: totalActiveBeds,
      occupied:  totalOccupied,
      userId:    req.user._id,
    });
    return res.status(409).json({
      success: false,
      message: 'All beds in this room are occupied. Add an extra bed or vacate a tenant first.',
      code: 'ROOM_FULL',
    });
  }

  // ── Apply any request-level rent override to the bed before recalculation ──
  // An override from the assign request body is stored on the bed as rentOverride
  // so that recalculateRoomRent picks it up consistently.
  const hasBodyOverride = rentOverride !== undefined && rentOverride !== null && rentOverride !== '';
  if (hasBodyOverride && !bed.isExtra) {
    bed.rentOverride = Number(rentOverride);
  }

  // ── Capture advance before clearing reservation ───────────────────────────
  const capturedAdvAmt  = bed.reservation?.reservationAmount ?? 0;
  const capturedAdvMode = bed.reservation?.reservationMode   ?? null;

  // ── Orphan cleanup: if bed was reserved for a DIFFERENT reserved tenant, free them ─
  // CRITICAL: if the displaced tenant had a reservation advance, reverse the ledger credit
  // so their balance returns to 0. Without this the money is invisibly "lost" in the ledger.
  if (bed.status === 'reserved' && bed.tenant && String(bed.tenant) !== String(tenantId)) {
    const orphanedLead = await Tenant.findOne({ _id: bed.tenant, status: 'reserved' });
    if (orphanedLead) {
      const orphanAdvAmt  = bed.reservation?.reservationAmount ?? 0;
      const orphanAdvMode = bed.reservation?.reservationMode   ?? null;

      // Reverse the earlier reservation_paid credit so the orphaned tenant's balance → 0
      if (orphanAdvAmt > 0) {
        const prevOrphanBal = await rentService.getTenantBalance(orphanedLead._id);
        const newOrphanBal  = prevOrphanBal + orphanAdvAmt;  // debit reverses the credit
        await LedgerEntry.create({
          tenant:        orphanedLead._id,
          property:      req.params.propertyId,
          type:          'debit',
          amount:        orphanAdvAmt,
          balanceAfter:  newOrphanBal,
          referenceType: 'reservation_refunded',
          referenceId:   bed._id,
          description:   `Reservation advance ₹${orphanAdvAmt} reversed — bed reassigned to another tenant (${orphanAdvMode ?? 'unknown'} mode)`,
        });
        orphanedLead.ledgerBalance     = newOrphanBal;
        orphanedLead.reservationAmount = 0;
        logger.info('bed.assign.orphan_advance_reversed', {
          bedId: bed._id, orphanedTenantId: orphanedLead._id, amount: orphanAdvAmt,
        });
      }

      orphanedLead.status = 'vacated';
      orphanedLead.bed    = null;
      await orphanedLead.save();
      logger.info('bed.assign.orphan_reserved_vacated', { bedId: bed._id, orphanedTenantId: orphanedLead._id });
    }
  }

  const traceId = crypto.randomUUID();

  logger.info('bed.assign.start', {
    traceId,
    roomId:   req.params.roomId,
    bedId:    bed._id,
    tenantId,
    rentType: room.rentType,
    baseRent: room.baseRent,
    isExtra:  bed.isExtra,
    hasBodyOverride,
    userId:   req.user._id,
  });

  let updatedBed;
  try {
    await runWithRetry(async (session) => {
      // 1. Claim the bed and activate the tenant
      bed.status       = 'occupied';
      bed.tenant       = tenant._id;
      bed.reservedTill = null;
      bed.reservation  = { tenantId: null, name: null, phone: null, moveInDate: null, notes: null, source: 'reserved' };
      await bed.save({ session });

      tenant.bed          = bed._id;
      tenant.status       = 'active';
      tenant.checkOutDate = null;
      // Seed rentAmount with a placeholder; recalculate overwrites it below
      tenant.rentAmount   = 0;
      // Only overwrite depositAmount if a positive value is explicitly provided.
      // deposit=0 or deposit=undefined must NOT erase an existing deposit balance
      // (e.g. operator toggles deposit off on re-assignment after collecting one earlier).
      if (deposit !== undefined && Number(deposit) > 0) {
        tenant.depositAmount = Number(deposit);
        // Pre-set to 'pending'; the post-transaction block will upgrade to 'held' if collected.
        // depositCollected must be explicitly true — absence means pending.
        if (depositCollected !== true) {
          tenant.depositStatus = 'pending';
          tenant.depositPaid   = false;
          tenant.depositPaidAt = null;
        }
      }
      if (moveInDate)             tenant.checkInDate   = new Date(moveInDate);
      // Set billingStartDate once at first assignment — immutable anchor for personal cycle
      if (!tenant.billingStartDate) {
        tenant.billingStartDate = moveInDate ? new Date(moveInDate) : new Date();
      }
      // Preserve assignedAt from first assignment if re-assigning
      if (!tenant.billingSnapshot?.assignedAt) {
        tenant.billingSnapshot = { ...(tenant.billingSnapshot ?? {}), assignedAt: new Date() };
      }
      await tenant.save({ session });

      // 2. Recalculate rent for ALL occupied tenants in this room (including the one just assigned)
      await recalculateRoomRent(room, session, 'assign', traceId);
    });
  } catch (err) {
    logger.error('bed.assign.transaction_failed', { traceId, bedId: bed._id, tenantId, error: err.message });
    throw err;
  }

  updatedBed = await fetchBed(req.params.id, req.params.roomId);

  // ── Handle reservation advance disposition ──────────────────────────────────
  // The LedgerEntry credit was already written at reservation time.
  // Disposition choices:
  //   'adjust' (default) — credit stays; auto-offsets first rent. Mark as converted.
  //   'convert_deposit'  — reverse the credit (write debit), move amount to depositBalance.
  //   'keep'             — credit stays as-is; no auto-offset. Mark reservationStatus='held'.
  if (capturedAdvAmt > 0) {
    const disposition = advanceDisposition ?? (capturedAdvMode === 'adjust' ? 'adjust' : 'keep');

    if (disposition === 'convert_deposit') {
      // Reverse the reservation_advance credit → debit so it no longer offsets rent.
      // Then add the amount into depositBalance as a new deposit.
      const [currentLedgerBal, freshTenant] = await Promise.all([
        rentService.getTenantBalance(tenantId),
        Tenant.findById(tenantId).select('depositBalance depositStatus depositPaid').lean(),
      ]);
      const newLedgerBal = currentLedgerBal + capturedAdvAmt; // debit increases balance

      await LedgerEntry.create({
        tenant:        tenantId,
        property:      req.params.propertyId,
        type:          'debit',
        amount:        capturedAdvAmt,
        balanceAfter:  newLedgerBal,
        referenceType: 'reservation_adjusted',
        referenceId:   bed._id,
        description:   `Reservation advance ₹${capturedAdvAmt} converted to security deposit at check-in`,
      });

      // Update tenant: add to depositBalance, reverse ledgerBalance
      const newDepositBal = (freshTenant?.depositBalance ?? 0) + capturedAdvAmt;
      await Tenant.updateOne(
        { _id: tenantId },
        {
          $inc: { ledgerBalance: capturedAdvAmt },
          $set: { depositBalance: newDepositBal, depositStatus: 'held', depositPaid: true, reservationAmount: 0 },
        }
      );

      // Audit entry for the deposit portion — informational, rent balance unchanged from debit
      await LedgerEntry.create({
        tenant:        tenantId,
        property:      req.params.propertyId,
        type:          'credit',
        amount:        capturedAdvAmt,
        balanceAfter:  await rentService.getTenantBalance(tenantId),
        referenceType: 'deposit_collected',
        referenceId:   bed._id,
        description:   `Security deposit ₹${capturedAdvAmt} sourced from reservation advance at check-in`,
      });

      await updatedBed.updateOne({ $set: { 'reservation.reservationStatus': 'converted' } });
      logger.info('bed.assign.advance_converted_to_deposit', { traceId, tenantId, amount: capturedAdvAmt });

    } else if (disposition === 'adjust') {
      // Default: credit remains in ledger and will offset first rent. Mark as converted.
      await updatedBed.updateOne({ $set: { 'reservation.reservationStatus': 'converted' } });
      await Tenant.updateOne({ _id: tenantId }, { $set: { reservationAmount: 0 } });
      logger.info('bed.assign.advance_marked_converted', { traceId, tenantId, amount: capturedAdvAmt });

    } else {
      // 'keep': credit remains as general ledger credit. reservationStatus stays 'held'.
      // reservationAmount stays on tenant until explicitly cleared.
      logger.info('bed.assign.advance_kept_as_credit', { traceId, tenantId, amount: capturedAdvAmt });
    }
  }

  // ── Record deposit (if any) ──────────────────────────────────────────────────
  const depositFromBody  = deposit !== undefined ? Number(deposit) : 0;
  // depositCollected must be explicitly true to mark a deposit as paid.
  // Omitting the field (old clients, no-deposit paths) safely defaults to pending.
  const isDepositCollected = depositCollected === true;

  if (depositFromBody > 0) {
    if (isDepositCollected) {
      // Collected now: mark as held + write audit ledger entry
      await Tenant.updateOne(
        { _id: tenantId },
        { $set: { depositBalance: depositFromBody, depositStatus: 'held', depositPaid: true, depositPaidAt: new Date() } }
      );
      // Audit-only ledger entry — does NOT affect rent ledgerBalance
      await LedgerEntry.create({
        tenant:        tenantId,
        property:      req.params.propertyId,
        type:          'credit',
        amount:        depositFromBody,
        balanceAfter:  await rentService.getTenantBalance(tenantId),  // informational — balance unchanged
        referenceType: 'deposit_collected',
        referenceId:   bed._id,
        description:   `Security deposit collected at assignment`,
      });
      logger.info('bed.assign.deposit_recorded', { traceId, tenantId, amount: depositFromBody });
    } else {
      // Pending: record the expected amount and explicitly reset any previously-collected
      // deposit state so the tenant doesn't keep a stale "Held" status from a prior
      // assignment. depositAmount was already set inside the transaction (line 704).
      await Tenant.updateOne(
        { _id: tenantId },
        { $set: { depositPaid: false, depositBalance: 0, depositStatus: 'pending', depositPaidAt: null } }
      );
      logger.info('bed.assign.deposit_pending', { traceId, tenantId, amount: depositFromBody });
    }
  }

  logger.info('bed.assigned', {
    traceId,
    bedId:    bed._id,
    tenantId: tenant._id,
    roomId:   req.params.roomId,
    isExtra:  bed.isExtra,
    finalRent: updatedBed?.tenant?.rentAmount,
    userId:   req.user._id,
  });

  // ── Auto-generate first billing cycle ──────────────────────────────────────
  // The daily cron handles future cycles, but the first cycle for this tenant
  // starts today — the cron may have already run, so we generate it immediately.
  // Non-blocking: any error here doesn't fail the assignment response.
  try {
    const now = new Date();
    await rentService.generateRentForProperty(
      req.params.propertyId,
      now.getMonth() + 1,
      now.getFullYear()
    );
    logger.info('bed.assign.first_cycle_generated', { traceId, tenantId: tenant._id });
  } catch (cycleErr) {
    logger.warn('bed.assign.first_cycle_failed', { traceId, tenantId: tenant._id, error: cycleErr.message });
  }

  res.json({ success: true, message: 'Tenant assigned to bed', data: updatedBed });
});

// GET /api/properties/:propertyId/rooms/:roomId/beds/:id/vacate-check
// Returns pending rent summary + deposit info before the user confirms vacate.
const vacateCheck = asyncHandler(async (req, res) => {
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

  const bed = await fetchBed(req.params.id, req.params.roomId);
  if (!bed) return res.status(404).json({ success: false, message: 'Bed not found' });

  if (bed.status !== 'occupied' || !bed.tenant) {
    return res.status(400).json({ success: false, message: 'Bed has no tenant to vacate', code: 'INVALID_STATE' });
  }

  const tenant = await Tenant.findById(bed.tenant)
    .select('name phone rentAmount depositAmount depositPaid depositReturned depositBalance depositStatus checkInDate');
  if (!tenant) return res.status(404).json({ success: false, message: 'Tenant record not found' });

  const ledgerBalance = await rentService.getLastBalance(tenant._id);

  const [pendingRents, paidRents, partialRents] = await Promise.all([
    RentPayment.find({
      tenant: tenant._id,
      status: { $in: ['pending', 'overdue'] },
    }).select('month year amount paidAmount status dueDate').sort({ year: 1, month: 1 }).lean(),
    RentPayment.find({
      tenant: tenant._id,
      status: 'paid',
    }).select('amount paidAmount').lean(),
    RentPayment.find({
      tenant: tenant._id,
      status: 'partial',
    }).select('month year amount paidAmount status dueDate').sort({ year: 1, month: 1 }).lean(),
  ]);

  // Outstanding amount includes full pending/overdue records + unpaid balance of partials
  const pendingFromOpen    = pendingRents.reduce((s, r) => s + r.amount, 0);
  const pendingFromPartial = partialRents.reduce((s, r) => s + (r.amount - (r.paidAmount ?? 0)), 0);
  const totalPendingAmount = pendingFromOpen + pendingFromPartial;

  const totalPaidAmount = paidRents.reduce((s, r) => s + r.amount, 0)
    + partialRents.reduce((s, r) => s + (r.paidAmount ?? 0), 0);
  const totalRentAmount = totalPaidAmount + totalPendingAmount;

  // Combine open + partial for the "outstanding records" list shown in the UI
  const allPendingRecords = [
    ...pendingRents,
    ...partialRents.map(r => ({
      ...r,
      outstandingAmount: r.amount - (r.paidAmount ?? 0),
    })),
  ].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);

  res.json({
    success: true,
    data: {
      tenant: {
        _id:                 tenant._id,
        name:                tenant.name,
        phone:               tenant.phone,
        rentAmount:          tenant.rentAmount,
        depositAmount:       tenant.depositAmount  ?? 0,
        depositPaid:         tenant.depositPaid    ?? false,
        depositReturned:     tenant.depositReturned ?? false,
        depositBalance:      tenant.depositBalance ?? 0,
        depositStatus:       tenant.depositStatus  ?? null,
        checkInDate:         tenant.checkInDate,
        // Authoritative ledger balance — positive = owes, negative = advance credit
        ledgerBalance:       ledgerBalance,
        advanceCreditAmount: ledgerBalance < 0 ? Math.abs(ledgerBalance) : 0,
      },
      totalRentAmount,
      totalPaidAmount,
      totalPendingAmount,
      pendingRentCount:   allPendingRecords.length,
      pendingRents:       allPendingRecords,
    },
  });
});

// PATCH /api/properties/:propertyId/rooms/:roomId/beds/:id/vacate
const vacateBed = asyncHandler(async (req, res) => {
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  const bed = await fetchBed(req.params.id, req.params.roomId);
  if (!bed) {
    return res.status(404).json({ success: false, message: 'Bed not found' });
  }

  if (bed.status !== 'occupied' || !bed.tenant) {
    return res.status(400).json({
      success: false,
      message: 'Bed has no tenant to vacate',
      code: 'INVALID_STATE',
    });
  }

  const tenant = await Tenant.findById(bed.tenant);
  if (!tenant) {
    return res.status(404).json({
      success: false,
      message: 'Tenant record not found',
      code: 'TENANT_NOT_FOUND',
    });
  }

  if (tenant.status === 'vacated') {
    return res.status(409).json({
      success: false,
      message: 'Tenant is already vacated',
      code: 'ALREADY_VACATED',
    });
  }

  try {
    const result = await vacateBedCore({
      propertyId: req.params.propertyId,
      room,
      bed,
      tenant,
      opts:   req.body,
      userId: req.user._id,
    });

    res.json({
      success: true,
      message: 'Bed vacated successfully',
      data: {
        bed:    { _id: result.bed._id, bedNumber: result.bed.bedNumber, status: result.bed.status },
        tenant: {
          _id:             result.tenant._id,
          name:            result.tenant.name,
          checkOutDate:    result.tenant.checkOutDate,
          depositReturned: result.tenant.depositReturned,
          depositBalance:  result.tenant.depositBalance,
          depositStatus:   result.tenant.depositStatus,
        },
      },
    });
  } catch (err) {
    const status = err.status ?? 500;
    const code   = err.code   ?? 'VACATE_ERROR';
    logger.error('bed.vacate.failed', { bedId: bed._id, tenantId: tenant._id, error: err.message });
    res.status(status).json({ success: false, message: err.message, code });
  }
});

// PATCH /api/properties/:propertyId/rooms/:roomId/beds/:id/reserve
const reserveBed = asyncHandler(async (req, res) => {
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  const bed = await Bed.findOne({ _id: req.params.id, room: req.params.roomId, isActive: true });
  if (!bed) {
    return res.status(404).json({ success: false, message: 'Bed not found' });
  }

  if (bed.status !== 'vacant') {
    return res.status(409).json({
      success: false,
      message: `Cannot reserve a bed with status '${bed.status}'`,
      code: 'INVALID_STATE',
    });
  }

  const { reservedTill, moveInDate, notes, tenantId, name, phone, replace,
          reservationAmount: rawAdvAmt, reservationMode: rawAdvMode,
          autoVacate } = req.body;
  // autoVacate: boolean — when true and the tenant is active/notice with an occupied bed,
  // the old bed is freed and the tenant transitions to 'reserved'. Must be explicitly
  // confirmed by the caller (frontend should prompt before sending autoVacate=true).

  // ── reservedTill validation ───────────────────────────────────────────────
  // Must be a valid future date at least 1 hour from now.
  if (!reservedTill) {
    return res.status(400).json({ success: false, message: 'reservedTill is required', code: 'MISSING_RESERVED_TILL' });
  }
  const reservedTillDate = new Date(reservedTill);
  if (isNaN(reservedTillDate.getTime())) {
    return res.status(400).json({ success: false, message: 'reservedTill is not a valid date', code: 'INVALID_RESERVED_TILL' });
  }
  const minReservedTill = new Date(Date.now() + 60 * 60 * 1000); // now + 1 hour
  if (reservedTillDate < minReservedTill) {
    return res.status(400).json({
      success: false,
      message: 'reservedTill must be at least 1 hour in the future',
      code: 'RESERVED_TILL_TOO_SOON',
    });
  }

  // ── Advance (token) amount validation ────────────────────────────────────
  const advAmt  = rawAdvAmt !== undefined && rawAdvAmt !== null && rawAdvAmt !== ''
    ? Number(rawAdvAmt) : 0;
  const advMode = advAmt > 0 ? (rawAdvMode || null) : null;
  if (advAmt < 0) {
    return res.status(400).json({ success: false, message: 'reservationAmount must be ≥ 0', code: 'INVALID_ADVANCE' });
  }
  if (advAmt > 0 && !['adjust', 'refund'].includes(advMode)) {
    return res.status(400).json({ success: false, message: "reservationMode must be 'adjust' or 'refund' when amount > 0", code: 'INVALID_ADVANCE_MODE' });
  }

  let tenant;

  if (tenantId) {
    // ── Path A: existing tenant (active / notice / reserved) ─────────────────
    tenant = await Tenant.findOne({ _id: tenantId, property: req.params.propertyId });
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found in this property',
        code: 'TENANT_NOT_FOUND',
      });
    }
    if (tenant.status === 'merged') {
      return res.status(409).json({
        success: false,
        message: 'Cannot reserve a bed for a merged tenant',
        code: 'INVALID_TENANT_STATUS',
      });
    }
    // Heal stale bed reference: vacated tenant whose bed pointer was not cleared
    if (tenant.status === 'vacated' && tenant.bed) {
      logger.warn('reserve.stale_bed_ref.heal', { tenantId: tenant._id, staleBed: tenant.bed });
      tenant.bed = null;
      await tenant.save();
    }
    // Authoritative check: query the Bed collection, not tenant.bed (which can be stale)
    const occupiedBed = await Bed.findOne({ tenant: tenant._id, status: 'occupied', isActive: true })
      .select('_id bedNumber room status tenant').lean();

    if (occupiedBed) {
      // ── Notice → Reserve transition ────────────────────────────────────────
      // Active or notice tenants can transition directly to a reservation on a
      // new bed when autoVacate=true. The old bed is freed (minimal vacate — no
      // deposit/payment handling), rent is recalculated for the old room, and
      // the tenant's status becomes 'reserved'. Callers must send autoVacate=true
      // explicitly; without it we return a descriptive error so the frontend can
      // prompt the operator for confirmation before re-submitting.
      if ((tenant.status === 'active' || tenant.status === 'notice') && autoVacate === true) {
        logger.info('reserve.auto_vacate.start', {
          tenantId: tenant._id, oldBedId: occupiedBed._id,
          newBedId: bed._id, userId: req.user._id,
        });

        // Free the old bed
        await Bed.updateOne(
          { _id: occupiedBed._id },
          { $set: { status: 'vacant', tenant: null } }
        );

        // Recalculate rent for the old room so per-room splits stay correct
        try {
          const oldRoom = await Room.findById(occupiedBed.room);
          if (oldRoom) {
            await recalculateRoomRent(oldRoom, null, 'vacate', `auto_vacate_${tenant._id}`);
          }
        } catch (rcErr) {
          logger.warn('reserve.auto_vacate.recalc_failed', {
            tenantId: tenant._id, oldBedId: occupiedBed._id, error: rcErr.message,
          });
        }

        // Clear tenant's current bed reference — status will be set to 'reserved' below
        tenant.bed    = null;
        tenant.status = 'reserved';
        await tenant.save();

        logger.info('reserve.auto_vacate.done', { tenantId: tenant._id, oldBedId: occupiedBed._id });

      } else if (tenant.status === 'active' || tenant.status === 'notice') {
        // Return a structured error so the frontend can show a confirmation prompt
        // before re-submitting with autoVacate=true.
        const oldRoom = await Room.findById(occupiedBed.room).select('roomNumber').lean();
        return res.status(409).json({
          success: false,
          message: `${tenant.name} is currently assigned to a bed. Set autoVacate=true to release the old bed and move them to this reservation.`,
          code: 'TENANT_ASSIGNED_AUTO_VACATE',
          currentAssignment: {
            bedId:      occupiedBed._id,
            bedNumber:  occupiedBed.bedNumber,
            roomNumber: oldRoom?.roomNumber ?? null,
          },
        });
      } else {
        return res.status(409).json({
          success: false,
          message: `${tenant.name} is already assigned to a bed. Vacate them first.`,
          code: 'TENANT_ASSIGNED',
        });
      }
    }
  } else {
    // ── Path B: find-or-create a reserved tenant by phone ────────────────────
    if (!phone || !phone.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required to create a reservation',
        code: 'MISSING_PHONE',
      });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Name is required to create a reservation',
        code: 'MISSING_NAME',
      });
    }

    // Block if an active/notice tenant with this phone already exists
    const activeConflict = await Tenant.findOne({
      property: req.params.propertyId,
      phone:    phone.trim(),
      status:   { $in: ['active', 'notice'] },
    }).select('_id name phone status').lean();

    if (activeConflict) {
      return res.status(409).json({
        success: false,
        message: `An active tenant with phone ${phone} already exists. Select them instead.`,
        code:   'TENANT_ALREADY_ACTIVE',
        tenant: activeConflict,
      });
    }

    // Reuse an existing reserved tenant with the same phone, or create one
    const existingLead = await Tenant.findOne({
      property: req.params.propertyId,
      phone:    phone.trim(),
      status:   'reserved',
    });

    if (existingLead) {
      tenant = existingLead;
      tenant.name = name.trim();
    } else {
      tenant = new Tenant({
        property:    req.params.propertyId,
        name:        name.trim(),
        phone:       phone.trim(),
        status:      'reserved',
        checkInDate: moveInDate ? new Date(moveInDate) : new Date(),
        rentAmount:  0,
      });
      await tenant.save();
    }
  }

  // ── Check for an existing reservation on a different bed ──────────────────
  const existingReservedBed = await Bed.findOne({
    tenant: tenant._id,
    status: 'reserved',
    _id:    { $ne: req.params.id },
  })
    .select('_id bedNumber room reservedTill tenant reservation')
    .populate('room', 'roomNumber')
    .lean();

  if (existingReservedBed && !replace) {
    return res.status(409).json({
      success: false,
      message: `${tenant.name} already has an active reservation on another bed.`,
      code:    'TENANT_ALREADY_RESERVED',
      existingReservation: {
        bedId:        existingReservedBed._id,
        bedNumber:    existingReservedBed.bedNumber,
        roomNumber:   existingReservedBed.room?.roomNumber ?? null,
        reservedTill: existingReservedBed.reservedTill,
      },
    });
  }

  // replace=true: cancel the old reservation and free the lead's bed ref
  if (existingReservedBed && replace) {
    const oldAdvAmt  = existingReservedBed.reservation?.reservationAmount ?? 0;
    const oldAdvMode = existingReservedBed.reservation?.reservationMode   ?? null;

    await Bed.updateOne(
      { _id: existingReservedBed._id },
      {
        $set: {
          status:       'vacant',
          reservedTill: null,
          tenant:       null,
          reservation:  {
            tenantId: null, name: null, phone: null, moveInDate: null, notes: null,
            source:            'reserved',
            reservationAmount: oldAdvAmt,
            reservationMode:   oldAdvAmt > 0 ? oldAdvMode : null,
            reservationStatus: oldAdvAmt > 0 ? 'cancelled' : null,
          },
        },
      }
    );

    // Reverse the advance credit that was written when the displaced reservation was created
    if (oldAdvAmt > 0 && existingReservedBed.tenant) {
      const replacedTenant = await Tenant.findById(existingReservedBed.tenant).select('property');
      if (replacedTenant) {
        const prevBal = await rentService.getTenantBalance(replacedTenant._id);
        const newBal  = prevBal + oldAdvAmt;   // debit reverses the earlier credit
        await LedgerEntry.create({
          tenant:        replacedTenant._id,
          property:      replacedTenant.property,
          type:          'debit',
          amount:        oldAdvAmt,
          balanceAfter:  newBal,
          referenceType: 'reservation_refunded',
          referenceId:   existingReservedBed._id,
          description:   `Reservation advance returned — reservation replaced by another bed (${oldAdvMode} mode)`,
        });
        await Tenant.updateOne({ _id: replacedTenant._id }, { $set: { ledgerBalance: newBal, reservationAmount: 0 } });
        logger.info('bed.reservation.replaced.advance_reversed', {
          cancelledBedId: existingReservedBed._id, tenantId: replacedTenant._id, amount: oldAdvAmt,
        });
      }
    }

    logger.info('bed.reservation.replaced', {
      cancelledBedId: existingReservedBed._id,
      newBedId:       bed._id,
      tenantId:       tenant._id,
      userId:         req.user._id,
    });
  }

  // ── Fix 1: Atomic link — wrap tenant save + bed save + ledger write in a transaction ──
  // Without a session, a crash between bed.save() and LedgerEntry.create() leaves the
  // bed reserved but with no advance credit, or a tenant pointing at the wrong bed.
  const reserveTraceId = crypto.randomUUID();
  try {
    await runWithRetry(async (session) => {
      // Link tenant → bed
      tenant.bed = bed._id;
      if (tenant.status === 'reserved' && moveInDate) {
        tenant.checkInDate = new Date(moveInDate);
      }
      await tenant.save({ session });

      // Link bed → tenant
      bed.status       = 'reserved';
      bed.reservedTill = reservedTillDate;
      bed.tenant       = tenant._id;
      bed.reservation  = {
        tenantId:          tenant._id,
        name:              tenant.name,
        phone:             tenant.phone,
        moveInDate:        moveInDate ? new Date(moveInDate) : null,
        notes:             notes || null,
        source:            tenantId ? 'existing_tenant' : 'reserved',
        reservationAmount: advAmt,
        reservationMode:   advMode,
        reservationStatus: advAmt > 0 ? 'held' : null,
      };
      await bed.save({ session });

      // Record advance in ledger inside the same transaction
      if (advAmt > 0) {
        const prevBal = await rentService.getTenantBalance(tenant._id);
        const newBal  = prevBal - advAmt;  // credit reduces outstanding balance
        await LedgerEntry.create([{
          tenant:        tenant._id,
          property:      req.params.propertyId,
          type:          'credit',
          amount:        advAmt,
          balanceAfter:  newBal,
          referenceType: 'reservation_paid',
          referenceId:   bed._id,
          description:   `Reservation advance collected (${advMode} mode) — Room ${room.roomNumber} Bed ${bed.bedNumber}`,
        }], { session });
        // Fix 4: ledger is the source of truth — do NOT mirror amount into tenant.reservationAmount.
        await Tenant.updateOne({ _id: tenant._id }, { $set: { ledgerBalance: newBal } }, { session });
        logger.info('bed.reserved.advance_recorded', {
          reserveTraceId, bedId: bed._id, tenantId: tenant._id, amount: advAmt, mode: advMode, newBal,
        });
      }
    });
  } catch (err) {
    logger.error('bed.reserve.transaction_failed', { reserveTraceId, bedId: bed._id, tenantId: tenant._id, error: err.message });
    throw err;
  }

  logger.info('bed.reserved', {
    bedId:             bed._id,
    reservedTill:      bed.reservedTill,
    tenantId:          tenant._id,
    tenantStatus:      tenant.status,
    source:            bed.reservation.source,
    replaced:          !!(replace),
    reservationAmount: advAmt,
    reservationMode:   advMode,
    roomId:            req.params.roomId,
    userId:            req.user._id,
  });

  res.json({ success: true, message: 'Bed reserved', data: bed });
});

// PATCH /api/properties/:propertyId/rooms/:roomId/beds/:id/unreserve
const cancelReservation = asyncHandler(async (req, res) => {
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  const bed = await Bed.findOne({ _id: req.params.id, room: req.params.roomId, isActive: true });
  if (!bed) {
    return res.status(404).json({ success: false, message: 'Bed not found' });
  }

  if (bed.status !== 'reserved') {
    return res.status(400).json({
      success: false,
      message: 'Bed is not reserved',
      code: 'INVALID_STATE',
    });
  }

  // ── Capture advance before clearing reservation ───────────────────────────
  const cancelAdvAmt    = bed.reservation?.reservationAmount ?? 0;
  const cancelAdvMode   = bed.reservation?.reservationMode   ?? null;
  const cancelTenantId  = bed.tenant;

  // forfeit=true → property keeps the advance (no physical refund).
  // forfeit=false (default) → advance is returned to the tenant.
  // In both cases we write a debit to reverse the earlier credit so the
  // cancelled tenant's balance returns to 0. The difference is the label.
  const forfeit = req.body.forfeit === true || req.body.forfeit === 'true';

  // Clean up the linked reserved tenant (do not touch active/notice tenants)
  if (bed.tenant) {
    const linkedTenant = await Tenant.findOne({ _id: bed.tenant, status: 'reserved' });
    if (linkedTenant) {
      linkedTenant.status            = 'vacated';
      linkedTenant.bed               = null;
      linkedTenant.reservationAmount = 0;
      await linkedTenant.save();
    } else {
      // Existing active/notice tenant was linked — just clear their bed ref
      await Tenant.updateOne({ _id: bed.tenant }, { $set: { bed: null } });
    }
  }

  bed.status       = 'vacant';
  bed.reservedTill = null;
  bed.tenant       = null;
  // Preserve advance fields with 'cancelled' status for audit trail.
  // reservationAmount/Mode are kept so the profile can show what was collected.
  bed.reservation  = {
    tenantId:          null,
    name:              null,
    phone:             null,
    moveInDate:        null,
    notes:             null,
    source:            'reserved',
    reservationAmount: cancelAdvAmt,
    reservationMode:   cancelAdvAmt > 0 ? cancelAdvMode : null,
    reservationStatus: cancelAdvAmt > 0 ? 'cancelled' : null,
  };
  await bed.save();

  // ── Write ledger entry to reverse the advance credit ──────────────────────
  // Whether refunded or forfeited, the cancelled tenant's balance must return
  // to 0. Write a debit to cancel the credit that was written at reserve time.
  if (cancelAdvAmt > 0 && cancelTenantId) {
    const refundTenant = await Tenant.findById(cancelTenantId).select('property');
    if (refundTenant) {
      const prevBalance = await rentService.getTenantBalance(refundTenant._id);
      const newBalance  = prevBalance + cancelAdvAmt;   // debit reverses the earlier credit
      await LedgerEntry.create({
        tenant:        refundTenant._id,
        property:      refundTenant.property,
        type:          'debit',
        amount:        cancelAdvAmt,
        balanceAfter:  newBalance,
        referenceType: forfeit ? 'reservation_forfeited' : 'reservation_refunded',
        referenceId:   bed._id,
        description:   forfeit
          ? `Reservation advance ₹${cancelAdvAmt} forfeited on cancellation — kept by property`
          : `Reservation advance ₹${cancelAdvAmt} returned on cancellation (${cancelAdvMode} mode)`,
      });
      await Tenant.updateOne({ _id: refundTenant._id }, { $set: { ledgerBalance: newBalance, reservationAmount: 0 } });
      logger.info('bed.cancel.advance_settled', {
        tenantId: refundTenant._id, amount: cancelAdvAmt, newBalance, mode: cancelAdvMode, forfeit,
      });
    }
  }

  res.json({
    success: true,
    message: forfeit ? 'Reservation cancelled — advance forfeited' : 'Reservation cancelled',
    data: bed,
  });
});

// PATCH /api/properties/:propertyId/rooms/:roomId/beds/:id/block
const blockBed = asyncHandler(async (req, res) => {
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  const bed = await Bed.findOne({ _id: req.params.id, room: req.params.roomId, isActive: true });
  if (!bed) {
    return res.status(404).json({ success: false, message: 'Bed not found' });
  }

  if (bed.status === 'occupied') {
    return res.status(409).json({
      success: false,
      message: 'Cannot block an occupied bed. Vacate the tenant first.',
      code: 'BED_OCCUPIED',
    });
  }

  if (bed.status === 'blocked') {
    return res.status(400).json({
      success: false,
      message: 'Bed is already blocked',
      code: 'INVALID_STATE',
    });
  }

  const wasReserved = bed.status === 'reserved';
  // Clean up reserved tenant when blocking a reserved bed
  if (wasReserved && bed.tenant) {
    const linkedTenant = await Tenant.findOne({ _id: bed.tenant, status: 'reserved' });
    if (linkedTenant) {
      linkedTenant.status            = 'vacated';
      linkedTenant.bed               = null;
      linkedTenant.reservationAmount = 0;
      await linkedTenant.save();
    } else {
      await Tenant.updateOne({ _id: bed.tenant }, { $set: { bed: null } });
    }
  }
  bed.status = 'blocked';
  if (wasReserved) {
    bed.reservedTill = null;
    bed.tenant       = null;
    bed.reservation  = { tenantId: null, name: null, phone: null, moveInDate: null, notes: null, source: 'reserved' };
  }
  const { blockReason, blockNotes } = req.body;
  bed.blockReason = blockReason || null;
  bed.blockNotes  = blockNotes  || null;
  await bed.save();

  logger.info('bed.blocked', {
    bedId:      bed._id,
    wasReserved,
    blockReason: bed.blockReason,
    roomId:     req.params.roomId,
    userId:     req.user._id,
  });

  res.json({ success: true, message: 'Bed blocked', data: bed });
});

// PATCH /api/properties/:propertyId/rooms/:roomId/beds/:id/unblock
const unblockBed = asyncHandler(async (req, res) => {
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  const bed = await Bed.findOne({ _id: req.params.id, room: req.params.roomId, isActive: true });
  if (!bed) {
    return res.status(404).json({ success: false, message: 'Bed not found' });
  }

  if (bed.status !== 'blocked') {
    return res.status(400).json({
      success: false,
      message: 'Bed is not blocked',
      code: 'INVALID_STATE',
    });
  }

  bed.status      = 'vacant';
  bed.blockReason = null;
  bed.blockNotes  = null;
  await bed.save();

  logger.info('bed.unblocked', {
    bedId:  bed._id,
    roomId: req.params.roomId,
    userId: req.user._id,
  });

  res.json({ success: true, message: 'Bed unblocked', data: bed });
});

// GET /api/properties/:propertyId/rooms/:roomId/analytics
const getRoomAnalytics = asyncHandler(async (req, res) => {
  const roomId = req.params.id ?? req.params.roomId;
  const room = await verifyRoomOwnership(roomId, req.params.propertyId, req.user._id);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  const beds = await Bed.find({ room: roomId, isActive: true })
    .populate('tenant', 'rentAmount');

  const normalBeds     = beds.filter((b) => !b.isExtra);
  const extraBeds      = beds.filter((b) => b.isExtra);
  const occupiedNormal = normalBeds.filter((b) => b.status === 'occupied');
  const occupiedExtra  = extraBeds.filter((b) => b.status === 'occupied');
  const totalOccupied  = occupiedNormal.length + occupiedExtra.length;

  // Revenue = SUM(tenant.rentAmount) — locked at assignment, never recalculated.
  // billingSnapshot.finalRent is the safety fallback only.
  const toRent = (b) => b.tenant?.rentAmount ?? b.tenant?.billingSnapshot?.finalRent ?? 0;
  const normalRevenue    = occupiedNormal.reduce((s, b) => s + toRent(b), 0);
  const extraRevenue     = occupiedExtra.reduce((s, b) => s + toRent(b), 0);
  const effectiveRevenue = normalRevenue + extraRevenue;

  res.json({
    success: true,
    data: {
      roomId:          room._id,
      roomNumber:      room.roomNumber,
      capacity:        room.capacity,
      rentType:        room.rentType,
      totalBeds:       beds.length,
      normalBeds:      normalBeds.length,
      extraBeds:       extraBeds.length,
      occupiedBeds:    totalOccupied,
      vacantBeds:      beds.filter((b) => b.status === 'vacant').length,
      reservedBeds:    beds.filter((b) => b.status === 'reserved').length,
      occupancyRate:   beds.length > 0 ? +(totalOccupied / beds.length).toFixed(2) : 0,
      effectiveRevenue,
      normalRevenue,
      extraRevenue,
      overCapacity:    beds.length > room.capacity,
    },
  });
});

// GET /api/properties/:propertyId/rooms/:roomId/financials
const getRoomFinancials = asyncHandler(async (req, res) => {
  const roomId = req.params.id ?? req.params.roomId;
  const room = await verifyRoomOwnership(roomId, req.params.propertyId, req.user._id);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  const beds = await Bed.find({ room: roomId, isActive: true })
    .populate('tenant', 'rentAmount');

  const normalBeds = beds.filter((b) => !b.isExtra);
  const extraBeds  = beds.filter((b) => b.isExtra);

  const occupiedBeds  = beds.filter((b) => b.status === 'occupied');
  const occupiedExtra = extraBeds.filter((b) => b.status === 'occupied');

  // Revenue = SUM(tenant.rentAmount) — locked at assignment, never recalculated.
  // billingSnapshot.finalRent is the safety fallback only.
  const toRent = (b) => b.tenant?.rentAmount ?? b.tenant?.billingSnapshot?.finalRent ?? 0;
  const normalOccupied   = occupiedBeds.filter((b) => !b.isExtra);
  const normalRevenue    = normalOccupied.reduce((s, b) => s + toRent(b), 0);
  const extraRevenue     = occupiedExtra.reduce((s, b) => s + toRent(b), 0);
  const actualRevenue    = normalRevenue + extraRevenue;

  res.json({
    success: true,
    data: {
      roomId:        room._id,
      roomNumber:    room.roomNumber,
      capacity:      room.capacity,
      rentType:      room.rentType,
      totalBeds:     beds.length,
      occupiedBeds:  occupiedBeds.length,
      extraBeds:     extraBeds.length,
      occupancyRate: beds.length > 0 ? +(occupiedBeds.length / beds.length).toFixed(2) : 0,
      actualRevenue,
      normalRevenue,
      extraRevenue,
      overCapacity:  beds.length > room.capacity,
    },
  });
});

// GET /api/properties/:propertyId/rooms/:roomId/activity
// Returns up to 25 recent events for the room: financial ledger entries for all
// current tenants + check-in events, merged and sorted newest-first.
const getRoomActivity = asyncHandler(async (req, res) => {
  const roomId = req.params.id ?? req.params.roomId;
  const room = await verifyRoomOwnership(roomId, req.params.propertyId, req.user._id);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  // All active beds in this room with current tenant
  const beds = await Bed.find({ room: roomId, isActive: true })
    .populate('tenant', 'name checkInDate status');

  const tenantMap = {};                // tenantId → { name, bedNumber }
  beds.forEach(b => {
    if (b.tenant) tenantMap[String(b.tenant._id)] = { name: b.tenant.name, bedNumber: b.bedNumber };
  });
  const tenantIds = Object.keys(tenantMap);

  // Fetch up to 20 recent ledger entries across all current tenants
  const ledgerEntries = tenantIds.length > 0
    ? await LedgerEntry.find({
        tenant:   { $in: tenantIds },
        property: req.params.propertyId,
      })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean()
    : [];

  // Map ledger entries to activity items
  const ledgerItems = ledgerEntries.map(e => ({
    _id:         String(e._id),
    type:        e.referenceType,
    entryType:   e.type,                         // 'debit' | 'credit'
    description: e.description,
    amount:      e.amount,
    tenantName:  tenantMap[String(e.tenant)]?.name ?? 'Unknown',
    bedNumber:   tenantMap[String(e.tenant)]?.bedNumber ?? null,
    method:      e.method ?? null,
    timestamp:   e.createdAt,
  }));

  // Synthesise check-in events from current tenants
  const checkInItems = beds
    .filter(b => b.tenant?.checkInDate)
    .map(b => ({
      _id:         `checkin-${b._id}`,
      type:        'check_in',
      entryType:   null,
      description: `Checked in to Bed ${b.bedNumber}`,
      amount:      null,
      tenantName:  b.tenant.name,
      bedNumber:   b.bedNumber,
      method:      null,
      timestamp:   b.tenant.checkInDate,
    }));

  const allItems = [...ledgerItems, ...checkInItems]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 25);

  res.json({ success: true, count: allItems.length, data: allItems });
});

// PATCH /api/properties/:propertyId/rooms/:roomId/beds/:id/change-room
// Body: { targetBedId }
// Atomically moves a tenant from the current occupied bed to a different vacant bed.
const changeBed = asyncHandler(async (req, res) => {
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  const { targetBedId } = req.body;
  if (!targetBedId) {
    return res.status(400).json({ success: false, message: 'targetBedId is required', code: 'MISSING_FIELD' });
  }

  // ── Source bed ───────────────────────────────────────────────────────────────
  const sourceBed = await fetchBed(req.params.id, req.params.roomId);
  if (!sourceBed) {
    return res.status(404).json({ success: false, message: 'Source bed not found', code: 'BED_NOT_FOUND' });
  }
  if (sourceBed.status !== 'occupied' || !sourceBed.tenant) {
    return res.status(400).json({
      success: false,
      message: 'Source bed has no tenant to transfer',
      code: 'INVALID_STATE',
    });
  }

  // ── Tenant ───────────────────────────────────────────────────────────────────
  const tenant = await Tenant.findById(sourceBed.tenant);
  if (!tenant) {
    return res.status(404).json({ success: false, message: 'Tenant record not found', code: 'TENANT_NOT_FOUND' });
  }
  if (tenant.status === 'vacated') {
    return res.status(400).json({ success: false, message: 'Tenant is already vacated', code: 'TENANT_VACATED' });
  }

  // ── Target bed — must belong to the same property ────────────────────────────
  const targetBed = await Bed.findOne({ _id: targetBedId, property: req.params.propertyId, isActive: true });
  if (!targetBed) {
    return res.status(404).json({ success: false, message: 'Target bed not found', code: 'TARGET_BED_NOT_FOUND' });
  }
  if (String(targetBed._id) === String(sourceBed._id)) {
    return res.status(400).json({ success: false, message: 'Target bed is the same as source bed', code: 'SAME_BED' });
  }
  if (targetBed.status === 'occupied') {
    return res.status(409).json({ success: false, message: 'Target bed is already occupied', code: 'TARGET_BED_OCCUPIED' });
  }
  if (targetBed.status === 'blocked') {
    return res.status(409).json({
      success: false,
      message: 'Target bed is blocked. Unblock it before moving a tenant.',
      code: 'TARGET_BED_BLOCKED',
    });
  }
  if (targetBed.status !== 'vacant') {
    return res.status(409).json({
      success: false,
      message: `Target bed must be vacant for a room transfer. Current status: '${targetBed.status}'.`,
      code: 'TARGET_BED_NOT_VACANT',
    });
  }

  // ── Target room ───────────────────────────────────────────────────────────────
  const targetRoom = await Room.findOne({ _id: targetBed.room, isActive: true });
  if (!targetRoom) {
    return res.status(404).json({ success: false, message: 'Target room not found', code: 'TARGET_ROOM_NOT_FOUND' });
  }

  // ── Gender check ──────────────────────────────────────────────────────────────
  if (targetRoom.gender !== 'unisex' && tenant.gender && targetRoom.gender !== tenant.gender) {
    return res.status(400).json({
      success: false,
      message: `Gender mismatch: tenant is ${tenant.gender} but target room only accepts ${targetRoom.gender}`,
      code: 'GENDER_MISMATCH',
      meta: { tenantGender: tenant.gender, roomGender: targetRoom.gender },
    });
  }

  // ── Room config guard ─────────────────────────────────────────────────────────
  if (!targetRoom.baseRent || targetRoom.baseRent <= 0 || !targetRoom.capacity || targetRoom.capacity < 1) {
    return res.status(400).json({
      success: false,
      message: 'Invalid target room configuration: baseRent and capacity must be positive',
      code: 'INVALID_ROOM_CONFIG',
    });
  }

  // ── Capacity check — count current normal occupied beds in target room ────────
  const targetRoomOccupied = await Bed.countDocuments({
    room:     targetBed.room,
    isActive: true,
    status:   'occupied',
    isExtra:  false,
  });
  if (targetRoomOccupied >= targetRoom.capacity) {
    return res.status(409).json({
      success: false,
      message: `Target room is at full capacity (${targetRoom.capacity} bed${targetRoom.capacity !== 1 ? 's' : ''}, all occupied).`,
      code: 'TARGET_ROOM_AT_CAPACITY',
    });
  }

  const traceId  = crypto.randomUUID();
  const sameRoom = String(sourceBed.room) === String(targetBed.room);
  const fromRent = tenant.rentAmount; // capture before transaction overwrites it

  logger.info('bed.change.start', {
    traceId,
    sourceBedId:  sourceBed._id,
    targetBedId:  targetBed._id,
    tenantId:     tenant._id,
    sourceRoomId: req.params.roomId,
    targetRoomId: targetRoom._id,
    sameRoom,
    userId:       req.user._id,
  });

  // ── Atomic transaction ─────────────────────────────────────────────────────────
  try {
    await runWithRetry(async (session) => {
      // Free source bed
      sourceBed.status = 'vacant';
      sourceBed.tenant = null;
      await sourceBed.save({ session });

      // Claim target bed
      targetBed.status       = 'occupied';
      targetBed.tenant       = tenant._id;
      targetBed.reservedTill = null;
      await targetBed.save({ session });

      // Point tenant at new bed; seed rentAmount placeholder — recalculate overwrites it
      tenant.bed        = targetBed._id;
      tenant.rentAmount = 0;
      if (!tenant.billingSnapshot?.assignedAt) {
        tenant.billingSnapshot = { ...(tenant.billingSnapshot ?? {}), assignedAt: new Date() };
      }
      await tenant.save({ session });

      // Recalculate source room first (divisor drops by 1 for remaining per_room tenants).
      // Skip when moving within the same room — single recalculate below is sufficient.
      if (!sameRoom) {
        await recalculateRoomRent(room, session, 'change_room', traceId);
      }

      // Recalculate target room (tenant is now in targetBed, divisor rises by 1)
      await recalculateRoomRent(targetRoom, session, 'change_room', traceId);
    });
  } catch (err) {
    logger.error('bed.change.transaction_failed', {
      traceId,
      sourceBedId: sourceBed._id,
      targetBedId: targetBed._id,
      tenantId:    tenant._id,
      error:       err.message,
    });
    throw err;
  }

  const updatedTargetBed = await Bed.findById(targetBed._id)
    .populate('tenant', 'name phone status rentAmount billingSnapshot ledgerBalance');

  // ── Reset current billing cycle to new rent ───────────────────────────────
  // On room change, the existing billing record is updated to the new rent.
  // The ledger receives a delta entry (newRent − unearnedOldDebt) so that
  // unpaid old rent is not double-counted alongside the new charge.
  //   1. Resolve billing-cycle month/year (matches ensureCurrentCycleRentForTenant).
  //   2. Find current cycle record (ANY status).
  //   3. Reset record: amount=newRent, paidAmount=0, status='pending'.
  //   4. Write ledger delta only when non-zero; type debit or credit accordingly.
  //   5. Apply advance credit (max(0,-prevBalance)) to paidAmount on the record.
  const newRent = updatedTargetBed?.tenant?.rentAmount ?? 0;
  try {
    // Use billing-cycle month/year — must match ensureCurrentCycleRentForTenant
    // which also uses this function. Using calendar month caused a mismatch when
    // billingDay > today's date (cycle is still the previous calendar month),
    // leading to the wrong record being looked up (or missed entirely), and
    // ensureCurrentCycleRentForTenant later creating a second open record.
    const cycle    = rentService.getCurrentBillingCycleMonthYear(tenant.billingStartDate, tenant.checkInDate);
    const curMonth = cycle?.month ?? (new Date().getMonth() + 1);
    const curYear  = cycle?.year  ?? new Date().getFullYear();

    // Capture balance BEFORE billing adjustment (includes prior payments for this cycle)
    const prevLedgerBalance = await rentService.getTenantBalance(tenant._id);

    // Any status — 'paid' records must be reopened when newRent > paidAmount
    const currentRecord = await RentPayment.findOne({
      tenant: tenant._id,
      month:  curMonth,
      year:   curYear,
    });

    if (currentRecord) {
      // ── Close old billing, open fresh billing at new rate ─────────────────────
      //
      // KEY: we write only the NET ledger delta (not a full +newRent debit).
      // Reason: generateRentForProperty already wrote a +oldBilledAmount debit for
      // this cycle. Writing +newRent on top would count the old charge AND the new
      // charge simultaneously (double-billing when old rent was unpaid).
      //
      // Correct delta = newRent − unearnedOldDebt
      //   unearnedOldDebt = oldBilledAmount − oldPaidAmount
      //                   = the portion of the OLD charge not yet settled
      //
      // Edge-cases:
      //   old rent fully paid  → unearnedOldDebt=0 → delta=+newRent → balance += newRent
      //   old rent fully unpaid → unearnedOldDebt=oldAmount → delta=newRent−oldAmount
      //   delta=0 (same amt, unpaid) → no ledger entry, just reset the record
      const oldBilledAmount  = currentRecord.amount;
      const oldPaidAmount    = currentRecord.paidAmount ?? 0;
      const unearnedOldDebt  = Math.max(0, oldBilledAmount - oldPaidAmount);
      const ledgerDelta      = newRent - unearnedOldDebt;
      const newLedgerBalance = prevLedgerBalance + ledgerDelta;

      // advance = pure credit the tenant holds BEFORE this adjustment
      const advance        = Math.max(0, -prevLedgerBalance);
      const advanceApplied = newRent > 0 ? Math.min(advance, newRent) : 0;

      // Step 1 — reset the record to a clean slate for the new rent
      currentRecord.amount     = newRent;
      currentRecord.paidAmount = 0;
      currentRecord.status     = 'pending';
      await currentRecord.save(); // pre-save hook: balance = newRent

      // Step 2 — write a delta LedgerEntry (skip when delta=0 to avoid noise)
      if (ledgerDelta !== 0) {
        const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        let description = `Rent for ${MONTH_SHORT[curMonth - 1]} ${curYear}: Room ${room.roomNumber} → Room ${targetRoom.roomNumber} (₹${fromRent} → ₹${newRent})`;
        if (advanceApplied > 0) {
          description += ` · ₹${advanceApplied} advance applied`;
        }

        await LedgerEntry.create({
          tenant:        tenant._id,
          property:      req.params.propertyId,
          type:          ledgerDelta > 0 ? 'debit' : 'credit',
          amount:        Math.abs(ledgerDelta),
          balanceAfter:  newLedgerBalance,
          referenceType: 'rent_generated',
          referenceId:   currentRecord._id,
          description,
        });
      }

      await Tenant.updateOne({ _id: tenant._id }, { ledgerBalance: newLedgerBalance });
      logger.info('bed.change.rent_reset', {
        traceId, tenantId: tenant._id,
        month: curMonth, year: curYear,
        prevLedgerBalance, newRent, oldBilledAmount, oldPaidAmount,
        unearnedOldDebt, ledgerDelta, newLedgerBalance, advance, advanceApplied,
      });

      // Step 3 — apply advance to paidAmount (record-only; ledger already reflects it)
      if (advanceApplied > 0) {
        currentRecord.paidAmount = advanceApplied;
        currentRecord.status     = advanceApplied >= newRent ? 'paid' : 'partial';
        if (advanceApplied >= newRent) currentRecord.paymentDate = new Date();
        await currentRecord.save();
      }
    } else {
      // ── No billing record for this cycle yet ─────────────────────────────────
      // Rent will be generated at the correct new rate by the cron /
      // ensureCurrentCycleRentForTenant. No ledger entry is written here.
      //
      // Preserve prevLedgerBalance in the cached field — do NOT sync to the sum
      // of open records (which would be 0 when all prior records are paid, silently
      // wiping any advance credit the tenant holds). The ledger is authoritative;
      // the Tenant.ledgerBalance cache must reflect it at all times.
      await Tenant.updateOne({ _id: tenant._id }, { ledgerBalance: prevLedgerBalance });
    }
  } catch (err) {
    logger.warn('bed.change.rent_reset_failed', { traceId, tenantId: tenant._id, error: err.message });
  }

  // ── Persist transfer history (non-blocking — audit trail only) ────────────────
  const toRent = updatedTargetBed?.tenant?.rentAmount ?? 0;
  Tenant.findByIdAndUpdate(tenant._id, {
    $push: {
      transferHistory: {
        fromBed:        sourceBed._id,
        fromRoom:       room._id,
        toBed:          targetBed._id,
        toRoom:         targetRoom._id,
        fromBedNumber:  sourceBed.bedNumber,
        fromRoomNumber: room.roomNumber,
        toBedNumber:    targetBed.bedNumber,
        toRoomNumber:   targetRoom.roomNumber,
        fromRent,
        toRent,
        changedBy:      req.user._id,
        traceId,
        transferredAt:  new Date(),
      },
    },
  }).catch((err) =>
    logger.warn('bed.change.history_write_failed', { traceId, tenantId: tenant._id, error: err.message })
  );

  logger.info('bed.changed', {
    traceId,
    tenantId:     tenant._id,
    sourceBedId:  sourceBed._id,
    targetBedId:  targetBed._id,
    sourceRoomId: req.params.roomId,
    targetRoomId: targetRoom._id,
    finalRent:    updatedTargetBed?.tenant?.rentAmount,
    userId:       req.user._id,
  });

  res.json({
    success: true,
    message: 'Tenant moved to new bed successfully',
    data: {
      sourceBed: { _id: sourceBed._id, bedNumber: sourceBed.bedNumber, status: 'vacant' },
      targetBed: updatedTargetBed,
      tenant:    { _id: tenant._id, name: tenant.name, newRent: updatedTargetBed?.tenant?.rentAmount },
    },
  });
});

// ── Bulk Bed Operations ──────────────────────────────────────────────────────

// PATCH /api/properties/:propertyId/rooms/:roomId/beds/bulk/block
const bulkBlockBeds = asyncHandler(async (req, res) => {
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

  const { bedIds } = req.body;
  const beds = await Bed.find({ _id: { $in: bedIds }, room: req.params.roomId, isActive: true });

  const blocked  = [];
  const skipped  = [];

  for (const bed of beds) {
    if (bed.status === 'occupied') {
      skipped.push({ bedId: bed._id, bedNumber: bed.bedNumber, reason: 'occupied' });
      continue;
    }
    if (bed.status === 'blocked') {
      skipped.push({ bedId: bed._id, bedNumber: bed.bedNumber, reason: 'already blocked' });
      continue;
    }
    bed.status = 'blocked';
    bed.reservedTill = null;
    await bed.save();
    blocked.push({ bedId: bed._id, bedNumber: bed.bedNumber });
  }

  logger.info('bed.bulk.blocked', { roomId: req.params.roomId, blocked: blocked.length, skipped: skipped.length, userId: req.user._id });
  res.json({ success: true, message: `${blocked.length} bed(s) blocked`, data: { blocked, skipped } });
});

// PATCH /api/properties/:propertyId/rooms/:roomId/beds/bulk/unblock
const bulkUnblockBeds = asyncHandler(async (req, res) => {
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

  const { bedIds } = req.body;
  const beds = await Bed.find({ _id: { $in: bedIds }, room: req.params.roomId, isActive: true });

  const unblocked = [];
  const skipped   = [];

  for (const bed of beds) {
    if (bed.status !== 'blocked') {
      skipped.push({ bedId: bed._id, bedNumber: bed.bedNumber, reason: `status is ${bed.status}` });
      continue;
    }
    bed.status = 'vacant';
    await bed.save();
    unblocked.push({ bedId: bed._id, bedNumber: bed.bedNumber });
  }

  logger.info('bed.bulk.unblocked', { roomId: req.params.roomId, unblocked: unblocked.length, skipped: skipped.length, userId: req.user._id });
  res.json({ success: true, message: `${unblocked.length} bed(s) unblocked`, data: { unblocked, skipped } });
});

// PATCH /api/properties/:propertyId/rooms/:roomId/beds/bulk/vacate
const bulkVacateBeds = asyncHandler(async (req, res) => {
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

  const { bedIds } = req.body;
  const beds = await Bed.find({ _id: { $in: bedIds }, room: req.params.roomId, isActive: true });

  const vacated = [];
  const skipped = [];

  for (const bed of beds) {
    if (bed.status !== 'occupied' || !bed.tenant) {
      skipped.push({ bedId: bed._id, bedNumber: bed.bedNumber, reason: 'not occupied' });
      continue;
    }
    const tenant = await Tenant.findById(bed.tenant);
    if (!tenant) {
      skipped.push({ bedId: bed._id, bedNumber: bed.bedNumber, reason: 'tenant not found' });
      continue;
    }
    bed.status = 'vacant';
    bed.tenant = null;
    await bed.save();
    tenant.status       = 'vacated';
    tenant.checkOutDate = new Date();
    tenant.bed          = null;
    await tenant.save();
    vacated.push({ bedId: bed._id, bedNumber: bed.bedNumber, tenantName: tenant.name });
  }

  // Recalculate rent for any remaining occupied tenants (per_room divisor changes)
  if (vacated.length > 0) {
    const traceId = crypto.randomUUID();
    await recalculateRoomRent(room, null, 'vacate', traceId);
  }

  logger.info('bed.bulk.vacated', { roomId: req.params.roomId, vacated: vacated.length, skipped: skipped.length, userId: req.user._id });
  res.json({ success: true, message: `${vacated.length} bed(s) vacated`, data: { vacated, skipped } });
});

// GET /api/properties/:propertyId/rooms/:roomId/beds/:id/rent-preview
// Returns estimated rent for the given bed assuming one more tenant is added.
// Read-only — does NOT modify any data.
const rentPreview = asyncHandler(async (req, res) => {
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  const bed = await Bed.findOne({ _id: req.params.id, room: req.params.roomId, isActive: true });
  if (!bed) {
    return res.status(404).json({ success: false, message: 'Bed not found' });
  }

  if (!room.baseRent || room.baseRent <= 0 || !room.rentType) {
    return res.status(400).json({
      success: false,
      message: 'Room configuration incomplete — set baseRent and rentType first',
      code:    'INVALID_ROOM_CONFIG',
    });
  }

  // Current normal (non-extra) occupied count — authoritative from DB
  const currentOccupied = await Bed.countDocuments({
    room:     req.params.roomId,
    isActive: true,
    status:   'occupied',
    isExtra:  false,
  });

  // Total active beds for capacity check
  const totalBeds = await Bed.countDocuments({ room: req.params.roomId, isActive: true });

  const futureOccupied = bed.isExtra ? currentOccupied : currentOccupied + 1;

  const { finalRent, source } = calculateRent({ room, bed, normalOccupied: futureOccupied });

  const overrideApplied = source === 'override';
  const isExtraResult   = source.startsWith('extra');

  let formula;
  switch (source) {
    case 'override':       formula = `Override: ₹${finalRent}`; break;
    case 'extra_free':     formula = 'Free (non-chargeable)'; break;
    case 'extra_custom':   formula = `Extra charge: ₹${finalRent}`; break;
    case 'extra_fallback': formula = `Room base rent: ₹${finalRent}`; break;
    default:               formula = `₹${room.baseRent} per bed`;
  }

  res.json({
    success: true,
    data: {
      finalRent,
      source,
      rentType:         isExtraResult ? 'extra' : 'per_bed',
      formula,
      overrideApplied,
      isExtra:          isExtraResult,
      baseRent:         room.baseRent,
      currentOccupied,
      futureOccupied,
      isChargeable:     bed.isChargeable,
      extraCharge:      bed.extraCharge ?? 0,
      isOverCapacity:   totalBeds > room.capacity,
    },
  });
});

// PATCH /api/properties/:propertyId/rooms/:roomId/beds/:id/move-reservation
// Body: { targetBedId }
// Moves a reservation from a reserved bed to a different vacant bed.
// Simpler than changeBed — no rent recalculation (tenant is still a lead, not active).
const moveReservation = asyncHandler(async (req, res) => {
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  const { targetBedId } = req.body;
  if (!targetBedId) {
    return res.status(400).json({ success: false, message: 'targetBedId is required', code: 'MISSING_FIELD' });
  }

  const sourceBed = await Bed.findOne({ _id: req.params.id, room: req.params.roomId, isActive: true });
  if (!sourceBed) {
    return res.status(404).json({ success: false, message: 'Source bed not found', code: 'BED_NOT_FOUND' });
  }
  if (sourceBed.status !== 'reserved') {
    return res.status(400).json({
      success: false,
      message: `Can only move a reservation from a reserved bed. Current status: '${sourceBed.status}'`,
      code: 'INVALID_STATE',
    });
  }

  if (String(targetBedId) === String(sourceBed._id)) {
    return res.status(400).json({ success: false, message: 'Target bed is the same as source bed', code: 'SAME_BED' });
  }

  const targetBed = await Bed.findOne({ _id: targetBedId, property: req.params.propertyId, isActive: true });
  if (!targetBed) {
    return res.status(404).json({ success: false, message: 'Target bed not found', code: 'TARGET_BED_NOT_FOUND' });
  }
  if (targetBed.status !== 'vacant') {
    return res.status(409).json({
      success: false,
      message: `Target bed must be vacant. Current status: '${targetBed.status}'`,
      code: 'TARGET_BED_NOT_VACANT',
    });
  }

  const traceId = crypto.randomUUID();
  logger.info('bed.move_reservation.start', {
    traceId,
    sourceBedId: sourceBed._id,
    targetBedId: targetBed._id,
    tenantId: sourceBed.tenant,
    userId: req.user._id,
  });

  try {
    await runWithRetry(async (session) => {
      // Copy reservation data to target bed and mark it reserved
      targetBed.status       = 'reserved';
      targetBed.tenant       = sourceBed.tenant;
      targetBed.reservedTill = sourceBed.reservedTill;
      targetBed.reservation  = { ...(sourceBed.reservation?.toObject?.() ?? sourceBed.reservation ?? {}) };
      await targetBed.save({ session });

      // Free the source bed
      sourceBed.status       = 'vacant';
      sourceBed.tenant       = null;
      sourceBed.reservedTill = null;
      sourceBed.reservation  = { tenantId: null, name: null, phone: null, moveInDate: null, notes: null };
      await sourceBed.save({ session });

      // Point the lead tenant's bed reference at the new bed (if it was set)
      if (sourceBed.tenant) {
        await Tenant.updateOne(
          { _id: sourceBed.tenant, status: { $in: ['reserved', 'vacated'] } },
          { $set: { bed: targetBed._id } },
          { session }
        );
      }
    });
  } catch (err) {
    logger.error('bed.move_reservation.transaction_failed', {
      traceId, sourceBedId: sourceBed._id, targetBedId: targetBed._id, error: err.message,
    });
    throw err;
  }

  logger.info('bed.move_reservation.done', {
    traceId, sourceBedId: sourceBed._id, targetBedId: targetBed._id, tenantId: sourceBed.tenant,
  });

  const updatedTarget = await Bed.findById(targetBed._id)
    .populate('tenant', 'name phone status checkInDate');
  res.json({
    success: true,
    message: 'Reservation moved successfully',
    data: updatedTarget,
  });
});

// PATCH /api/properties/:propertyId/rooms/:roomId/beds/:id/deposit-adjust
// Mid-stay: apply a portion of depositBalance against outstanding rent dues.
const midStayDepositAdjust = asyncHandler(async (req, res) => {
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

  const bed = await fetchBed(req.params.id, req.params.roomId);
  if (!bed) return res.status(404).json({ success: false, message: 'Bed not found' });

  if (bed.status !== 'occupied' || !bed.tenant) {
    return res.status(400).json({ success: false, message: 'Bed has no active tenant', code: 'INVALID_STATE' });
  }

  const tenant = await Tenant.findById(bed.tenant);
  if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });

  const depositBal = tenant.depositBalance ?? 0;
  if (depositBal <= 0) {
    return res.status(400).json({ success: false, message: 'No deposit balance to adjust', code: 'NO_DEPOSIT' });
  }

  const { amount } = req.body;
  const adjustAmt = amount ? Number(amount) : depositBal;

  if (!adjustAmt || adjustAmt <= 0) {
    return res.status(400).json({ success: false, message: 'amount must be positive', code: 'INVALID_AMOUNT' });
  }
  if (adjustAmt > depositBal) {
    return res.status(400).json({
      success: false,
      message: `Amount ₹${adjustAmt} exceeds deposit balance ₹${depositBal}`,
      code: 'EXCEEDS_DEPOSIT',
    });
  }

  // Check there are outstanding dues to apply against
  const openRents = await RentPayment.find({
    tenant:   tenant._id,
    property: req.params.propertyId,
    status:   { $in: ['pending', 'partial', 'overdue'] },
  }).lean();
  const pendingTotal = openRents.reduce((s, r) => s + (r.amount - (r.paidAmount ?? 0)), 0);
  if (pendingTotal <= 0) {
    return res.status(400).json({ success: false, message: 'No outstanding dues to adjust against', code: 'NO_DUES' });
  }

  const applyAmt = Math.min(adjustAmt, pendingTotal);
  const traceId  = crypto.randomUUID();

  try {
    await rentService.allocatePayment(req.params.propertyId, tenant._id, {
      amount:      applyAmt,
      method:      'deposit_adjustment',
      notes:       'Mid-stay deposit adjustment',
      paymentDate: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('bed.deposit_adjust.failed', { traceId, tenantId: tenant._id, error: err.message });
    return res.status(400).json({ success: false, message: err.message || 'Failed to apply deposit', code: 'ADJUSTMENT_ERROR' });
  }

  // Update deposit balance
  const newDepositBal = Math.max(0, depositBal - applyAmt);
  await Tenant.updateOne(
    { _id: tenant._id },
    { $set: { depositBalance: newDepositBal, depositStatus: newDepositBal > 0 ? 'held' : 'adjusted' } }
  );

  // Audit ledger entry — derive balance from LedgerEntry after allocatePayment has written its entry
  await LedgerEntry.create({
    tenant:        tenant._id,
    property:      req.params.propertyId,
    type:          'credit',
    amount:        applyAmt,
    balanceAfter:  await rentService.getTenantBalance(tenant._id),
    referenceType: 'deposit_adjusted',
    referenceId:   tenant._id,
    method:        'deposit_adjustment',
    description:   `Security deposit ₹${applyAmt} applied against outstanding dues (mid-stay)`,
  });

  logger.info('bed.deposit_adjust.done', { traceId, tenantId: tenant._id, applyAmt, newDepositBal });

  res.json({
    success: true,
    message: `₹${applyAmt.toLocaleString('en-IN')} applied from deposit against dues`,
    data: {
      appliedAmount:  applyAmt,
      depositBalance: newDepositBal,
      depositStatus:  newDepositBal > 0 ? 'held' : 'adjusted',
    },
  });
});

module.exports = {
  getBeds,
  getBed,
  createBed,
  createExtraBed,
  updateBed,
  deleteBed,
  assignBed,
  vacateCheck,
  vacateBed,
  reserveBed,
  cancelReservation,
  blockBed,
  unblockBed,
  changeBed,
  moveReservation,
  getRoomAnalytics,
  getRoomFinancials,
  getRoomActivity,
  bulkBlockBeds,
  bulkUnblockBeds,
  rentPreview,
  bulkVacateBeds,
  midStayDepositAdjust,
  updateExtraBedSettings,
  // Backward-compat aliases
  assignTenant:   assignBed,
  checkoutTenant: vacateBed,
  unreserveBed:   cancelReservation,
};
