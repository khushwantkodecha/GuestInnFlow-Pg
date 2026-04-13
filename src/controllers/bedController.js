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
    .populate('tenant', 'name phone status checkInDate rentAmount dueDate depositAmount bed billingSnapshot');

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
    .populate('tenant', 'name phone status checkInDate rentAmount depositAmount depositPaid depositReturned billingSnapshot profileStatus aadharNumber address emergencyContact ledgerBalance');
  res.json({ success: true, count: beds.length, data: beds });
});

// GET /api/properties/:propertyId/rooms/:roomId/beds/:id
const getBed = asyncHandler(async (req, res) => {
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  const bed = await Bed.findOne({ _id: req.params.id, room: req.params.roomId })
    .populate('tenant', 'name phone status checkInDate rentAmount dueDate billingSnapshot');
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
      // Lead tenant linked to an expired hold — clear their bed reference
      await Tenant.findOneAndUpdate(
        { _id: bed.tenant, status: 'lead' },
        { $unset: { bed: 1 }, $set: { status: 'vacated' } },
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
// Body: { tenantId, rentOverride?, deposit?, moveInDate? }
const assignBed = asyncHandler(async (req, res) => {
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  const { tenantId, rentOverride, deposit, moveInDate } = req.body;

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

  // Heal stale bed reference on vacated tenants so they surface in assignable searches
  if (tenant.status === 'vacated' && tenant.bed) {
    logger.warn('assign.stale_bed_ref.heal', { tenantId: tenant._id, staleBed: tenant.bed });
    tenant.bed = null;
    await tenant.save();
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

  // ── Orphan cleanup: if bed was reserved for a DIFFERENT lead, free that lead ─
  if (bed.status === 'reserved' && bed.tenant && String(bed.tenant) !== String(tenantId)) {
    const orphanedLead = await Tenant.findOne({ _id: bed.tenant, status: 'lead' });
    if (orphanedLead) {
      orphanedLead.status = 'vacated';
      orphanedLead.bed    = null;
      await orphanedLead.save();
      logger.info('bed.assign.orphan_lead_vacated', { bedId: bed._id, orphanedTenantId: orphanedLead._id });
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
      bed.reservation  = { tenantId: null, name: null, phone: null, moveInDate: null, notes: null, source: 'lead' };
      await bed.save({ session });

      tenant.bed          = bed._id;
      tenant.status       = 'active';
      tenant.checkOutDate = null;
      // Seed rentAmount with a placeholder; recalculate overwrites it below
      tenant.rentAmount   = 0;
      if (deposit !== undefined) tenant.depositAmount = Number(deposit);
      if (moveInDate)            tenant.checkInDate   = new Date(moveInDate);
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

  // ── Apply advance credit to tenant ledger (adjust mode only) ─────────────
  if (capturedAdvAmt > 0 && capturedAdvMode === 'adjust') {
    const freshTenant = updatedBed?.tenant ?? await Tenant.findById(tenantId);
    if (freshTenant) {
      const prevBalance = freshTenant.ledgerBalance ?? 0;
      const newBalance  = prevBalance - capturedAdvAmt; // credit reduces what tenant owes
      await LedgerEntry.create({
        tenant:        freshTenant._id,
        property:      req.params.propertyId,
        type:          'credit',
        amount:        capturedAdvAmt,
        balanceAfter:  newBalance,
        referenceType: 'reservation_advance',
        referenceId:   bed._id,
        description:   `Reservation advance applied to first rent (adjust mode)`,
      });
      await Tenant.updateOne({ _id: freshTenant._id }, { $set: { ledgerBalance: newBalance } });
      // Mark reservation advance as converted on the bed
      await updatedBed.updateOne({ $set: { 'reservation.reservationStatus': 'converted' } });
      logger.info('bed.assign.advance_applied', {
        traceId, tenantId: freshTenant._id, amount: capturedAdvAmt, newBalance,
      });
    }
  }

  // ── Record deposit (if any) ──────────────────────────────────────────────────
  const depositFromBody = deposit !== undefined ? Number(deposit) : 0;
  if (depositFromBody > 0) {
    await Tenant.updateOne(
      { _id: tenantId },
      { $set: { depositBalance: depositFromBody, depositStatus: 'held', depositPaid: true } }
    );
    // Audit-only ledger entry — does NOT affect rent ledgerBalance
    const freshForDeposit = await Tenant.findById(tenantId).select('ledgerBalance').lean();
    await LedgerEntry.create({
      tenant:        tenantId,
      property:      req.params.propertyId,
      type:          'credit',
      amount:        depositFromBody,
      balanceAfter:  freshForDeposit?.ledgerBalance ?? 0,  // balance unchanged
      referenceType: 'deposit_collected',
      referenceId:   bed._id,
      description:   `Security deposit collected at assignment`,
    });
    logger.info('bed.assign.deposit_recorded', { traceId, tenantId, amount: depositFromBody });
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
        _id:             tenant._id,
        name:            tenant.name,
        phone:           tenant.phone,
        rentAmount:      tenant.rentAmount,
        depositAmount:   tenant.depositAmount  ?? 0,
        depositPaid:     tenant.depositPaid    ?? false,
        depositReturned: tenant.depositReturned ?? false,
        depositBalance:  tenant.depositBalance ?? 0,
        depositStatus:   tenant.depositStatus  ?? null,
        checkInDate:     tenant.checkInDate,
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

  // Already vacated guard (double-submit / race condition)
  if (tenant.status === 'vacated') {
    return res.status(409).json({
      success: false,
      message: 'Tenant is already vacated',
      code: 'ALREADY_VACATED',
    });
  }

  const {
    checkOutDate, notes,
    vacateOption,    // 'collect' | 'proceed'
    paymentAmount,   // used when vacateOption === 'collect'
    paymentMethod,   // used when vacateOption === 'collect'
    depositAction,   // 'adjust' | 'refund' | null
    refundAmount,    // used when depositAction === 'refund'; defaults to depositBalance
    refundMethod,    // payment method used to return deposit (for audit description)
  } = req.body;
  const traceId = crypto.randomUUID();

  // ── Step 1a: Deposit action ────────────────────────────────────────────────
  let depositAdjustedAmount = 0;
  if (depositAction === 'adjust') {
    const depositBal = tenant.depositBalance ?? tenant.depositAmount ?? 0;
    if (depositBal > 0) {
      const openRents = await RentPayment.find({
        tenant:   tenant._id,
        property: req.params.propertyId,
        status:   { $in: ['pending', 'partial', 'overdue'] },
      }).lean();
      const pendingTotal = openRents.reduce((s, r) => s + (r.amount - (r.paidAmount ?? 0)), 0);
      const applyAmt = Math.min(depositBal, pendingTotal);
      if (applyAmt > 0) {
        try {
          await rentService.allocatePayment(req.params.propertyId, tenant._id, {
            amount:      applyAmt,
            method:      'deposit_adjustment',
            notes:       'Adjusted from security deposit at vacate',
            paymentDate: checkOutDate ?? new Date().toISOString(),
          });
          depositAdjustedAmount = applyAmt;
          logger.info('bed.vacate.deposit_adjusted', { traceId, tenantId: tenant._id, amount: applyAmt });
        } catch (adjErr) {
          logger.error('bed.vacate.deposit_adjust_failed', { traceId, tenantId: tenant._id, error: adjErr.message });
          return res.status(400).json({ success: false, message: adjErr.message || 'Failed to adjust deposit', code: 'ADJUSTMENT_ERROR' });
        }
      }
    }
  }

  // ── Step 1b: Collect cash payment ─────────────────────────────────────────
  if (vacateOption === 'collect') {
    const amt = Number(paymentAmount);
    if (!amt || amt <= 0) {
      return res.status(400).json({ success: false, message: 'paymentAmount must be positive for collect option', code: 'INVALID_PAYMENT' });
    }
    try {
      await rentService.allocatePayment(req.params.propertyId, tenant._id, {
        amount:      amt,
        method:      paymentMethod ?? 'cash',
        notes:       'Collected at vacate',
        paymentDate: checkOutDate ?? new Date().toISOString(),
      });
      logger.info('bed.vacate.payment_collected', { traceId, tenantId: tenant._id, amount: amt });
    } catch (payErr) {
      logger.error('bed.vacate.payment_failed', { traceId, tenantId: tenant._id, error: payErr.message });
      return res.status(400).json({ success: false, message: payErr.message || 'Failed to record payment', code: 'PAYMENT_ERROR' });
    }
  }
  // vacateOption === 'proceed' (or undefined): skip cash collection, vacate as-is

  // ── Step 2: Vacate the bed and tenant ────────────────────────────────────────
  try {
    await runWithRetry(async (session) => {
      bed.status = 'vacant';
      bed.tenant = null;
      await bed.save({ session });

      tenant.status       = 'vacated';
      tenant.checkOutDate = checkOutDate ? new Date(checkOutDate) : new Date();
      tenant.bed          = null;
      if (notes !== undefined) tenant.vacateNotes = notes || null;

      // Apply deposit state changes inside the transaction
      if (depositAction === 'adjust' && depositAdjustedAmount > 0) {
        const prevBal = tenant.depositBalance ?? tenant.depositAmount ?? 0;
        const newBal  = Math.max(0, prevBal - depositAdjustedAmount);
        tenant.depositBalance = newBal;
        tenant.depositStatus  = newBal > 0 ? 'held' : 'adjusted';
      } else if (depositAction === 'refund') {
        const depBal = tenant.depositBalance ?? tenant.depositAmount ?? 0;
        const refAmt = refundAmount > 0 ? Math.min(Number(refundAmount), depBal) : depBal;
        tenant.depositBalance  = Math.max(0, depBal - refAmt);
        tenant.depositStatus   = tenant.depositBalance > 0 ? 'held' : 'refunded';
        tenant.depositReturned = tenant.depositBalance === 0;
      }

      await tenant.save({ session });

      // Recalculate rent for remaining occupied tenants (per_room divisor changes)
      await recalculateRoomRent(room, session, 'vacate', traceId);
    });
  } catch (err) {
    logger.error('bed.vacate.transaction_failed', { traceId, bedId: bed._id, tenantId: tenant._id, error: err.message });
    throw err;
  }

  // ── Deposit audit ledger entries (after transaction) ────────────────────────
  if (depositAction === 'adjust' && depositAdjustedAmount > 0) {
    await LedgerEntry.create({
      tenant:        tenant._id,
      property:      req.params.propertyId,
      type:          'credit',
      amount:        depositAdjustedAmount,
      balanceAfter:  tenant.ledgerBalance ?? 0,  // balance already updated by allocatePayment
      referenceType: 'deposit_adjusted',
      referenceId:   tenant._id,
      method:        'deposit_adjustment',
      description:   `Security deposit ₹${depositAdjustedAmount} adjusted against dues at vacate`,
    });
  } else if (depositAction === 'refund') {
    const depBal      = tenant.depositBalance ?? tenant.depositAmount ?? 0;
    const refundedAmt = refundAmount > 0
      ? Math.min(Number(refundAmount), depBal)
      : depBal;
    if (refundedAmt > 0) {
      const methodLabel = refundMethod ?? 'cash';
      await LedgerEntry.create({
        tenant:        tenant._id,
        property:      req.params.propertyId,
        type:          'credit',
        amount:        refundedAmt,
        balanceAfter:  tenant.ledgerBalance ?? 0,  // informational — rent balance unchanged
        referenceType: 'deposit_refunded',
        referenceId:   tenant._id,
        method:        methodLabel,
        description:   `Security deposit ₹${refundedAmt} refunded to tenant at vacate via ${methodLabel}`,
      });
    }
  }

  logger.info('bed.vacated', {
    traceId,
    bedId:           bed._id,
    tenantId:        tenant._id,
    roomId:          req.params.roomId,
    depositAction,
    depositReturned: tenant.depositReturned,
    userId:          req.user._id,
  });

  res.json({
    success: true,
    message: 'Bed vacated successfully',
    data: {
      bed:    { _id: bed._id, bedNumber: bed.bedNumber, status: bed.status },
      tenant: {
        _id: tenant._id, name: tenant.name, checkOutDate: tenant.checkOutDate,
        depositReturned: tenant.depositReturned,
        depositBalance:  tenant.depositBalance,
        depositStatus:   tenant.depositStatus,
      },
    },
  });
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
          reservationAmount: rawAdvAmt, reservationMode: rawAdvMode } = req.body;

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
    // ── Path A: existing tenant (active / notice / lead) ─────────────────────
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
    const occupiedBed = await Bed.findOne({ tenant: tenant._id, status: 'occupied', isActive: true }).lean();
    if (occupiedBed) {
      return res.status(409).json({
        success: false,
        message: `${tenant.name} is already assigned to a bed. Vacate them first.`,
        code: 'TENANT_ASSIGNED',
      });
    }
  } else {
    // ── Path B: find-or-create a lead tenant by phone ─────────────────────────
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

    // Reuse an existing lead with the same phone, or create one
    const existingLead = await Tenant.findOne({
      property: req.params.propertyId,
      phone:    phone.trim(),
      status:   'lead',
    });

    if (existingLead) {
      tenant = existingLead;
      tenant.name = name.trim();
    } else {
      tenant = new Tenant({
        property:    req.params.propertyId,
        name:        name.trim(),
        phone:       phone.trim(),
        status:      'lead',
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
            source:            'lead',
            reservationAmount: oldAdvAmt,
            reservationMode:   oldAdvAmt > 0 ? oldAdvMode : null,
            reservationStatus: oldAdvAmt > 0 ? 'cancelled' : null,
          },
        },
      }
    );

    // Refund any held advance when the reservation is displaced
    if (oldAdvAmt > 0 && existingReservedBed.tenant) {
      const replacedTenant = await Tenant.findById(existingReservedBed.tenant).select('ledgerBalance property');
      if (replacedTenant) {
        const prevBal = replacedTenant.ledgerBalance ?? 0;
        const newBal  = prevBal - oldAdvAmt;
        await LedgerEntry.create({
          tenant:        replacedTenant._id,
          property:      replacedTenant.property,
          type:          'credit',
          amount:        oldAdvAmt,
          balanceAfter:  newBal,
          referenceType: 'refund',
          referenceId:   existingReservedBed._id,
          description:   `Reservation advance refunded — reservation replaced by another bed (${oldAdvMode} mode)`,
        });
        await Tenant.updateOne({ _id: replacedTenant._id }, { $set: { ledgerBalance: newBal } });
        logger.info('bed.reservation.replaced.advance_refunded', {
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

  // ── Link bed ↔ tenant ─────────────────────────────────────────────────────
  tenant.bed = bed._id;
  if (tenant.status === 'lead' && moveInDate) {
    tenant.checkInDate = new Date(moveInDate);
  }
  await tenant.save();

  bed.status       = 'reserved';
  bed.reservedTill = new Date(reservedTill);
  bed.tenant       = tenant._id;
  bed.reservation  = {
    tenantId:          tenant._id,
    name:              tenant.name,
    phone:             tenant.phone,
    moveInDate:        moveInDate ? new Date(moveInDate) : null,
    notes:             notes || null,
    source:            tenantId ? 'existing_tenant' : 'lead',
    reservationAmount: advAmt,
    reservationMode:   advMode,
    reservationStatus: advAmt > 0 ? 'held' : null,
  };
  await bed.save();

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

  // Clean up the linked lead tenant (do not touch active/notice tenants)
  if (bed.tenant) {
    const linkedTenant = await Tenant.findOne({ _id: bed.tenant, status: 'lead' });
    if (linkedTenant) {
      linkedTenant.status = 'vacated';
      linkedTenant.bed    = null;
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
    source:            'lead',
    reservationAmount: cancelAdvAmt,
    reservationMode:   cancelAdvAmt > 0 ? cancelAdvMode : null,
    reservationStatus: cancelAdvAmt > 0 ? 'cancelled' : null,
  };
  await bed.save();

  // ── Record refund ledger entry (both adjust and refund modes) ─────────────
  if (cancelAdvAmt > 0 && cancelTenantId) {
    const refundTenant = await Tenant.findById(cancelTenantId).select('ledgerBalance property');
    if (refundTenant) {
      const prevBalance = refundTenant.ledgerBalance ?? 0;
      // A refund is a credit that reduces the tenant's balance (they get money back)
      const newBalance  = prevBalance - cancelAdvAmt;
      await LedgerEntry.create({
        tenant:        refundTenant._id,
        property:      refundTenant.property,
        type:          'credit',
        amount:        cancelAdvAmt,
        balanceAfter:  newBalance,
        referenceType: 'refund',
        referenceId:   bed._id,
        description:   `Reservation advance refund on cancellation (${cancelAdvMode} mode)`,
      });
      await Tenant.updateOne({ _id: refundTenant._id }, { $set: { ledgerBalance: newBalance } });
      logger.info('bed.cancel.advance_refunded', {
        tenantId: refundTenant._id, amount: cancelAdvAmt, newBalance, mode: cancelAdvMode,
      });
    }
  }

  res.json({ success: true, message: 'Reservation cancelled', data: bed });
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
  // Clean up lead tenant when blocking a reserved bed
  if (wasReserved && bed.tenant) {
    const linkedTenant = await Tenant.findOne({ _id: bed.tenant, status: 'lead' });
    if (linkedTenant) {
      linkedTenant.status = 'vacated';
      linkedTenant.bed    = null;
      await linkedTenant.save();
    } else {
      await Tenant.updateOne({ _id: bed.tenant }, { $set: { bed: null } });
    }
  }
  bed.status = 'blocked';
  if (wasReserved) {
    bed.reservedTill = null;
    bed.tenant       = null;
    bed.reservation  = { tenantId: null, name: null, phone: null, moveInDate: null, notes: null, source: 'lead' };
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
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  const beds = await Bed.find({ room: req.params.roomId, isActive: true })
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
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  const beds = await Bed.find({ room: req.params.roomId, isActive: true })
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
  const room = await verifyRoomOwnership(req.params.roomId, req.params.propertyId, req.user._id);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  // All active beds in this room with current tenant
  const beds = await Bed.find({ room: req.params.roomId, isActive: true })
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
  if (targetBed.status !== 'vacant' && targetBed.status !== 'reserved') {
    return res.status(409).json({
      success: false,
      message: `Target bed status '${targetBed.status}' does not allow assignment`,
      code: 'INVALID_STATE',
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

  const traceId  = crypto.randomUUID();
  const sameRoom = String(sourceBed.room) === String(targetBed.room);

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
    .populate('tenant', 'name phone status rentAmount billingSnapshot');

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

  // Preview: +1 for the incoming normal tenant; extras don't affect divisor
  const futureOccupied = bed.isExtra ? currentOccupied : currentOccupied + 1;

  const { finalRent, source, meta } = calculateRent({ room, bed, normalOccupied: futureOccupied });

  // Derive display fields from the engine's source token for backward-compatible API response
  const overrideApplied = source === 'override';
  const isExtraResult   = source.startsWith('extra');
  const rentTypeDisplay = isExtraResult ? 'extra'
    : source === 'per_room_split'       ? 'per_room'
    : 'per_bed';

  let formula;
  switch (source) {
    case 'override':       formula = `Override: ₹${finalRent}`; break;
    case 'extra_free':     formula = 'Free (non-chargeable)'; break;
    case 'extra_custom':   formula = `Extra charge: ₹${finalRent}`; break;
    case 'extra_fallback': formula = `Room base rent: ₹${finalRent}`; break;
    case 'per_bed':        formula = `₹${room.baseRent} per bed`; break;
    case 'per_room_split': formula = `₹${room.baseRent} ÷ ${meta.divisor} occupant${meta.divisor !== 1 ? 's' : ''}`; break;
    default:               formula = `₹${finalRent}`;
  }

  res.json({
    success: true,
    data: {
      finalRent,
      source,                      // machine-readable engine token
      rentType:         rentTypeDisplay,
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
  getRoomAnalytics,
  getRoomFinancials,
  getRoomActivity,
  bulkBlockBeds,
  bulkUnblockBeds,
  rentPreview,
  bulkVacateBeds,
  // Backward-compat aliases
  assignTenant:   assignBed,
  checkoutTenant: vacateBed,
  unreserveBed:   cancelReservation,
};
