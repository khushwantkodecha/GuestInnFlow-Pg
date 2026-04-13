const Tenant       = require('../models/Tenant');
const Bed          = require('../models/Bed');
const Property     = require('../models/Property');
const LedgerEntry  = require('../models/LedgerEntry');
const RentPayment  = require('../models/RentPayment');
const rentService  = require('../services/rentService');
const asyncHandler = require('../utils/asyncHandler');

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
    .populate('bed', 'bedNumber room')
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
    .populate('bed', 'bedNumber room')
    .sort({ updatedAt: -1 });
  res.json({ success: true, count: tenants.length, data: tenants });
});

// GET /api/properties/:propertyId/tenants/:id
const getTenant = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.propertyId, owner: req.user._id });
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const tenant = await Tenant.findOne({ _id: req.params.id, property: req.params.propertyId }).populate('bed', 'bedNumber room');
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

  const { bedId, ...tenantData } = req.body;

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

  // Validate and assign bed if provided
  if (bedId) {
    const bed = await Bed.findById(bedId);
    if (!bed || !bed.isActive) {
      return res.status(404).json({ success: false, message: 'Bed not found' });
    }
    if (bed.status !== 'vacant') {
      return res.status(409).json({ success: false, message: `Bed is ${bed.status}. Only vacant beds can be assigned.` });
    }
    tenantData.bed = bedId;
  }

  const tenant = await Tenant.create({ ...tenantData, property: req.params.propertyId });

  // Mark bed as occupied
  if (bedId) {
    await Bed.findByIdAndUpdate(bedId, { status: 'occupied', tenant: tenant._id });
  }

  res.status(201).json({ success: true, data: tenant });
});

// PUT /api/properties/:propertyId/tenants/:id
const updateTenant = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.propertyId, owner: req.user._id });
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  // ── Immutability guard: prevent overwriting locked billing fields ──────────
  // rentAmount and billingSnapshot are set ONLY during bed assignment.
  // They must never be modified through the generic update endpoint.
  const updateBody = { ...req.body };
  delete updateBody.rentAmount;
  delete updateBody.billingSnapshot;

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
      .select('depositPaid depositAmount ledgerBalance').lean();
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
        balanceAfter:  prevTenant.ledgerBalance ?? 0,  // informational — rent balance unchanged
        referenceType: 'deposit_collected',
        referenceId:   tenant._id,
        description:   `Security deposit ₹${collectedAmt} collected (manually marked)`,
      });
    }
  }

  res.json({ success: true, data: tenant });
});

// DELETE /api/properties/:propertyId/tenants/:id  — marks as vacated and frees the bed
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

  const bedRef = tenant.bed;

  tenant.status = 'vacated';
  tenant.checkOutDate = req.body.checkOutDate ? new Date(req.body.checkOutDate) : new Date();
  tenant.bed = null;
  await tenant.save();

  // Free the bed; if it was reserved by this lead, clear the reservation too
  if (bedRef) {
    const bedDoc = await Bed.findById(bedRef);
    if (bedDoc) {
      const wasReserved = bedDoc.status === 'reserved';
      bedDoc.status = 'vacant';
      bedDoc.tenant = null;
      if (wasReserved || String(bedDoc.reservation?.tenantId) === String(tenant._id)) {
        bedDoc.reservedTill = null;
        bedDoc.reservation  = { tenantId: null, name: null, phone: null, moveInDate: null, notes: null, source: 'reserved' };
      }
      await bedDoc.save();
    }
  }

  res.json({ success: true, message: 'Tenant vacated', data: tenant });
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

  const prevBalance = tenant.ledgerBalance ?? 0;
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

  const prevBalance = tenant.ledgerBalance ?? 0;
  const newBalance  = prevBalance - advAmt;

  await LedgerEntry.create({
    tenant:        tenant._id,
    property:      property._id,
    type:          'credit',
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

  const openRents = await RentPayment.find({
    tenant:   tenant._id,
    property: req.params.propertyId,
    status:   { $in: ['pending', 'partial', 'overdue'] },
  }).lean();
  const pendingTotal = openRents.reduce((s, r) => s + (r.amount - (r.paidAmount ?? 0)), 0);

  if (pendingTotal <= 0) {
    return res.status(400).json({ success: false, message: 'No outstanding dues to adjust against', code: 'NO_DUES' });
  }

  const applyAmt = Math.min(depositBal, pendingTotal);

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

  // Fetch updated balance after allocatePayment updated it
  const freshTenant = await Tenant.findById(tenant._id).select('ledgerBalance').lean();
  await LedgerEntry.create({
    tenant:        tenant._id,
    property:      req.params.propertyId,
    type:          'credit',
    amount:        applyAmt,
    balanceAfter:  freshTenant?.ledgerBalance ?? 0,
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
    balanceAfter:  tenant.ledgerBalance ?? 0,  // informational — rent balance unchanged
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

module.exports = {
  searchTenants, getTenants, getTenant, createTenant, updateTenant, vacateTenant,
  getTenantAdvance, applyTenantAdvance, refundTenantAdvance,
  adjustDeposit, refundDeposit,
};
