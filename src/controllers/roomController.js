const crypto       = require('crypto');
const Room         = require('../models/Room');
const Bed          = require('../models/Bed');
const Property     = require('../models/Property');
const RentPayment  = require('../models/RentPayment');
const asyncHandler  = require('../utils/asyncHandler');
const { runWithRetry }          = require('../utils/runWithRetry');
const { generateBedLabel }      = require('../utils/numberingUtils');
const { recalculateRoomRent }   = require('../utils/recalculateRoomRent');

const CAPACITY_MAP = { single: 1, double: 2, triple: 3 };

// ── Enum guard sets (defensive fallback if Zod is bypassed) ──────────────────
const VALID_TYPES      = new Set(['single', 'double', 'triple', 'dormitory']);
const VALID_RENT_TYPES = new Set(['per_bed', 'per_room']);
const VALID_GENDERS    = new Set(['male', 'female', 'unisex']);
const VALID_STATUSES   = new Set(['available', 'maintenance', 'blocked']);
const VALID_CATEGORIES = new Set(['standard', 'premium', 'luxury']);
const VALID_BN_TYPES   = new Set(['alphabet', 'numeric']);

// ── Minimal structured logger ────────────────────────────────────────────────
const logger = {
  info:  (event, meta = {}) => console.log(JSON.stringify({ level: 'info',  ts: new Date().toISOString(), event, ...meta })),
  warn:  (event, meta = {}) => console.warn(JSON.stringify({ level: 'warn', ts: new Date().toISOString(), event, ...meta })),
  error: (event, meta = {}) => console.error(JSON.stringify({ level: 'error', ts: new Date().toISOString(), event, ...meta })),
};

// Verify property belongs to logged-in user
const verifyPropertyOwnership = async (propertyId, userId) => {
  const property = await Property.findOne({ _id: propertyId, owner: userId, isActive: true });
  return property;
};

// GET /api/properties/:propertyId/rooms
const getRooms = asyncHandler(async (req, res) => {
  const property = await verifyPropertyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const rooms = await Room.find({ property: req.params.propertyId });
  res.json({ success: true, count: rooms.length, data: rooms });
});

// GET /api/properties/:propertyId/rooms/:id
const getRoom = asyncHandler(async (req, res) => {
  const property = await verifyPropertyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const room = await Room.findOne({ _id: req.params.id, property: req.params.propertyId });
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }
  res.json({ success: true, data: room });
});

// POST /api/properties/:propertyId/rooms
const createRoom = asyncHandler(async (req, res) => {
  const property = await verifyPropertyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found', code: 'PROPERTY_NOT_FOUND' });
  }

  // ── Defensive normalisation ───────────────────────────────────────────────
  const roomBody = { ...req.body };
  if (roomBody.roomNumber) roomBody.roomNumber = roomBody.roomNumber.trim().toUpperCase();
  if (roomBody.notes !== undefined) roomBody.notes = roomBody.notes.trim() || undefined;

  // Enum guards
  if (!VALID_TYPES.has(roomBody.type))           delete roomBody.type;
  if (!VALID_RENT_TYPES.has(roomBody.rentType))  delete roomBody.rentType;
  if (!VALID_GENDERS.has(roomBody.gender))       delete roomBody.gender;
  if (!VALID_STATUSES.has(roomBody.status))      delete roomBody.status;
  if (!VALID_CATEGORIES.has(roomBody.category))  delete roomBody.category;
  if (!VALID_BN_TYPES.has(roomBody.bedNumberingType)) delete roomBody.bedNumberingType;

  // Capacity is fixed for non-dormitory types — never trust the frontend value
  if (roomBody.type !== 'dormitory') {
    roomBody.capacity = CAPACITY_MAP[roomBody.type] ?? 1;
  }

  // ── Duplicate check before entering transaction ────────────────────────────
  const existing = await Room.findOne({
    property:   req.params.propertyId,
    roomNumber: roomBody.roomNumber,
    isActive:   true,
  });
  if (existing) {
    return res.status(409).json({
      success: false,
      message: `Room number "${roomBody.roomNumber}" already exists in this property`,
      code:    'ROOM_DUPLICATE',
    });
  }

  // ── Atomic transaction ────────────────────────────────────────────────────
  let room;
  try {
    room = await runWithRetry(async (session) => {
      // Purge any soft-deleted room with the same number so the unique index
      // doesn't block the insert
      const purged = await Room.findOneAndDelete(
        { property: req.params.propertyId, roomNumber: roomBody.roomNumber, isActive: false },
        { session }
      );
      if (purged) await Bed.deleteMany({ room: purged._id }, { session });

      const [created] = await Room.create(
        [{ ...roomBody, property: req.params.propertyId }],
        { session }
      );

      const bnType    = created.bedNumberingType ?? 'alphabet';
      const bedStatus = ['maintenance', 'blocked'].includes(created.status) ? 'blocked' : 'vacant';

      const bedDocs = Array.from({ length: created.capacity }, (_, i) => ({
        room:      created._id,
        property:  req.params.propertyId,
        bedNumber: generateBedLabel(bnType, i),
        status:    bedStatus,
      }));

      await Bed.insertMany(bedDocs, { session });
      return created;
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: `Room number "${roomBody.roomNumber}" already exists in this property`,
        code:    'ROOM_DUPLICATE',
      });
    }
    logger.error('room.create.failed', { propertyId: req.params.propertyId, error: err.message });
    throw err;
  }

  logger.info('room.created', {
    roomId: room._id, propertyId: req.params.propertyId,
    roomNumber: room.roomNumber, bedNumberingType: room.bedNumberingType,
    bedsCreated: room.capacity, userId: req.user._id,
  });

  res.status(201).json({ success: true, data: room, meta: { bedsCreated: room.capacity } });
});

// PUT /api/properties/:propertyId/rooms/:id
const updateRoom = asyncHandler(async (req, res) => {
  const property = await verifyPropertyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found', code: 'PROPERTY_NOT_FOUND' });
  }

  const updateBody = { ...req.body };

  // bedNumberingType is immutable after creation — always strip
  delete updateBody.bedNumberingType;

  // Defensive normalisation
  if (updateBody.roomNumber) updateBody.roomNumber = updateBody.roomNumber.trim().toUpperCase();
  if (updateBody.notes !== undefined) updateBody.notes = updateBody.notes.trim() || undefined;

  // Enum guards
  if (updateBody.type      !== undefined && !VALID_TYPES.has(updateBody.type))           delete updateBody.type;
  if (updateBody.rentType  !== undefined && !VALID_RENT_TYPES.has(updateBody.rentType))  delete updateBody.rentType;
  if (updateBody.gender    !== undefined && !VALID_GENDERS.has(updateBody.gender))       delete updateBody.gender;
  if (updateBody.status    !== undefined && !VALID_STATUSES.has(updateBody.status))      delete updateBody.status;
  if (updateBody.category  !== undefined && !VALID_CATEGORIES.has(updateBody.category))  delete updateBody.category;

  const current = await Room.findOne({ _id: req.params.id, property: req.params.propertyId });
  if (!current) {
    return res.status(404).json({ success: false, message: 'Room not found', code: 'ROOM_NOT_FOUND' });
  }

  // Capacity guard — dormitory only
  const effectiveType = updateBody.type ?? current.type;
  if (effectiveType !== 'dormitory') {
    // Non-dormitory: capacity is always server-controlled
    // If type is changing to a fixed type, force-set the correct capacity
    if (updateBody.type && updateBody.type !== current.type && CAPACITY_MAP[updateBody.type]) {
      updateBody.capacity = CAPACITY_MAP[updateBody.type];
    } else {
      delete updateBody.capacity;
    }
  } else if (updateBody.capacity !== undefined) {
    const newCap = Number(updateBody.capacity);
    if (isNaN(newCap) || newCap < 1 || newCap > 50) {
      delete updateBody.capacity;
    } else {
      const occupiedCount = await Bed.countDocuments({ room: req.params.id, isActive: true, status: 'occupied' });
      if (newCap < occupiedCount) {
        return res.status(400).json({
          success: false,
          message: `Capacity cannot be less than ${occupiedCount} occupied bed${occupiedCount > 1 ? 's' : ''}`,
          code:    'CAPACITY_BELOW_OCCUPIED',
          meta:    { occupiedBeds: occupiedCount, requestedCapacity: newCap },
        });
      }
      updateBody.capacity = newCap;
    }
  }

  // Duplicate check when roomNumber is changing
  if (updateBody.roomNumber && updateBody.roomNumber !== current.roomNumber) {
    const collision = await Room.findOne({
      property:   req.params.propertyId,
      roomNumber: updateBody.roomNumber,
      isActive:   true,
      _id:        { $ne: req.params.id },
    });
    if (collision) {
      return res.status(409).json({
        success: false,
        message: `Room number "${updateBody.roomNumber}" already exists in this property`,
        code:    'ROOM_DUPLICATE',
      });
    }
  }

  // Type change: block if extra beds exist OR any normal bed is occupied.
  // Check both conditions in parallel so a single error enumerates all blockers.
  if (updateBody.type && updateBody.type !== current.type) {
    const [extraBedCount, occupiedCount] = await Promise.all([
      Bed.countDocuments({ room: req.params.id, isActive: true, isExtra: true }),
      Bed.countDocuments({ room: req.params.id, isActive: true, status: 'occupied' }),
    ]);
    const reasons = [];
    if (occupiedCount > 0) reasons.push('occupied_beds');
    if (extraBedCount  > 0) reasons.push('extra_beds');
    if (reasons.length > 0) {
      const detail = reasons.map(r =>
        r === 'occupied_beds'
          ? `${occupiedCount} bed${occupiedCount > 1 ? 's are' : ' is'} occupied`
          : `${extraBedCount} extra bed${extraBedCount > 1 ? 's exist' : ' exists'}`
      ).join('; ');
      return res.status(409).json({
        success: false,
        message: `Cannot change room type — ${detail}. Resolve all blockers before changing type.`,
        code:    'ROOM_TYPE_CHANGE_BLOCKED',
        reasons,
        meta:    { occupiedBeds: occupiedCount, extraBeds: extraBedCount },
      });
    }
  }

  // No-op check
  const isValueEqual = (a, b) => {
    if (a === b) return true;
    return String(a ?? '') === String(b ?? '');
  };
  const changedFields = Object.keys(updateBody).filter((k) => !isValueEqual(updateBody[k], current[k]));
  if (changedFields.length === 0) {
    return res.status(200).json({ success: true, data: current, message: 'No changes made' });
  }

  // rentType change guard
  if (changedFields.includes('rentType')) {
    const occupiedCount = await Bed.countDocuments({ room: req.params.id, isActive: true, status: 'occupied' });
    if (occupiedCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot change rent type while ${occupiedCount} tenant${occupiedCount > 1 ? 's are' : ' is'} assigned. Vacate all tenants first.`,
        code:    'RENT_TYPE_LOCKED',
        meta:    { occupiedBeds: occupiedCount },
      });
    }
  }

  // Deactivation guard
  if (changedFields.includes('isActive') && updateBody.isActive === false) {
    const [occupiedCount, extraActiveCount] = await Promise.all([
      Bed.countDocuments({ room: req.params.id, isActive: true, status: 'occupied' }),
      Bed.countDocuments({ room: req.params.id, isActive: true, isExtra: true, status: { $in: ['occupied', 'reserved'] } }),
    ]);
    if (occupiedCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot deactivate room with active tenants. Please vacate all tenants first.',
        code:    'ROOM_HAS_TENANTS',
        meta:    { occupiedBeds: occupiedCount },
      });
    }
    if (extraActiveCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Remove or vacate extra beds before proceeding.',
        code:    'ROOM_HAS_EXTRA_BEDS',
        meta:    { extraBeds: extraActiveCount },
      });
    }
  }

  const room = await Room.findOneAndUpdate(
    { _id: req.params.id, property: req.params.propertyId },
    updateBody,
    { new: true, runValidators: true }
  );

  // Room ↔ Bed status sync
  if (changedFields.includes('status')) {
    if (room.status === 'maintenance' || room.status === 'blocked') {
      await Bed.updateMany(
        { room: room._id, isActive: true, status: { $ne: 'occupied' } },
        { $set: { status: 'blocked', reservedTill: null } }
      );
    } else if (room.status === 'available') {
      await Bed.updateMany(
        { room: room._id, isActive: true, status: 'blocked', tenant: null },
        { $set: { status: 'vacant' } }
      );
    }
  }

  // Type change → delete all non-extra beds and regenerate with new capacity
  if (changedFields.includes('type')) {
    await Bed.deleteMany({ room: room._id, isExtra: { $ne: true } });
    const bnType    = room.bedNumberingType ?? 'alphabet';
    const bedStatus = ['maintenance', 'blocked'].includes(room.status) ? 'blocked' : 'vacant';
    const newBeds   = Array.from({ length: room.capacity }, (_, i) => ({
      room:      room._id,
      property:  req.params.propertyId,
      bedNumber: generateBedLabel(bnType, i),
      status:    bedStatus,
    }));
    if (newBeds.length > 0) await Bed.insertMany(newBeds);
    logger.info('room.type_changed.beds_regenerated', {
      roomId:       room._id,
      newType:      room.type,
      newCapacity:  room.capacity,
      bedsCreated:  newBeds.length,
      userId:       req.user._id,
    });
  } else if (changedFields.includes('capacity') && room.type === 'dormitory') {
    // Capacity ↔ Bed sync (dormitory only, no type change)
    const currentBeds  = await Bed.find({ room: room._id, isActive: true, isExtra: { $ne: true } }).sort({ createdAt: 1 });
    const currentCount = currentBeds.length;
    const targetCount  = room.capacity;
    const bnType       = room.bedNumberingType ?? 'alphabet';

    if (targetCount > currentCount) {
      const bedStatus = ['maintenance', 'blocked'].includes(room.status) ? 'blocked' : 'vacant';
      const newBeds = Array.from({ length: targetCount - currentCount }, (_, i) => ({
        room:      room._id,
        property:  req.params.propertyId,
        bedNumber: generateBedLabel(bnType, currentCount + i),
        status:    bedStatus,
      }));
      await Bed.insertMany(newBeds);
    } else if (targetCount < currentCount) {
      const removable = currentBeds
        .filter(b => !b.tenant && b.status !== 'occupied')
        .reverse()
        .slice(0, currentCount - targetCount);
      if (removable.length === currentCount - targetCount) {
        await Bed.deleteMany({ _id: { $in: removable.map(b => b._id) } });
      }
    }
  }

  // ── baseRent / rentType change → recalculate all occupied tenants ───────────
  // Fire-and-forget: recalculation is best-effort and must not block the response.
  // For per_room rooms: each tenant's share is updated (floor(baseRent / normalOccupied)).
  // For per_bed rooms: each tenant pays the new baseRent directly (unless overridden).
  // rentType change only reaches here when occupiedCount === 0 (blocked above otherwise),
  // so this recalc is a safety net that is always a no-op in practice — but it keeps
  // the trigger surface complete per Rule 3.
  if (changedFields.includes('baseRent') || changedFields.includes('rentType')) {
    const traceId = crypto.randomUUID();
    const reason  = changedFields.includes('baseRent') ? 'base_rent_update' : 'rent_type_update';
    recalculateRoomRent(room, null, reason, traceId)
      .catch((err) => logger.error('room.rentConfig.recalc_failed', { roomId: room._id, traceId, reason, error: err.message }));
  }

  logger.info('room.updated', { roomId: room._id, changes: changedFields, userId: req.user._id });
  res.json({ success: true, data: room });
});

// DELETE /api/properties/:propertyId/rooms/:id
const deleteRoom = asyncHandler(async (req, res) => {
  const property = await verifyPropertyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const room = await Room.findOne({ _id: req.params.id, property: req.params.propertyId });
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  const [occupiedCount, extraActiveCount, pendingDuesCount] = await Promise.all([
    Bed.countDocuments({ room: room._id, status: 'occupied', isActive: true }),
    Bed.countDocuments({ room: room._id, isActive: true, isExtra: true, status: { $in: ['occupied', 'reserved'] } }),
    RentPayment.countDocuments({ room: room._id, status: { $in: ['pending', 'partial', 'overdue'] } }),
  ]);

  if (occupiedCount > 0) {
    return res.status(400).json({
      success: false,
      message: 'Cannot delete room with active tenants. Vacate all tenants first.',
      code:    'ROOM_HAS_TENANTS',
      meta:    { occupiedBeds: occupiedCount },
    });
  }
  if (extraActiveCount > 0) {
    return res.status(400).json({
      success: false,
      message: 'Remove or vacate extra beds before proceeding.',
      code:    'ROOM_HAS_EXTRA_BEDS',
      meta:    { extraBeds: extraActiveCount },
    });
  }
  if (pendingDuesCount > 0) {
    return res.status(400).json({
      success: false,
      message: 'Cannot delete room with pending payments. Clear all dues first.',
      code:    'ROOM_HAS_PENDING_DUES',
      meta:    { pendingRecords: pendingDuesCount },
    });
  }

  await Bed.deleteMany({ room: room._id });
  await Room.findByIdAndDelete(room._id);

  logger.info('room.deleted', { roomId: room._id, roomNumber: room.roomNumber, userId: req.user._id });
  res.json({ success: true, message: 'Room deleted permanently' });
});

module.exports = { getRooms, getRoom, createRoom, updateRoom, deleteRoom };
