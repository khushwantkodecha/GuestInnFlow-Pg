const mongoose    = require('mongoose');
const Property    = require('../models/Property');
const RentPayment = require('../models/RentPayment');
const Charge      = require('../models/Charge');
const Tenant      = require('../models/Tenant');
const Payment     = require('../models/Payment');
const rentService = require('../services/rentService');
const asyncHandler = require('../utils/asyncHandler');

// Verify property belongs to the logged-in user
const verifyOwnership = async (propertyId, userId) =>
  Property.findOne({ _id: propertyId, owner: userId, isActive: true });

// ─── Generate ────────────────────────────────────────────────────────────────

// POST /api/properties/:propertyId/rents/generate
// Body: { month, year }  (defaults to current month/year if omitted)
const generateMonthlyRent = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const now   = new Date();
  const month = parseInt(req.body.month) || now.getMonth() + 1;
  const year  = parseInt(req.body.year)  || now.getFullYear();

  if (month < 1 || month > 12) {
    return res.status(400).json({ success: false, message: 'month must be between 1 and 12' });
  }
  if (year < 2000 || year > 2100) {
    return res.status(400).json({ success: false, message: 'Invalid year' });
  }

  const { created, skipped } = await rentService.generateRentForProperty(
    req.params.propertyId,
    month,
    year
  );

  res.status(201).json({
    success: true,
    message: `Rent generated for ${month}/${year}`,
    data:    { created: created.length, skipped: skipped.length, records: created, skippedRecords: skipped },
  });
});

// ─── Read ─────────────────────────────────────────────────────────────────────

// GET /api/properties/:propertyId/rents
// Query: ?status=pending|paid|overdue  &month=  &year=  &tenantId=
const getAllRents = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  // Sync overdue before returning any listing
  await rentService.syncOverdueRents(req.params.propertyId);

  const filter = { property: req.params.propertyId };
  if (req.query.status)   filter.status = req.query.status;
  if (req.query.month)    filter.month  = parseInt(req.query.month);
  if (req.query.year)     filter.year   = parseInt(req.query.year);
  if (req.query.tenantId) filter.tenant = req.query.tenantId;

  const rents = await RentPayment.find(filter)
    .populate({
      path: 'tenant',
      select: 'name phone rentAmount ledgerBalance status',
      populate: {
        path: 'bed',
        select: 'bedNumber room',
        populate: { path: 'room', select: 'roomNumber floor' },
      },
    })
    .sort({ dueDate: 1 });

  // ── Attach chargesDue per tenant (deduped aggregate) ─────────────────────
  const tenantIds = [...new Set(
    rents.map(r => r.tenant?._id?.toString()).filter(Boolean),
  )];

  const chargesMap = {};
  if (tenantIds.length > 0) {
    const chargeAggs = await Charge.aggregate([
      {
        $match: {
          tenant: { $in: tenantIds.map(id => new mongoose.Types.ObjectId(id)) },
          status: { $in: ['pending', 'partial'] },
        },
      },
      { $group: { _id: '$tenant', chargesDue: { $sum: '$balance' } } },
    ]);
    chargeAggs.forEach(c => { chargesMap[c._id.toString()] = c.chargesDue || 0; });
  }

  const enriched = rents.map(r => {
    const obj      = r.toObject({ virtuals: true });
    obj.chargesDue = chargesMap[r.tenant?._id?.toString()] ?? 0;
    return obj;
  });

  res.json({ success: true, count: enriched.length, data: enriched });
});

// GET /api/properties/:propertyId/rents/pending
const getPendingRents = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const rents = await rentService.getPendingRents(req.params.propertyId);
  res.json({ success: true, count: rents.length, data: rents });
});

// GET /api/properties/:propertyId/rents/overdue
const getOverdueRents = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const rents = await rentService.getOverdueRents(req.params.propertyId);
  res.json({ success: true, count: rents.length, data: rents });
});

// GET /api/properties/:propertyId/tenants/:tenantId/rents
const getTenantRentHistory = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  // Option A — lazy billing cycle generation:
  // Ensure the current cycle's RentPayment exists before returning the list.
  // This covers missed nightly cron runs and tenants added after the cron fired.
  // Errors are suppressed so a transient failure never blocks the read.
  try {
    await rentService.ensureCurrentCycleRentForTenant(
      req.params.tenantId,
      req.params.propertyId
    );
  } catch (_) { /* non-fatal — read continues regardless */ }

  await rentService.syncOverdueRents(req.params.propertyId);

  const [rents, tenant] = await Promise.all([
    RentPayment.find({
      property: req.params.propertyId,
      tenant:   req.params.tenantId,
    }).sort({ year: -1, month: -1 }),
    Tenant.findById(req.params.tenantId).select('rentHistory').lean(),
  ]);

  // Filter to genuine rent changes only:
  //   - oldRent must exist and be > 0 (excludes initial assignment where oldRent = 0)
  //   - newRent must differ from oldRent
  const rentChanges = (tenant?.rentHistory ?? []).filter(
    (e) => e.oldRent !== undefined && e.oldRent > 0 && e.newRent !== e.oldRent
  );

  res.json({ success: true, count: rents.length, data: rents, rentChanges });
});

// ─── Payment (new — replaces per-record markAsPaid for tracked flow) ──────────

/**
 * POST /api/properties/:propertyId/rents/payments
 * Body: { tenantId, amount, method, referenceId?, paymentDate?, notes? }
 * Header: X-Idempotency-Key (optional) — caller-supplied deduplication key
 *
 * Records a payment and allocates it oldest-first across all open records
 * for that tenant. Creates a Payment document and a LedgerEntry credit.
 * All writes are atomic inside a MongoDB transaction.
 */
const recordPayment = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const { tenantId, amount, method, referenceId, paymentDate, notes } = req.body;
  const idempotencyKey = req.headers['x-idempotency-key'] ?? null;

  if (!tenantId) {
    return res.status(400).json({ success: false, message: 'tenantId is required' });
  }
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ success: false, message: 'amount must be a positive number' });
  }

  // Block payments for tenants without a bed — no bed = not active = no billing
  const payingTenant = await Tenant.findOne({ _id: tenantId, property: req.params.propertyId }).lean();
  if (!payingTenant) {
    return res.status(404).json({ success: false, message: 'Tenant not found' });
  }
  if (payingTenant.status === 'incomplete') {
    return res.status(400).json({ success: false, message: 'Cannot record payment: tenant has no bed assigned. Assign a bed first.' });
  }

  const result = await rentService.allocatePayment(
    req.params.propertyId,
    tenantId,
    {
      amount:         Number(amount),
      method,
      referenceId,
      paymentDate,
      notes,
      idempotencyKey,
    }
  );

  // 200 for idempotent replay (no new record created), 201 for new payment
  const status = result.idempotent ? 200 : 201;
  res.status(status).json({
    success: true,
    message: result.idempotent ? 'Duplicate request — returning existing payment' : 'Payment recorded',
    data:    result,
  });
});

/**
 * POST /api/properties/:propertyId/rents/payments/:id/reverse
 * Body: { reason? }
 *
 * Reverses a previously recorded payment:
 *  - Restores settled RentPayment records to pending/overdue.
 *  - Writes a LedgerEntry debit (reversal).
 *  - Marks the Payment document as reversed.
 * All writes are atomic inside a MongoDB transaction.
 */
const reversePayment = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const { reason } = req.body;

  const result = await rentService.reversePayment(
    req.params.propertyId,
    req.params.id,
    { reason, reversedBy: req.user._id }
  );

  res.json({
    success: true,
    message: 'Payment reversed',
    data:    result,
  });
});

// ─── Ledger ───────────────────────────────────────────────────────────────────

/**
 * GET /api/properties/:propertyId/rents/tenants/:tenantId/ledger
 *
 * Returns the full LedgerEntry timeline for a tenant (newest first)
 * plus the current balance.
 */
const getTenantLedger = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const { from, to, type: referenceType, q, page, limit } = req.query;

  const result = await rentService.getTenantLedger(req.params.tenantId, {
    from,
    to,
    referenceType,
    q,
    page:  Number(page)  || 1,
    limit: Math.min(Number(limit) || 50, 100),
  });

  res.json({ success: true, data: result });
});

/**
 * POST /api/properties/:propertyId/rents/tenants/:tenantId/charge
 * Body: { amount, description, chargeDate? }
 *
 * Records a manual debit (damage, extra charge, etc.) against a tenant.
 * Creates a LedgerEntry of type 'debit' / referenceType 'adjustment'.
 */
const addManualCharge = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const { amount, description, chargeDate, chargeType, dueDate } = req.body;

  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ success: false, message: 'amount must be a positive number' });
  }

  // Block charges for tenants without a bed
  const chargeTenant = await Tenant.findOne({ _id: req.params.tenantId, property: req.params.propertyId }).lean();
  if (!chargeTenant) {
    return res.status(404).json({ success: false, message: 'Tenant not found' });
  }
  if (chargeTenant.status === 'incomplete') {
    return res.status(400).json({ success: false, message: 'Cannot add charge: tenant has no bed assigned. Assign a bed first.' });
  }

  const result = await rentService.addManualCharge(
    req.params.propertyId,
    req.params.tenantId,
    { amount: Number(amount), description, chargeDate, chargeType, dueDate }
  );

  res.status(201).json({ success: true, message: 'Charge recorded', data: result });
});

// ─── Legacy pay — DISABLED ────────────────────────────────────────────────────
//
// PATCH /api/properties/:propertyId/rents/:id/pay
//
// This endpoint is permanently disabled. It bypassed the ledger (no LedgerEntry,
// no Payment record) and is incompatible with accurate financial reporting.
//
// Use POST /api/properties/:propertyId/rents/payments instead.
// That endpoint creates a full audit trail: Payment document + LedgerEntry credit.
const markRentAsPaid = asyncHandler(async (req, res) => {
  res.status(410).json({
    success: false,
    message:  'This endpoint is disabled. Use POST /rents/payments to record payments with full ledger tracking.',
    code:     'ENDPOINT_DISABLED',
    redirect: `/api/properties/${req.params.propertyId}/rents/payments`,
  });
});

module.exports = {
  generateMonthlyRent,
  getAllRents,
  getPendingRents,
  getOverdueRents,
  getTenantRentHistory,
  recordPayment,
  reversePayment,
  getTenantLedger,
  addManualCharge,
  markRentAsPaid,
};
