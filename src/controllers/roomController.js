const Room        = require('../models/Room');
const Bed         = require('../models/Bed');
const Property    = require('../models/Property');
const asyncHandler = require('../utils/asyncHandler');
const { runWithRetry } = require('../utils/runWithRetry');

const CAPACITY_MAP = { single: 1, double: 2, triple: 3 };

// ── Enum guard sets (defensive fallback if Zod is bypassed) ──────────────────
const VALID_TYPES      = new Set(['single', 'double', 'triple', 'dormitory']);
const VALID_RENT_TYPES = new Set(['per_bed', 'per_room']);
const VALID_GENDERS    = new Set(['male', 'female', 'unisex']);
const VALID_STATUSES   = new Set(['available', 'maintenance', 'blocked']);
const VALID_CATEGORIES = new Set(['standard', 'premium', 'luxury']);

// ── Minimal structured logger ────────────────────────────────────────────────
const logger = {
  info:  (event, meta = {}) => console.log(JSON.stringify({ level: 'info',  ts: new Date().toISOString(), event, ...meta })),
  warn:  (event, meta = {}) => console.warn(JSON.stringify({ level: 'warn', ts: new Date().toISOString(), event, ...meta })),
  error: (event, meta = {}) => console.error(JSON.stringify({ level: 'error', ts: new Date().toISOString(), event, ...meta })),
};


// Excel-style bed labels: 0→A, 25→Z, 26→AA, 27→AB, 51→AZ, 52→BA …
const generateBedLabel = (index) => {
  let label = '';
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
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

  // ── Defensive normalization (Zod already cleaned, this is a second layer) ──
  const roomBody = { ...req.body };
  if (roomBody.roomNumber) roomBody.roomNumber = roomBody.roomNumber.trim().toUpperCase();
  if (roomBody.notes !== undefined) roomBody.notes = roomBody.notes.trim() || undefined;

  // Enum fallback — strip invalid values Zod might have missed if middleware is bypassed
  if (!VALID_TYPES.has(roomBody.type))           delete roomBody.type;
  if (!VALID_RENT_TYPES.has(roomBody.rentType))  delete roomBody.rentType;
  if (!VALID_GENDERS.has(roomBody.gender))       delete roomBody.gender;
  if (!VALID_STATUSES.has(roomBody.status))      delete roomBody.status;
  if (!VALID_CATEGORIES.has(roomBody.category))  delete roomBody.category;

  // Override capacity for non-dormitory — never trust the frontend value
  if (roomBody.type !== 'dormitory') {
    roomBody.capacity = CAPACITY_MAP[roomBody.type] ?? 1;
  }

  // ── Idempotency check — surface duplicate before entering transaction ────────
  const existing = await Room.findOne({
    property:   req.params.propertyId,
    roomNumber: roomBody.roomNumber,
    isActive:   true,
  });
  if (existing) {
    logger.warn('room.create.duplicate', {
      propertyId: req.params.propertyId,
      roomNumber: roomBody.roomNumber,
      userId:     req.user._id,
    });
    return res.status(409).json({
      success: false,
      message: 'Room number already exists in this property',
      code:    'ROOM_DUPLICATE',
    });
  }

  // ── Atomic transaction with retry on transient errors ────────────────────────
  let room;
  try {
    room = await runWithRetry(async (session) => {
      // Remove any soft-deleted room with the same number so the unique index
      // does not block the insert (isActive: false rooms are logically gone)
      const purged = await Room.findOneAndDelete(
        { property: req.params.propertyId, roomNumber: roomBody.roomNumber, isActive: false },
        { session }
      );
      if (purged) {
        await Bed.deleteMany({ room: purged._id }, { session });
      }

      const [created] = await Room.create(
        [{ ...roomBody, property: req.params.propertyId }],
        { session }
      );

      // Beds inherit blocked status when room is under maintenance or blocked
      const bedStatus = ['maintenance', 'blocked'].includes(created.status) ? 'blocked' : 'vacant';

      const bedDocs = Array.from({ length: created.capacity }, (_, i) => ({
        room:      created._id,
        property:  req.params.propertyId,
        bedNumber: generateBedLabel(i),
        status:    bedStatus,
      }));
      await Bed.insertMany(bedDocs, { session });

      return created;
    });
  } catch (err) {
    if (err.code === 11000) {
      logger.warn('room.create.duplicate', {
        propertyId: req.params.propertyId,
        roomNumber: roomBody.roomNumber,
        userId:     req.user._id,
      });
      return res.status(409).json({
        success: false,
        message: 'Room number already exists in this property',
        code:    'ROOM_DUPLICATE',
      });
    }
    logger.error('room.create.failed', {
      propertyId: req.params.propertyId,
      roomNumber: roomBody.roomNumber,
      userId:     req.user._id,
      error:      err.message,
    });
    throw err;
  }

  logger.info('room.created', {
    roomId:     room._id,
    propertyId: req.params.propertyId,
    roomNumber: room.roomNumber,
    bedsCreated: room.capacity,
    userId:     req.user._id,
  });

  res.status(201).json({
    success: true,
    data:    room,
    meta:    { bedsCreated: room.capacity },
  });
});

// PUT /api/properties/:propertyId/rooms/:id
const updateRoom = asyncHandler(async (req, res) => {
  const property = await verifyPropertyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found', code: 'PROPERTY_NOT_FOUND' });
  }

  // ── Build update body ────────────────────────────────────────────────────────
  const updateBody = { ...req.body };

  // ── Defensive normalization ──────────────────────────────────────────────────
  if (updateBody.roomNumber) updateBody.roomNumber = updateBody.roomNumber.trim().toUpperCase();
  if (updateBody.notes !== undefined) updateBody.notes = updateBody.notes.trim() || undefined;

  // ── Enum guard — strip any value not in the allowed set ─────────────────────
  if (updateBody.type      !== undefined && !VALID_TYPES.has(updateBody.type))           delete updateBody.type;
  if (updateBody.rentType  !== undefined && !VALID_RENT_TYPES.has(updateBody.rentType))  delete updateBody.rentType;
  if (updateBody.gender    !== undefined && !VALID_GENDERS.has(updateBody.gender))       delete updateBody.gender;
  if (updateBody.status    !== undefined && !VALID_STATUSES.has(updateBody.status))      delete updateBody.status;
  if (updateBody.category  !== undefined && !VALID_CATEGORIES.has(updateBody.category))  delete updateBody.category;

  // ── Fetch current room ───────────────────────────────────────────────────────
  const current = await Room.findOne({ _id: req.params.id, property: req.params.propertyId });
  if (!current) {
    return res.status(404).json({ success: false, message: 'Room not found', code: 'ROOM_NOT_FOUND' });
  }

  // ── Capacity guard — only dormitory rooms allow capacity changes ────────────
  const effectiveType = updateBody.type ?? current.type;
  if (effectiveType === 'dormitory' && updateBody.capacity !== undefined) {
    const newCap = Number(updateBody.capacity);
    if (isNaN(newCap) || newCap < 1 || newCap > 50) {
      delete updateBody.capacity;
    } else {
      const occupiedCount = await Bed.countDocuments({
        room: req.params.id,
        isActive: true,
        status: 'occupied',
      });
      if (newCap < occupiedCount) {
        logger.warn('room.update.capacity_below_occupied', {
          roomId: req.params.id, newCap, occupiedBeds: occupiedCount, userId: req.user._id,
        });
        return res.status(400).json({
          success: false,
          message: `Capacity cannot be less than ${occupiedCount} occupied bed${occupiedCount > 1 ? 's' : ''}`,
          code:    'CAPACITY_BELOW_OCCUPIED',
          meta:    { occupiedBeds: occupiedCount, requestedCapacity: newCap },
        });
      }
      updateBody.capacity = newCap;
    }
  } else {
    // Non-dormitory: capacity is always controlled by type, never from frontend
    delete updateBody.capacity;
  }

  // ── Duplicate pre-check when roomNumber is changing ──────────────────────────
  if (updateBody.roomNumber && updateBody.roomNumber !== current.roomNumber) {
    const collision = await Room.findOne({
      property:   req.params.propertyId,
      roomNumber: updateBody.roomNumber,
      isActive:   true,
      _id:        { $ne: req.params.id },
    });
    if (collision) {
      logger.warn('room.update.duplicate', {
        propertyId: req.params.propertyId,
        roomNumber: updateBody.roomNumber,
        userId:     req.user._id,
      });
      return res.status(409).json({
        success: false,
        message: 'Room number already exists in this property',
        code:    'ROOM_DUPLICATE',
      });
    }
  }

  // ── No-op check — skip write if nothing actually changed ─────────────────────
  const isValueEqual = (a, b) => {
    if (a === b) return true;
    const aN = (a === undefined || a === null) ? '' : String(a);
    const bN = (b === undefined || b === null) ? '' : String(b);
    return aN === bN;
  };
  const changedFields = Object.keys(updateBody).filter((k) => !isValueEqual(updateBody[k], current[k]));

  if (changedFields.length === 0) {
    return res.status(200).json({ success: true, data: current, message: 'No changes made' });
  }

  // ── rentType change guard — block when occupied beds exist ──────────────────
  if (changedFields.includes('rentType')) {
    const occupiedCount = await Bed.countDocuments({
      room: req.params.id,
      isActive: true,
      status: 'occupied',
    });
    if (occupiedCount > 0) {
      logger.warn('room.update.rentType_blocked', {
        roomId:      req.params.id,
        from:        current.rentType,
        to:          updateBody.rentType,
        occupiedBeds: occupiedCount,
        userId:      req.user._id,
      });
      return res.status(400).json({
        success: false,
        message: `Cannot change rent type while ${occupiedCount} tenant${occupiedCount > 1 ? 's are' : ' is'} assigned. Vacate all tenants first.`,
        code:    'RENT_TYPE_LOCKED',
        meta:    { occupiedBeds: occupiedCount },
      });
    }
  }

  // ── Deactivation guard — block when occupied beds exist ─────────────────────
  if (changedFields.includes('isActive') && updateBody.isActive === false) {
    const occupiedCount = await Bed.countDocuments({
      room: req.params.id,
      isActive: true,
      status: 'occupied',
    });
    if (occupiedCount > 0) {
      logger.warn('room.update.deactivate_blocked', {
        roomId:       req.params.id,
        occupiedBeds: occupiedCount,
        userId:       req.user._id,
      });
      return res.status(400).json({
        success: false,
        message: `Cannot deactivate room while ${occupiedCount} tenant${occupiedCount > 1 ? 's are' : ' is'} assigned. Vacate all tenants first.`,
        code:    'ROOM_HAS_TENANTS',
        meta:    { occupiedBeds: occupiedCount },
      });
    }
  }

  // ── Apply update ─────────────────────────────────────────────────────────────
  const room = await Room.findOneAndUpdate(
    { _id: req.params.id, property: req.params.propertyId },
    updateBody,
    { new: true, runValidators: true }
  );

  // ── Room ↔ Bed status sync ────────────────────────────────────────────────
  if (changedFields.includes('status')) {
    let syncResult;
    if (room.status === 'maintenance' || room.status === 'blocked') {
      // Block all non-occupied beds
      syncResult = await Bed.updateMany(
        { room: room._id, isActive: true, status: { $ne: 'occupied' } },
        { $set: { status: 'blocked', reservedTill: null } }
      );
    } else if (room.status === 'available') {
      // Unblock all blocked beds that have no tenant
      syncResult = await Bed.updateMany(
        { room: room._id, isActive: true, status: 'blocked', tenant: null },
        { $set: { status: 'vacant' } }
      );
    }
    if (syncResult?.modifiedCount > 0) {
      logger.info('room.bed_status_synced', {
        roomId:        room._id,
        newRoomStatus: room.status,
        bedsAffected:  syncResult.modifiedCount,
        userId:        req.user._id,
      });
    }
  }

  // ── Capacity ↔ Bed sync (dormitory only) ──────────────────────────────────
  if (changedFields.includes('capacity') && room.type === 'dormitory') {
    const currentBeds = await Bed.find({ room: room._id, isActive: true }).sort({ bedNumber: 1 });
    const currentCount = currentBeds.length;
    const targetCount  = room.capacity;

    if (targetCount > currentCount) {
      // ── Scale UP: create new beds ─────────────────────────────────────────
      // Find highest existing label index to continue the sequence
      const existingLabels = currentBeds.map(b => b.bedNumber);
      let startIndex = currentCount; // default: continue from end
      // Scan for the highest index already used
      for (let i = 0; i < 200; i++) {
        if (existingLabels.includes(generateBedLabel(i))) {
          startIndex = Math.max(startIndex, i + 1);
        }
      }

      const bedStatus = ['maintenance', 'blocked'].includes(room.status) ? 'blocked' : 'vacant';
      const newBeds = [];
      for (let i = 0; i < targetCount - currentCount; i++) {
        newBeds.push({
          room:      room._id,
          property:  req.params.propertyId,
          bedNumber: generateBedLabel(startIndex + i),
          status:    bedStatus,
        });
      }
      await Bed.insertMany(newBeds);

      logger.info('room.capacity_sync.beds_created', {
        roomId:      room._id,
        bedsCreated: newBeds.length,
        newLabels:   newBeds.map(b => b.bedNumber),
        totalAfter:  targetCount,
        userId:      req.user._id,
      });

    } else if (targetCount < currentCount) {
      // ── Scale DOWN: remove vacant beds only ───────────────────────────────
      const bedsToRemove = currentCount - targetCount;

      // Pick vacant beds first (from the end), then reserved, never occupied
      const removable = currentBeds
        .filter(b => b.status === 'vacant' || b.status === 'reserved' || b.status === 'blocked')
        .filter(b => !b.tenant)
        .reverse()  // remove from end first
        .slice(0, bedsToRemove);

      if (removable.length < bedsToRemove) {
        // Safety: this shouldn't happen because the capacity guard already checked
        logger.error('room.capacity_sync.insufficient_removable', {
          roomId: room._id, needed: bedsToRemove, available: removable.length,
        });
      } else {
        const idsToRemove = removable.map(b => b._id);
        await Bed.deleteMany({ _id: { $in: idsToRemove } });

        logger.info('room.capacity_sync.beds_removed', {
          roomId:       room._id,
          bedsRemoved:  idsToRemove.length,
          removedLabels: removable.map(b => b.bedNumber),
          totalAfter:   targetCount,
          userId:       req.user._id,
        });
      }
    }
  }

  logger.info('room.updated', {
    roomId:     room._id,
    propertyId: req.params.propertyId,
    changes:    changedFields,
    userId:     req.user._id,
  });

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

  // Prevent deletion if any bed is occupied
  const occupiedCount = await Bed.countDocuments({ room: room._id, status: 'occupied', isActive: true });
  if (occupiedCount > 0) {
    return res.status(400).json({
      success: false,
      message: 'Cannot delete a room with occupied beds. Vacate all tenants first.',
      code: 'ROOM_HAS_TENANTS',
    });
  }

  // Hard delete beds + room
  await Bed.deleteMany({ room: room._id });
  await Room.findByIdAndDelete(room._id);

  logger.info('room.deleted', {
    roomId:     room._id,
    roomNumber: room.roomNumber,
    propertyId: req.params.propertyId,
    userId:     req.user._id,
  });

  res.json({ success: true, message: 'Room deleted permanently' });
});

module.exports = { getRooms, getRoom, createRoom, updateRoom, deleteRoom };
