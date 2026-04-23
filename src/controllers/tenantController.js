const crypto       = require('crypto');
const Tenant       = require('../models/Tenant');
const Bed          = require('../models/Bed');
const Room         = require('../models/Room');
const Property     = require('../models/Property');
const Invoice      = require('../models/Invoice');
const LedgerEntry  = require('../models/LedgerEntry');
const RentPayment  = require('../models/RentPayment');
const rentService  = require('../services/rentService');
const asyncHandler = require('../utils/asyncHandler');
const { vacateBedCore, vacateTenantCore } = require('../services/vacateService');
const { recalculateRoomRent } = require('../utils/recalculateRoomRent');

// ── Shared phone-uniqueness check ────────────────────────────────────────────
// Returns the conflicting tenant document if an active/notice tenant with the
// same phone already exists in this property, otherwise returns null.
const findPhoneConflict = (propertyId, phone, excludeId = null) => {
  const filter = {
    property: propertyId,
    phone:    phone.trim(),
    status:   { $in: ['active', 'notice', 'reserved'] },
  };
  if (excludeId) filter._id = { $ne: excludeId };
  return Tenant.findOne(filter).select('_id name phone status').lean();
};

// GET /api/properties/:propertyId/tenants/search
// Multi-purpose search endpoint used by:
//   - TenantSearch component (q= for name/phone, limit=10, assignable=, excludeReserved=)
//   - Phone duplicate detection (phone= exact match)
//   - Recent tenants list (no query, sorted by updatedAt)
const searchTenants = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.propertyId, owner: req.user._id });
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const { q, phone, name, assignable, excludeReserved, limit: limitStr, status } = req.query;
  const limit = Math.min(parseInt(limitStr) || 10, 50);

  const filter = { property: req.params.propertyId };

  // Combined name+phone search (used by TenantSearch component)
  if (q && q.trim()) {
    const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name:  { $regex: escaped, $options: 'i' } },
      { phone: { $regex: escaped } },
    ];
  } else {
    // Legacy single-field params (used by phone duplicate detection)
    if (phone) filter.phone = { $regex: phone.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') };
    if (name)  filter.name  = { $regex: name.trim(), $options: 'i' };
  }

  // Status filter (comma-separated or single)
  if (status) {
    const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
    if (statuses.length === 1) filter.status = statuses[0];
    else if (statuses.length > 1) filter.status = { $in: statuses };
  }

  // Assignable: only tenants with no bed assigned (OR the reserved tenant linked to the bed being confirmed)
  // reservedBedId allows the reserved tenant of a bed to appear in the confirm flow.
  const { reservedBedId } = req.query;
  if (assignable === 'true') {
    filter.bed = reservedBedId
      ? { $in: [null, reservedBedId] }
      : null;
  }

  // ExcludeReserved: exclude tenants who already hold an active reservation elsewhere
  if (excludeReserved === 'true') {
    const reservedIds = await Bed.distinct('reservation.tenantId', {
      status: 'reserved',
      'reservation.tenantId': { $ne: null },
    });
    if (reservedIds.length > 0) {
      filter._id = { $nin: reservedIds };
    }
  }

  // Exclude merged tenants always
  if (filter.status) {
    // don't override an explicit status filter, but exclude merged
    if (typeof filter.status === 'string' && filter.status !== 'merged') {
      // already filtered
    } else if (filter.status.$in) {
      filter.status.$in = filter.status.$in.filter(s => s !== 'merged');
    }
  } else {
    filter.status = { $ne: 'merged' };
  }

  const tenants = await Tenant.find(filter)
    .select('_id name phone status checkInDate checkOutDate bed rentAmount billingSnapshot')
    .populate({ path: 'bed', select: 'bedNumber room', populate: { path: 'room', select: 'roomNumber floor' } })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  res.json({ success: true, count: tenants.length, data: tenants });
});

// GET /api/properties/:propertyId/tenants
// Query params:
//   status     — filter by exact status value
//   unassigned — if "true", restrict to tenants with no bed (bed: null)
const getTenants = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.propertyId, owner: req.user._id });
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const { status, unassigned, assignable, excludeReserved } = req.query;
  const filter = { property: req.params.propertyId };
  if (status) filter.status = status;

  // assignable=true (or legacy unassigned=true): only tenants with no bed
  if (assignable === 'true' || unassigned === 'true') filter.bed = null;

  // excludeReserved=true: additionally remove tenants who already hold an
  // active reservation on another bed (used by the Reserve Bed modal)
  if (excludeReserved === 'true') {
    const reservedIds = await Bed.distinct('reservation.tenantId', {
      status: 'reserved',
      'reservation.tenantId': { $ne: null },
    });
    if (reservedIds.length > 0) {
      filter._id = { $nin: reservedIds };
    }
  }

  const tenants = await Tenant.find(filter)
    .populate({ path: 'bed', select: 'bedNumber room', populate: { path: 'room', select: 'roomNumber floor' } })
    .sort({ updatedAt: -1 });
  res.json({ success: true, count: tenants.length, data: tenants });
});

// GET /api/properties/:propertyId/tenants/:id
const getTenant = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.propertyId, owner: req.user._id });
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const tenant = await Tenant.findOne({ _id: req.params.id, property: req.params.propertyId }).populate({ path: 'bed', select: 'bedNumber room', populate: { path: 'room', select: 'roomNumber floor' } });
  if (!tenant) {
    return res.status(404).json({ success: false, message: 'Tenant not found' });
  }
  res.json({ success: true, data: tenant });
});

// POST /api/properties/:propertyId/tenants
const createTenant = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.propertyId, owner: req.user._id });
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  // Fix 2: bedId is no longer accepted here. All bed assignments must go through
  // PATCH /rooms/:roomId/beds/:id/assign so that recalculateRoomRent runs and
  // the first billing cycle is generated correctly.
  const tenantData = { ...req.body };
  delete tenantData.bedId;    // silently strip — bed assignment goes through PATCH .../assign
  delete tenantData.status;   // always 'incomplete' at creation; assignBed promotes to 'active'

  // ── Duplicate phone guard ────────────────────────────────────────────────
  if (tenantData.phone) {
    const conflict = await findPhoneConflict(req.params.propertyId, tenantData.phone);
    if (conflict) {
      return res.status(409).json({
        success:  false,
        message:  `An active tenant with phone ${tenantData.phone} already exists in this property`,
        code:     'TENANT_ALREADY_EXISTS',
        tenantId: conflict._id,
        name:     conflict.name,
        phone:    conflict.phone,
        status:   conflict.status,
      });
    }
  }

  // Normalise deposit status at creation based on depositPaid flag.
  if (Number(tenantData.depositAmount) > 0) {
    if (tenantData.depositPaid === true) {
      // Collected at creation — mark as held and stamp the collection timestamp
      tenantData.depositBalance = Number(tenantData.depositAmount);
      tenantData.depositStatus  = 'held';
      if (!tenantData.depositPaidAt) tenantData.depositPaidAt = new Date();
    } else {
      // Amount entered but not yet collected — mark as pending
      tenantData.depositStatus = 'pending';
    }
  }

  const tenant = await Tenant.create({ ...tenantData, property: req.params.propertyId });

  // Write audit ledger entry when deposit is collected at creation
  if (tenantData.depositPaid === true && Number(tenantData.depositAmount) > 0) {
    LedgerEntry.create({
      tenant:        tenant._id,
      property:      req.params.propertyId,
      type:          'credit',
      amount:        Number(tenantData.depositAmount),
      balanceAfter:  0,   // no rent has been generated yet; informational only
      referenceType: 'deposit_collected',
      referenceId:   tenant._id,
      description:   `Security deposit ₹${tenantData.depositAmount} collected at tenant creation`,
    }).catch((err) => console.warn('[createTenant] deposit ledger failed:', err.message));
  }

  res.status(201).json({ success: true, data: tenant });
});

// PUT /api/properties/:propertyId/tenants/:id
const updateTenant = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.propertyId, owner: req.user._id });
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  // billingSnapshot is computed — never accept it from the client.
  const updateBody = { ...req.body };
  delete updateBody.billingSnapshot;

  // ── rentAmount update: route through the bed layer so recalculation persists ─
  // When a profile edit includes a new rentAmount, we update the bed's rent setting
  // (rentOverride for normal beds, extraCharge for extra beds) then recalculate.
  // This ensures the change survives future recalculations triggered by room events.
  const newRentAmount = updateBody.rentAmount !== undefined ? Number(updateBody.rentAmount) : undefined;
  delete updateBody.rentAmount; // handled separately below after the main save

  // ── Phone-uniqueness guard on update ────────────────────────────────────────
  if (updateBody.phone) {
    const conflict = await findPhoneConflict(req.params.propertyId, updateBody.phone, req.params.id);
    if (conflict) {
      return res.status(409).json({
        success:  false,
        message:  `An active tenant with phone ${updateBody.phone} already exists in this property`,
        code:     'TENANT_ALREADY_EXISTS',
        tenantId: conflict._id,
        name:     conflict.name,
        phone:    conflict.phone,
        status:   conflict.status,
      });
    }
  }

  // Check if deposit is being marked as collected for the first time
  const markingDepositPaid = updateBody.depositPaid === true;
  let prevTenant = null;
  if (markingDepositPaid) {
    prevTenant = await Tenant.findOne({ _id: req.params.id, property: req.params.propertyId })
      .select('depositPaid depositAmount').lean();

    // Guard: reject if deposit is already collected — prevents accidental double-collection
    if (prevTenant?.depositPaid === true) {
      return res.status(400).json({
        success: false,
        message: 'Deposit has already been collected for this tenant',
        code:    'DEPOSIT_ALREADY_COLLECTED',
      });
    }

    // Stamp the collection timestamp; use client-provided date (backdating) or now.
    if (!updateBody.depositPaidAt) updateBody.depositPaidAt = new Date();
    else updateBody.depositPaidAt = new Date(updateBody.depositPaidAt);
  }

  const tenant = await Tenant.findOneAndUpdate(
    { _id: req.params.id, property: req.params.propertyId },
    updateBody,
    { new: true, runValidators: true }
  );
  if (!tenant) {
    return res.status(404).json({ success: false, message: 'Tenant not found' });
  }

  // Write deposit_collected audit entry when deposit is first marked as paid
  if (markingDepositPaid && prevTenant && !prevTenant.depositPaid) {
    const collectedAmt = updateBody.depositBalance ?? updateBody.depositAmount ?? prevTenant.depositAmount ?? 0;
    if (collectedAmt > 0) {
      await LedgerEntry.create({
        tenant:        tenant._id,
        property:      req.params.propertyId,
        type:          'credit',
        amount:        collectedAmt,
        balanceAfter:  await rentService.getLastBalance(tenant._id),  // informational — rent balance unchanged
        referenceType: 'deposit_collected',
        referenceId:   tenant._id,
        description:   `Security deposit ₹${collectedAmt} collected (manually marked)`,
      });
    }
  }

  // ── Route rentAmount through bed layer so it survives future recalculations ─
  if (newRentAmount !== undefined && tenant.bed) {
    try {
      const bed = await Bed.findById(tenant.bed);
      if (bed) {
        const room = await Room.findById(bed.room);
        if (room) {
          if (bed.isExtra) {
            bed.isChargeable = newRentAmount > 0;
            bed.extraCharge  = newRentAmount > 0 ? newRentAmount : 0;
          } else {
            bed.rentOverride = newRentAmount > 0 ? newRentAmount : null;
          }
          await bed.save();

          const rcTraceId = crypto.randomUUID();
          await recalculateRoomRent(room, null, 'profile_rent_update', rcTraceId);

          // Sync the current billing cycle's RentPayment to reflect the new amount
          const freshTenant = await Tenant.findById(tenant._id)
            .select('_id rentAmount property').lean();
          if (freshTenant) {
            const now    = new Date();
            const month  = now.getMonth() + 1;
            const year   = now.getFullYear();
            const pendingPayment = await RentPayment.findOne({
              tenant: freshTenant._id,
              month,
              year,
              status: { $in: ['pending', 'overdue'] },
            });

            if (!pendingPayment && freshTenant.rentAmount > 0) {
              await rentService.ensureCurrentCycleRentForTenant(freshTenant._id, freshTenant.property);
            } else if (pendingPayment) {
              const diff = freshTenant.rentAmount - pendingPayment.amount;
              if (diff !== 0) {
                await RentPayment.updateOne(
                  { _id: pendingPayment._id },
                  { $set: {
                      amount:  freshTenant.rentAmount,
                      balance: Math.max(0, freshTenant.rentAmount - (pendingPayment.paidAmount ?? 0)),
                  }}
                );
                try {
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
                    description:   `Rent updated from profile: ₹${pendingPayment.amount} → ₹${freshTenant.rentAmount}`,
                  });
                  await Tenant.findByIdAndUpdate(freshTenant._id, { ledgerBalance: newBalance });
                } catch (_) { /* non-fatal — payment already updated */ }
              }
            }
          }
        }
      }
    } catch (rentErr) {
      // Non-fatal: profile update succeeded; rent routing failed
      console.warn('[updateTenant] rent routing failed:', rentErr.message);
    }
  }

  res.json({ success: true, data: tenant });
});

// DELETE /api/properties/:propertyId/tenants/:id  — marks as vacated and frees the bed
//
// SINGLE VACATE FLOW: delegates entirely to vacateService.vacateBedCore — the same
// function used by bedController.vacateBed. This guarantees identical behaviour:
// deposit handling, payment collection, ledger entries, rent recalculation.
//
// Body accepts the same params as PATCH /rooms/:roomId/beds/:id/vacate:
//   checkOutDate, notes, vacateOption, paymentAmount, paymentMethod,
//   depositAction, refundAmount, refundMethod
const vacateTenant = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.propertyId, owner: req.user._id });
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const tenant = await Tenant.findOne({ _id: req.params.id, property: req.params.propertyId });
  if (!tenant) {
    return res.status(404).json({ success: false, message: 'Tenant not found' });
  }
  if (tenant.status === 'vacated') {
    return res.status(400).json({ success: false, message: 'Tenant is already vacated' });
  }

  // ── Case 1: tenant has no bed — tenant-only financial settlement ──────────
  if (!tenant.bed) {
    try {
      const result = await vacateTenantCore({
        propertyId: req.params.propertyId,
        tenant,
        opts:   req.body,
        userId: req.user._id,
      });
      return res.json({ success: true, message: 'Tenant vacated', data: result.tenant });
    } catch (err) {
      const status = err.status ?? 500;
      const code   = err.code   ?? 'VACATE_ERROR';
      return res.status(status).json({ success: false, message: err.message, code });
    }
  }

  // ── Route through the canonical vacate flow ────────────────────────────────
  const bed = await Bed.findOne({ _id: tenant.bed, isActive: true });

  // ── Case 2: stale bed reference — bed document missing ────────────────────
  // vacateTenantCore clears tenant.bed = null inside the transaction.
  if (!bed) {
    try {
      const result = await vacateTenantCore({
        propertyId: req.params.propertyId,
        tenant,
        opts:   req.body,
        userId: req.user._id,
      });
      return res.json({ success: true, message: 'Tenant vacated (stale bed reference cleared)', data: result.tenant });
    } catch (err) {
      const status = err.status ?? 500;
      const code   = err.code   ?? 'VACATE_ERROR';
      return res.status(status).json({ success: false, message: err.message, code });
    }
  }

  // ── Case 3: bed exists but not occupied (e.g. reserved) ───────────────────
  if (bed.status !== 'occupied') {
    const room = await Room.findById(bed.room);
    if (room) {
      // vacateBedCore frees the bed and recalculates room rent for remaining tenants
      try {
        const result = await vacateBedCore({
          propertyId: req.params.propertyId,
          room,
          bed,
          tenant,
          opts:   req.body,
          userId: req.user._id,
        });
        return res.json({ success: true, message: 'Tenant vacated', data: result.tenant });
      } catch (err) {
        const status = err.status ?? 500;
        const code   = err.code   ?? 'VACATE_ERROR';
        return res.status(status).json({ success: false, message: err.message, code });
      }
    }
    // No room found — free the bed directly, then run tenant-only financial settlement
    await Bed.updateOne({ _id: bed._id }, { $set: { status: 'vacant', tenant: null } });
    try {
      const result = await vacateTenantCore({
        propertyId: req.params.propertyId,
        tenant,
        opts:   req.body,
        userId: req.user._id,
      });
      return res.json({ success: true, message: 'Tenant vacated', data: result.tenant });
    } catch (err) {
      const status = err.status ?? 500;
      const code   = err.code   ?? 'VACATE_ERROR';
      return res.status(status).json({ success: false, message: err.message, code });
    }
  }

  // ── Happy path: bed is occupied — full vacate through canonical flow ────────
  const room = await Room.findById(bed.room);
  if (!room) {
    return res.status(500).json({ success: false, message: 'Room record not found for this bed', code: 'ROOM_NOT_FOUND' });
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
    res.json({ success: true, message: 'Tenant vacated', data: result.tenant });
  } catch (err) {
    const status = err.status ?? 500;
    const code   = err.code   ?? 'VACATE_ERROR';
    res.status(status).json({ success: false, message: err.message, code });
  }
});

// ── Reservation advance endpoints ────────────────────────────────────────────

// GET /api/properties/:propertyId/tenants/:tenantId/advance
// Returns the held reservation advance for the tenant (if any).
const getTenantAdvance = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.propertyId, owner: req.user._id });
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });

  const tenant = await Tenant.findOne({ _id: req.params.tenantId, property: req.params.propertyId });
  if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });

  // Find the bed that holds this tenant's reservation advance
  const bed = await Bed.findOne({
    tenant: tenant._id,
    status: 'reserved',
    isActive: true,
    'reservation.reservationAmount': { $gt: 0 },
    'reservation.reservationStatus': 'held',
  }).select('_id bedNumber room reservation reservedTill').populate('room', 'roomNumber').lean();

  if (!bed) {
    return res.json({ success: true, data: null });
  }

  res.json({
    success: true,
    data: {
      bedId:             bed._id,
      bedNumber:         bed.bedNumber,
      roomNumber:        bed.room?.roomNumber ?? null,
      reservedTill:      bed.reservedTill,
      reservationAmount: bed.reservation.reservationAmount,
      reservationMode:   bed.reservation.reservationMode,
      reservationStatus: bed.reservation.reservationStatus,
    },
  });
});

// POST /api/properties/:propertyId/tenants/:tenantId/advance/apply
// Manually apply the held advance as a ledger credit (adjust mode).
const applyTenantAdvance = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.propertyId, owner: req.user._id });
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });

  const tenant = await Tenant.findOne({ _id: req.params.tenantId, property: req.params.propertyId });
  if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });

  const bed = await Bed.findOne({
    tenant: tenant._id,
    isActive: true,
    'reservation.reservationAmount': { $gt: 0 },
    'reservation.reservationStatus': 'held',
  });

  if (!bed) {
    return res.status(404).json({ success: false, message: 'No held advance found for this tenant', code: 'NO_ADVANCE' });
  }

  const advAmt  = bed.reservation.reservationAmount;
  const advMode = bed.reservation.reservationMode;

  const prevBalance = await rentService.getLastBalance(tenant._id);
  const newBalance  = prevBalance - advAmt;

  await LedgerEntry.create({
    tenant:        tenant._id,
    property:      property._id,
    type:          'credit',
    amount:        advAmt,
    balanceAfter:  newBalance,
    referenceType: 'reservation_paid',
    referenceId:   bed._id,
    description:   `Reservation advance manually applied to rent (${advMode} mode)`,
  });

  await Tenant.updateOne({ _id: tenant._id }, { $set: { ledgerBalance: newBalance } });
  bed.reservation.reservationStatus = 'converted';
  await bed.save();

  res.json({ success: true, message: 'Advance applied to rent', data: { amount: advAmt, newBalance } });
});

// POST /api/properties/:propertyId/tenants/:tenantId/advance/refund
// Manually mark the held advance as refunded (creates a refund ledger entry).
const refundTenantAdvance = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.propertyId, owner: req.user._id });
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });

  const tenant = await Tenant.findOne({ _id: req.params.tenantId, property: req.params.propertyId });
  if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });

  const bed = await Bed.findOne({
    tenant: tenant._id,
    isActive: true,
    'reservation.reservationAmount': { $gt: 0 },
    'reservation.reservationStatus': 'held',
  });

  if (!bed) {
    return res.status(404).json({ success: false, message: 'No held advance found for this tenant', code: 'NO_ADVANCE' });
  }

  const advAmt  = bed.reservation.reservationAmount;
  const advMode = bed.reservation.reservationMode;

  const prevBalance = await rentService.getLastBalance(tenant._id);
  // Debit: removes the advance credit. Original apply was a credit (balance went -ve);
  // refunding it must debit (balance returns toward 0).
  // e.g. prevBalance = -500 (advance) → newBalance = -500 + 500 = 0
  const newBalance  = prevBalance + advAmt;

  await LedgerEntry.create({
    tenant:        tenant._id,
    property:      property._id,
    type:          'debit',
    amount:        advAmt,
    balanceAfter:  newBalance,
    referenceType: 'reservation_refunded',
    referenceId:   bed._id,
    description:   `Reservation advance manually refunded to tenant (${advMode} mode)`,
  });

  await Tenant.updateOne({ _id: tenant._id }, { $set: { ledgerBalance: newBalance, reservationAmount: 0 } });
  bed.reservation.reservationStatus = 'cancelled';
  await bed.save();

  res.json({ success: true, message: 'Advance marked as refunded', data: { amount: advAmt, newBalance } });
});

// ── Deposit endpoints ────────────────────────────────────────────────────────

// POST /api/properties/:propertyId/tenants/:tenantId/deposit/adjust
// Apply the security deposit against outstanding rent dues.
const adjustDeposit = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.propertyId, owner: req.user._id });
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });

  const tenant = await Tenant.findOne({ _id: req.params.tenantId, property: req.params.propertyId });
  if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });

  const depositBal = tenant.depositBalance ?? 0;
  if (depositBal <= 0) {
    return res.status(400).json({ success: false, message: 'No deposit balance to adjust', code: 'NO_DEPOSIT' });
  }

  // Use ledger balance as source of truth — includes rent + charges, not just rent records.
  const pendingTotal = await rentService.getLastBalance(tenant._id);

  if (pendingTotal <= 0) {
    return res.status(400).json({ success: false, message: 'No outstanding dues to adjust against', code: 'NO_DUES' });
  }

  // Optional partial amount from request body; defaults to full adjustment
  const reqAmt = req.body?.amount ? Number(req.body.amount) : null;
  if (reqAmt !== null) {
    if (reqAmt <= 0)           return res.status(400).json({ success: false, message: 'Amount must be greater than zero' });
    if (reqAmt > depositBal)   return res.status(400).json({ success: false, message: 'Amount exceeds available deposit balance' });
    if (reqAmt > pendingTotal) return res.status(400).json({ success: false, message: 'Amount exceeds outstanding dues' });
  }
  const applyAmt = reqAmt ?? Math.min(depositBal, pendingTotal);

  await rentService.allocatePayment(req.params.propertyId, tenant._id, {
    amount:      applyAmt,
    method:      'deposit_adjustment',
    notes:       'Adjusted from security deposit',
    paymentDate: new Date().toISOString(),
  });

  const newBal = Math.max(0, depositBal - applyAmt);
  const newStatus = newBal > 0 ? 'held' : 'adjusted';
  await Tenant.updateOne(
    { _id: tenant._id },
    { $set: { depositBalance: newBal, depositStatus: newStatus } }
  );

  // Derive balance from LedgerEntry after allocatePayment has written its entry
  await LedgerEntry.create({
    tenant:        tenant._id,
    property:      req.params.propertyId,
    type:          'credit',
    amount:        applyAmt,
    balanceAfter:  await rentService.getLastBalance(tenant._id),
    referenceType: 'deposit_adjusted',
    referenceId:   tenant._id,
    description:   `Security deposit ₹${applyAmt} adjusted against outstanding dues`,
  });

  res.json({
    success: true,
    message: `₹${applyAmt} adjusted from deposit against dues`,
    data: { adjustedAmount: applyAmt, depositBalance: newBal, depositStatus: newStatus },
  });
});

// POST /api/properties/:propertyId/tenants/:tenantId/deposit/refund
// Mark the security deposit as refunded (returned to tenant in cash).
const refundDeposit = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.propertyId, owner: req.user._id });
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });

  const tenant = await Tenant.findOne({ _id: req.params.tenantId, property: req.params.propertyId });
  if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });

  const depositBal = tenant.depositBalance ?? 0;
  if (depositBal <= 0) {
    return res.status(400).json({ success: false, message: 'No deposit balance to refund', code: 'NO_DEPOSIT' });
  }

  await Tenant.updateOne(
    { _id: tenant._id },
    { $set: { depositBalance: 0, depositStatus: 'refunded', depositReturned: true } }
  );

  await LedgerEntry.create({
    tenant:        tenant._id,
    property:      req.params.propertyId,
    type:          'credit',
    amount:        depositBal,
    balanceAfter:  await rentService.getLastBalance(tenant._id),  // informational — rent balance unchanged
    referenceType: 'deposit_refunded',
    referenceId:   tenant._id,
    description:   `Security deposit ₹${depositBal} refunded to tenant`,
  });

  res.json({
    success: true,
    message: `Security deposit of ₹${depositBal} marked as refunded`,
    data: { refundedAmount: depositBal, depositBalance: 0, depositStatus: 'refunded' },
  });
});

// PATCH /api/properties/:propertyId/tenants/:id/fix-billing-start
//
// Admin-only correction endpoint for the immutable billingStartDate.
// The normal assignment path sets billingStartDate once and never changes it,
// but operators sometimes enter the wrong move-in date and have no escape hatch.
// This endpoint corrects the anchor and writes an audit LedgerEntry so the
// change is traceable.
//
// Body: { billingStartDate: ISO date string, reason?: string }
const fixBillingStart = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.propertyId, owner: req.user._id });
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });

  const tenant = await Tenant.findOne({ _id: req.params.id, property: req.params.propertyId });
  if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });

  const { billingStartDate, reason } = req.body;
  if (!billingStartDate) {
    return res.status(400).json({ success: false, message: 'billingStartDate is required', code: 'MISSING_DATE' });
  }

  const newDate = new Date(billingStartDate);
  if (isNaN(newDate.getTime())) {
    return res.status(400).json({ success: false, message: 'billingStartDate is not a valid date', code: 'INVALID_DATE' });
  }

  const previousDate = tenant.billingStartDate;
  tenant.billingStartDate = newDate;
  tenant.checkInDate      = newDate;   // keep in sync — both anchor billing
  await tenant.save();

  await LedgerEntry.create({
    tenant:        tenant._id,
    property:      req.params.propertyId,
    type:          'credit',
    amount:        0,
    balanceAfter:  await rentService.getLastBalance(tenant._id),
    referenceType: 'billing_start_corrected',
    referenceId:   tenant._id,
    description:   `billingStartDate corrected from ${previousDate ? previousDate.toISOString().slice(0, 10) : 'unset'} → ${newDate.toISOString().slice(0, 10)}${reason ? `. Reason: ${reason}` : ''}`,
  });

  res.json({
    success: true,
    message: 'Billing start date corrected',
    data: {
      tenantId:          tenant._id,
      previousDate:      previousDate ?? null,
      newBillingStart:   newDate,
    },
  });
});

// ── GET /api/properties/:propertyId/tenants/:id/profile ──────────────────────
// Single aggregated endpoint replacing 4 separate profile API calls.
// Returns: tenant + rents + ledger (balance + recent entries) + advance + invoices
const getTenantProfile = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.propertyId, owner: req.user._id });
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });

  const tenant = await Tenant.findOne({ _id: req.params.id, property: req.params.propertyId })
    .populate({ path: 'bed', select: 'bedNumber room', populate: { path: 'room', select: 'roomNumber floor' } });
  if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });

  // Ensure current cycle rent exists (lazy generation), suppress errors
  try {
    await rentService.ensureCurrentCycleRentForTenant(tenant._id, req.params.propertyId);
  } catch (_) {}
  try {
    await rentService.syncOverdueRents(req.params.propertyId);
  } catch (_) {}

  const [rents, ledger, advance, invoices] = await Promise.all([
    // Rents sorted newest first
    RentPayment.find({ property: req.params.propertyId, tenant: tenant._id }).sort({ year: -1, month: -1 }).lean(),

    // Ledger: balance + first page of entries (20 most recent for timeline)
    rentService.getTenantLedger(tenant._id, { page: 1, limit: 20 }),

    // Held reservation advance (null if none)
    Bed.findOne({
      tenant:    tenant._id,
      isActive:  true,
      'reservation.reservationAmount': { $gt: 0 },
      'reservation.reservationStatus': 'held',
    }).select('_id bedNumber room reservation reservedTill').populate('room', 'roomNumber').lean(),

    // Invoices — newest first
    Invoice.find({ property: req.params.propertyId, tenant: tenant._id })
      .sort({ issuedAt: -1 })
      .select('_id invoiceNumber status totalAmount balance month year issuedAt')
      .lean(),
  ]);

  const advanceData = advance ? {
    bedId:             advance._id,
    bedNumber:         advance.bedNumber,
    roomNumber:        advance.room?.roomNumber ?? null,
    reservedTill:      advance.reservedTill,
    reservationAmount: advance.reservation.reservationAmount,
    reservationMode:   advance.reservation.reservationMode,
    reservationStatus: advance.reservation.reservationStatus,
  } : null;

  res.json({
    success: true,
    data: {
      tenant,
      rents,
      ledger,          // { entries, currentBalance, total, pages, page, limit }
      advance: advanceData,
      invoices,
    },
  });
});

// ── POST /api/properties/:propertyId/tenants/:id/vacate-with-payment ──────────
// Atomic vacate + optional payment in one request.
// Body: { vacateOption, paymentAmount, paymentMethod, checkOutDate?, notes?, depositAction? }
// This is an alias that wraps the same vacateBedCore/vacateTenantCore logic
// with explicit POST semantics for the frontend.
const vacateWithPayment = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.propertyId, owner: req.user._id });
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });

  const tenant = await Tenant.findOne({ _id: req.params.id, property: req.params.propertyId });
  if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });
  if (tenant.status === 'vacated') {
    return res.status(400).json({ success: false, message: 'Tenant is already vacated' });
  }

  if (!tenant.bed) {
    try {
      const result = await vacateTenantCore({ propertyId: req.params.propertyId, tenant, opts: req.body, userId: req.user._id });
      return res.json({ success: true, message: 'Tenant vacated', data: result.tenant });
    } catch (err) {
      return res.status(err.status ?? 500).json({ success: false, message: err.message, code: err.code ?? 'VACATE_ERROR' });
    }
  }

  const bed = await Bed.findOne({ _id: tenant.bed, isActive: true });
  if (!bed) {
    try {
      const result = await vacateTenantCore({ propertyId: req.params.propertyId, tenant, opts: req.body, userId: req.user._id });
      return res.json({ success: true, message: 'Tenant vacated', data: result.tenant });
    } catch (err) {
      return res.status(err.status ?? 500).json({ success: false, message: err.message, code: err.code ?? 'VACATE_ERROR' });
    }
  }

  const room = await Room.findById(bed.room);
  if (!room) {
    return res.status(500).json({ success: false, message: 'Room record not found', code: 'ROOM_NOT_FOUND' });
  }

  try {
    const result = await vacateBedCore({ propertyId: req.params.propertyId, room, bed, tenant, opts: req.body, userId: req.user._id });
    res.json({ success: true, message: 'Tenant vacated', data: result.tenant });
  } catch (err) {
    res.status(err.status ?? 500).json({ success: false, message: err.message, code: err.code ?? 'VACATE_ERROR' });
  }
});

module.exports = {
  searchTenants, getTenants, getTenant, createTenant, updateTenant, vacateTenant,
  getTenantAdvance, applyTenantAdvance, refundTenantAdvance,
  adjustDeposit, refundDeposit,
  fixBillingStart,
  getTenantProfile,
  vacateWithPayment,
};
