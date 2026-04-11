const crypto      = require('crypto');
const Bed         = require('../models/Bed');
const Room        = require('../models/Room');
const Property    = require('../models/Property');
const Tenant      = require('../models/Tenant');
const RentPayment = require('../models/RentPayment');
const asyncHandler = require('../utils/asyncHandler');
const { runWithRetry } = require('../utils/runWithRetry');

// ── Minimal structured logger ────────────────────────────────────────────────
const logger = {
  info:  (event, meta = {}) => console.log(JSON.stringify({ level: 'info',  ts: new Date().toISOString(), event, ...meta })),
  warn:  (event, meta = {}) => console.warn(JSON.stringify({ level: 'warn', ts: new Date().toISOString(), event, ...meta })),
  error: (event, meta = {}) => console.error(JSON.stringify({ level: 'error', ts: new Date().toISOString(), event, ...meta })),
};

// ── Constants ────────────────────────────────────────────────────────────────
const MIN_RENT = 500; // Safety floor — prevents absurd low rents in large dorms

// Non-dormitory types have a fixed capacity — no manual bed add/remove allowed
const FIXED_CAPACITY_TYPES = new Set(['single', 'double', 'triple']);
const MAX_EXTRA_BEDS_PER_ROOM = 2;

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

  const beds = await Bed.find(filter).populate('tenant', 'name phone status checkInDate rentAmount depositAmount depositPaid depositReturned billingSnapshot profileStatus aadharNumber address emergencyContact');
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

  const bed = await Bed.create({
    ...req.body,
    room:     req.params.roomId,
    property: req.params.propertyId,
    isExtra:  false,
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

  // ── Check extra bed limit ────────────────────────────────────────────────────
  const existingExtras = await Bed.find({
    room:    req.params.roomId,
    isExtra: true,
    isActive: true,
  }).select('bedNumber').sort({ createdAt: 1 });

  if (existingExtras.length >= MAX_EXTRA_BEDS_PER_ROOM) {
    logger.warn('bed.extra.limit_exceeded', {
      roomId:    req.params.roomId,
      limit:     MAX_EXTRA_BEDS_PER_ROOM,
      current:   existingExtras.length,
      userId:    req.user._id,
    });
    return res.status(400).json({
      success: false,
      message: `Maximum ${MAX_EXTRA_BEDS_PER_ROOM} extra beds allowed per room`,
      code:    'EXTRA_BED_LIMIT',
    });
  }

  // ── Generate next X label (X1, X2, X3…) ─────────────────────────────────────
  const usedNums = existingExtras
    .map((b) => parseInt(b.bedNumber.replace(/^X/, ''), 10))
    .filter((n) => !isNaN(n));
  let nextNum = 1;
  while (usedNums.includes(nextNum)) nextNum++;
  const bedNumber = `X${nextNum}`;

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
      message: 'Cannot deactivate an occupied bed. Check out the tenant first.',
      code: 'BED_OCCUPIED',
    });
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

  // Check for existing active bed assignment
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

  // ── Trace ID for production log correlation ────────────────────────────────
  const traceId = crypto.randomUUID();

  // ── Billing logic ─────────────────────────────────────────────────────────
  // Priority: 1) Extra bed  2) Bed rentOverride  3) Room rentType logic
  //
  // per_bed:  each tenant pays full baseRent
  // per_room: rent = floor(baseRent / divisor) — locked at assignment, never recalculated
  const divisor = totalOccupied + 1;
  const hasBedOverride = bed.rentOverride != null;
  const hasBodyOverride = rentOverride !== undefined && rentOverride !== null && rentOverride !== '';
  const overrideApplied = !!(hasBedOverride || hasBodyOverride);
  const overrideSource = hasBedOverride ? 'bed' : hasBodyOverride ? 'request' : null;
  let finalRent;

  if (bed.isExtra) {
    // Extra bed: chargeable → extraCharge (or baseRent if 0), non-chargeable → 0
    if (bed.isChargeable) {
      finalRent = bed.extraCharge > 0 ? bed.extraCharge : room.baseRent;
    } else {
      finalRent = 0;
    }
  } else if (hasBedOverride) {
    // Bed-level override takes precedence
    finalRent = bed.rentOverride;
  } else if (hasBodyOverride) {
    // Explicit rent override from assign request body
    finalRent = Number(rentOverride);
  } else if (room.rentType === 'per_room') {
    // Divide room rent among all occupants (Math.floor to prevent over-collection)
    finalRent = Math.floor(room.baseRent / divisor);
  } else {
    // per_bed (default): each tenant pays full baseRent
    finalRent = room.baseRent;
  }

  // ── Rent sanity checks ────────────────────────────────────────────────────
  if (finalRent < 0) {
    logger.error('bed.assign.negative_rent', { traceId, finalRent, roomId: req.params.roomId });
    return res.status(500).json({
      success: false,
      message: 'Rent calculation error: negative rent detected',
      code: 'RENT_CALC_ERROR',
    });
  }
  if (finalRent > room.baseRent && !overrideApplied && !bed.isExtra) {
    logger.warn('bed.assign.rent_exceeds_base', { traceId, finalRent, baseRent: room.baseRent });
  }

  // ── Minimum rent floor (safety net for large dorms) ───────────────────────
  if (finalRent > 0 && finalRent < MIN_RENT && !bed.isExtra) {
    logger.warn('bed.assign.below_min_rent', { traceId, calculated: finalRent, applied: MIN_RENT });
    finalRent = MIN_RENT;
  }

  // ── Fairness context ──────────────────────────────────────────────────────
  const isEarlyOccupant = room.rentType === 'per_room' && totalOccupied === 0;

  // ── Debug log (dev traceability) ─────────────────────────────────────────
  logger.info('bed.assign.rent_calculated', {
    traceId,
    roomId:          req.params.roomId,
    bedId:           bed._id,
    tenantId,
    rentType:        room.rentType,
    baseRent:        room.baseRent,
    occupiedBefore:  totalOccupied,
    divisor,
    overrideApplied,
    overrideSource,
    isEarlyOccupant,
    finalRent,
  });

  let updatedBed;
  try {
    await runWithRetry(async (session) => {
      bed.status      = 'occupied';
      bed.tenant      = tenant._id;
      bed.reservedTill = null;
      await bed.save({ session });

      tenant.bed         = bed._id;
      tenant.status      = 'active';
      tenant.checkOutDate = null;
      // IMPORTANT: Rent is locked at assignment time.
      // Do NOT recalculate or update rentAmount/billingSnapshot after this point.
      tenant.rentAmount = finalRent;
      tenant.billingSnapshot = {
        baseRent:         room.baseRent,
        rentType:         room.rentType,
        roomCapacity:     room.capacity,
        occupiedAtAssign: totalOccupied,
        divisorUsed:      divisor,
        isEarlyOccupant,
        overrideApplied,
        overrideSource,
        isExtra:          bed.isExtra,
        isChargeable:     bed.isChargeable,
        extraCharge:      bed.extraCharge,
        finalRent,
        traceId,
        assignedAt:       new Date(),
      };
      if (deposit !== undefined)  tenant.depositAmount = Number(deposit);
      if (moveInDate)             tenant.checkInDate   = new Date(moveInDate);
      await tenant.save({ session });
    });
  } catch (err) {
    logger.error('bed.assign.transaction_failed', { traceId, bedId: bed._id, tenantId, error: err.message });
    throw err;
  }

  updatedBed = await fetchBed(req.params.id, req.params.roomId);

  logger.info('bed.assigned', {
    traceId,
    bedId:     bed._id,
    tenantId:  tenant._id,
    roomId:    req.params.roomId,
    isExtra:   bed.isExtra,
    finalRent,
    userId:    req.user._id,
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
    .select('name phone rentAmount depositAmount depositPaid depositReturned checkInDate');
  if (!tenant) return res.status(404).json({ success: false, message: 'Tenant record not found' });

  const pendingRents = await RentPayment.find({
    tenant: tenant._id,
    status: { $in: ['pending', 'overdue'] },
  }).select('month year amount status dueDate').sort({ year: 1, month: 1 }).lean();

  const totalPendingAmount = pendingRents.reduce((sum, r) => sum + r.amount, 0);

  res.json({
    success: true,
    data: {
      tenant: {
        _id:             tenant._id,
        name:            tenant.name,
        phone:           tenant.phone,
        rentAmount:      tenant.rentAmount,
        depositAmount:   tenant.depositAmount ?? 0,
        depositPaid:     tenant.depositPaid ?? false,
        depositReturned: tenant.depositReturned ?? false,
        checkInDate:     tenant.checkInDate,
      },
      pendingRentCount:   pendingRents.length,
      totalPendingAmount,
      pendingRents,
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

  const { checkOutDate, notes, depositReturned } = req.body;

  try {
    await runWithRetry(async (session) => {
      bed.status = 'vacant';
      bed.tenant = null;
      await bed.save({ session });

      tenant.status       = 'vacated';
      tenant.checkOutDate = checkOutDate ? new Date(checkOutDate) : new Date();
      tenant.bed          = null;
      if (notes            !== undefined) tenant.vacateNotes     = notes || null;
      if (depositReturned  !== undefined) tenant.depositReturned = Boolean(depositReturned);
      await tenant.save({ session });
    });
  } catch (err) {
    logger.error('bed.vacate.transaction_failed', { bedId: bed._id, tenantId: tenant._id, error: err.message });
    throw err;
  }

  logger.info('bed.vacated', {
    bedId:           bed._id,
    tenantId:        tenant._id,
    roomId:          req.params.roomId,
    depositReturned: tenant.depositReturned,
    userId:          req.user._id,
  });

  res.json({
    success: true,
    message: 'Bed vacated successfully',
    data: {
      bed:    { _id: bed._id, bedNumber: bed.bedNumber, status: bed.status },
      tenant: { _id: tenant._id, name: tenant.name, checkOutDate: tenant.checkOutDate, depositReturned: tenant.depositReturned },
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

  const { reservedTill, name, phone, moveInDate, notes } = req.body;

  bed.status       = 'reserved';
  bed.reservedTill  = new Date(reservedTill);
  bed.reservation   = {
    name:       name,
    phone:      phone,
    moveInDate: moveInDate ? new Date(moveInDate) : null,
    notes:      notes || null,
  };
  await bed.save();

  logger.info('bed.reserved', {
    bedId:        bed._id,
    reservedTill: bed.reservedTill,
    leadName:     name,
    leadPhone:    phone,
    roomId:       req.params.roomId,
    userId:       req.user._id,
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

  bed.status       = 'vacant';
  bed.reservedTill  = null;
  bed.reservation   = { name: null, phone: null, moveInDate: null, notes: null };
  await bed.save();

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
  bed.status = 'blocked';
  if (wasReserved) {
    bed.reservedTill = null;
    bed.reservation  = { name: null, phone: null, moveInDate: null, notes: null };
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

  const normalBeds = beds.filter((b) => !b.isExtra);
  const extraBeds  = beds.filter((b) => b.isExtra);

  const occupiedNormal = normalBeds.filter((b) => b.status === 'occupied');
  const occupiedExtra  = extraBeds.filter((b) => b.status === 'occupied');

  const extraRevenue = occupiedExtra.reduce((sum, b) => {
    if (!b.isChargeable) return sum;
    return sum + (b.tenant?.rentAmount ?? 0);
  }, 0);

  const totalOccupied = occupiedNormal.length + occupiedExtra.length;
  const effectiveRevenue = beds.filter(b => b.status === 'occupied')
    .reduce((s, b) => s + (b.tenant?.rentAmount ?? 0), 0);
  const theoreticalEvenSplit = room.rentType === 'per_room'
    ? room.baseRent
    : room.capacity * room.baseRent;

  res.json({
    success: true,
    data: {
      roomId:        room._id,
      roomNumber:    room.roomNumber,
      capacity:      room.capacity,
      rentType:      room.rentType,
      totalBeds:     beds.length,
      normalBeds:    normalBeds.length,
      extraBeds:     extraBeds.length,
      occupiedBeds:  totalOccupied,
      vacantBeds:    beds.filter((b) => b.status === 'vacant').length,
      reservedBeds:  beds.filter((b) => b.status === 'reserved').length,
      occupancyRate: beds.length > 0 ? +(totalOccupied / beds.length).toFixed(2) : 0,
      effectiveRevenue,
      theoreticalEvenSplit,
      baseRevenue:   occupiedNormal.reduce((s, b) => s + (b.tenant?.rentAmount ?? 0), 0),
      extraRevenue,
      overCapacity:  beds.length > room.capacity,
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

  const occupiedBeds = beds.filter((b) => b.status === 'occupied');
  const occupiedExtra = extraBeds.filter((b) => b.status === 'occupied');

  // Max potential revenue depends on rentType:
  // per_bed:  each bed earns baseRent → capacity × baseRent
  // per_room: the room earns baseRent total (divided among tenants) → baseRent
  const potentialRevenue = room.rentType === 'per_room'
    ? room.baseRent
    : room.capacity * room.baseRent;
  const actualRevenue = occupiedBeds.reduce((sum, b) => sum + (b.tenant?.rentAmount ?? 0), 0);
  const extraRevenue  = occupiedExtra.reduce((sum, b) => {
    if (!b.isChargeable) return sum;
    return sum + (b.tenant?.rentAmount ?? 0);
  }, 0);
  const vacancyLoss   = Math.max(0, potentialRevenue - actualRevenue);

  res.json({
    success: true,
    data: {
      roomId:           room._id,
      roomNumber:       room.roomNumber,
      capacity:         room.capacity,
      rentType:         room.rentType,
      totalBeds:        beds.length,
      occupiedBeds:     occupiedBeds.length,
      extraBeds:        extraBeds.length,
      occupancyRate:    beds.length > 0 ? +(occupiedBeds.length / beds.length).toFixed(2) : 0,
      potentialRevenue,
      actualRevenue,
      extraRevenue,
      vacancyLoss,
      overCapacity:     beds.length > room.capacity,
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
    tenant.status      = 'vacated';
    tenant.checkOutDate = new Date();
    tenant.bed         = null;
    await tenant.save();
    vacated.push({ bedId: bed._id, bedNumber: bed.bedNumber, tenantName: tenant.name });
  }

  logger.info('bed.bulk.vacated', { roomId: req.params.roomId, vacated: vacated.length, skipped: skipped.length, userId: req.user._id });
  res.json({ success: true, message: `${vacated.length} bed(s) vacated`, data: { vacated, skipped } });
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
  getRoomAnalytics,
  getRoomFinancials,
  bulkBlockBeds,
  bulkUnblockBeds,
  bulkVacateBeds,
  // Backward-compat aliases
  assignTenant:   assignBed,
  checkoutTenant: vacateBed,
  unreserveBed:   cancelReservation,
};
