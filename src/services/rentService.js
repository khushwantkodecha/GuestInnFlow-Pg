/**
 * rentService.js
 *
 * Pure business logic — no req/res. Can be called from:
 *   - HTTP controllers
 *   - Cron jobs  (future automation)
 *   - CLI scripts (future backfills)
 */

const RentPayment    = require('../models/RentPayment');
const Payment        = require('../models/Payment');
const LedgerEntry    = require('../models/LedgerEntry');
const Tenant         = require('../models/Tenant');
const Bed            = require('../models/Bed');
const invoiceService = require('./invoiceService');

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build the exact due-date for a given tenant, month, and year.
 * Tenant.dueDate is a day-of-month (1–28).
 */
const buildDueDate = (dueDayOfMonth, month, year) =>
  new Date(year, month - 1, dueDayOfMonth, 23, 59, 59);

/**
 * Get the last ledger balance for a tenant (0 if no entries yet).
 * This is the authoritative "what does this tenant owe right now" figure.
 */
const getLastBalance = async (tenantId) => {
  const entry = await LedgerEntry.findOne({ tenant: tenantId })
    .sort({ createdAt: -1 })
    .lean();
  return entry?.balanceAfter ?? 0;
};

// ─── Rent Cycle ───────────────────────────────────────────────────────────────

/**
 * generateRentForProperty
 *
 * Creates one RentPayment record per active tenant in the property for the
 * given billing cycle. Skips tenants that already have a record for that cycle.
 * Writes a DEBIT LedgerEntry for every new record created.
 *
 * Returns: { created: [...], skipped: [...] }
 */
const generateRentForProperty = async (propertyId, month, year) => {
  const activeTenants = await Tenant.find({
    property: propertyId,
    status: { $in: ['active', 'notice'] },
  }).lean();

  if (!activeTenants.length) {
    return { created: [], skipped: [] };
  }

  const created = [];
  const skipped = [];

  const periodStart = new Date(year, month - 1, 1);
  const periodEnd   = new Date(year, month, 0, 23, 59, 59); // last day of month

  for (const tenant of activeTenants) {
    const existing = await RentPayment.findOne({ tenant: tenant._id, month, year });
    if (existing) {
      skipped.push({ tenantId: tenant._id, name: tenant.name, reason: 'Already generated' });
      continue;
    }

    const dueDate = buildDueDate(tenant.dueDate || 1, month, year);
    const status  = dueDate < new Date() ? 'overdue' : 'pending';

    // Resolve room from bed (for snapshot)
    let roomId = null;
    if (tenant.bed) {
      const bedDoc = await Bed.findById(tenant.bed).select('room').lean();
      roomId = bedDoc?.room ?? null;
    }

    const record = await RentPayment.create({
      tenant:      tenant._id,
      property:    propertyId,
      room:        roomId,
      bed:         tenant.bed ?? null,
      amount:      tenant.rentAmount,
      month,
      year,
      periodStart,
      periodEnd,
      dueDate,
      status,
    });

    // ── Ledger debit ─────────────────────────────────────────────────────────
    const prevBalance = await getLastBalance(tenant._id);
    const newBalance  = prevBalance + tenant.rentAmount;

    await LedgerEntry.create({
      tenant:        tenant._id,
      property:      propertyId,
      type:          'debit',
      amount:        tenant.rentAmount,
      balanceAfter:  newBalance,
      referenceType: 'rent_record',
      referenceId:   record._id,
      description:   `Rent for ${MONTH_SHORT[month - 1]} ${year}`,
    });

    // Cache balance on tenant doc
    await Tenant.findByIdAndUpdate(tenant._id, { ledgerBalance: newBalance });

    created.push(record);
  }

  // Auto-generate invoices for all newly created records
  if (created.length > 0) {
    await invoiceService.generateInvoices(propertyId, created);
  }

  return { created, skipped };
};

// ─── Payment Allocation ───────────────────────────────────────────────────────

/**
 * allocatePayment
 *
 * Records a payment from a tenant and applies it oldest-first across all
 * open RentPayment records for that tenant.
 *
 * Flow:
 *  1. Collect all pending/overdue records for tenant (sorted oldest first).
 *  2. Apply payment sequentially until exhausted.
 *  3. Any excess goes toward advance balance (balanceAfter goes negative).
 *  4. Create one Payment document with the full appliedTo breakdown.
 *  5. Write one LedgerEntry credit.
 *  6. Update cached Tenant.ledgerBalance.
 *
 * @param {string} propertyId
 * @param {string} tenantId
 * @param {Object} opts
 * @param {number}  opts.amount
 * @param {string}  opts.method        — payment method
 * @param {string}  [opts.referenceId] — UTR / cheque number
 * @param {string}  [opts.paymentDate] — ISO date string; defaults to now
 * @param {string}  [opts.notes]
 *
 * @returns {{ payment, allocated, advanceAmount, newBalance }}
 */
const allocatePayment = async (propertyId, tenantId, opts) => {
  const { amount, method, referenceId, paymentDate, notes } = opts;

  if (!amount || amount <= 0) {
    throw Object.assign(new Error('Payment amount must be positive'), { statusCode: 400 });
  }

  // 1. Open records — oldest due-date first
  const openRecords = await RentPayment.find({
    tenant:   tenantId,
    property: propertyId,
    status:   { $in: ['pending', 'partial', 'overdue'] },
  }).sort({ dueDate: 1 });

  // 2. Allocate oldest-first
  let remaining = amount;
  const appliedTo = [];

  for (const record of openRecords) {
    if (remaining <= 0) break;

    const due      = record.amount - record.paidAmount;
    const applying = Math.min(due, remaining);

    record.paidAmount += applying;
    if (record.paidAmount >= record.amount) {
      record.status        = 'paid';
      record.paymentDate   = paymentDate ? new Date(paymentDate) : new Date();
      record.paymentMethod = method ?? null;
    } else {
      // Partially paid: use 'partial' status regardless of whether it was overdue
      record.status = 'partial';
    }

    await record.save();

    // Keep linked invoice in sync
    await invoiceService.syncInvoiceWithPayment(record._id, record.paidAmount, record.amount);

    appliedTo.push({
      rentRecord: record._id,
      amount:     applying,
      month:      record.month,
      year:       record.year,
    });

    remaining -= applying;
  }

  const advanceAmount = remaining; // > 0 when payment exceeded total dues

  // 3. Create Payment record
  const payment = await Payment.create({
    tenant:         tenantId,
    property:       propertyId,
    amount,
    method:         method ?? 'cash',
    referenceId:    referenceId ?? null,
    paymentDate:    paymentDate ? new Date(paymentDate) : new Date(),
    notes:          notes ?? null,
    appliedTo,
    advanceApplied: advanceAmount,
  });

  // 4. LedgerEntry credit
  const prevBalance = await getLastBalance(tenantId);
  const newBalance  = prevBalance - amount;

  const methodLabel = (method ?? 'cash').replace('_', ' ');
  const description = referenceId
    ? `Payment received · ${methodLabel} · ${referenceId}`
    : `Payment received · ${methodLabel}`;

  await LedgerEntry.create({
    tenant:        tenantId,
    property:      propertyId,
    type:          'credit',
    amount,
    balanceAfter:  newBalance,
    referenceType: 'payment',
    referenceId:   payment._id,
    description,
    method:        method ?? 'cash',
  });

  // 5. Cache balance on tenant
  await Tenant.findByIdAndUpdate(tenantId, { ledgerBalance: newBalance });

  // 6. Payment confirmation reminder (non-blocking — payment is already recorded)
  // Lazy-require to avoid circular dependency at module load time
  try {
    const reminderService = require('./reminderService');
    await reminderService.sendPaymentConfirmation(tenantId, propertyId, { paidAmount: amount, newBalance });
  } catch (_) { /* non-fatal */ }

  return { payment, allocated: appliedTo, advanceAmount, newBalance };
};

// ─── Ledger Queries ───────────────────────────────────────────────────────────

/**
 * getTenantLedger
 *
 * Returns paginated + filtered LedgerEntry records for a tenant, newest first.
 * Current balance is always derived from the globally latest entry (unfiltered).
 *
 * @param {string} tenantId
 * @param {Object} [opts]
 * @param {string}  [opts.from]           — ISO date lower bound (createdAt >=)
 * @param {string}  [opts.to]             — ISO date upper bound (createdAt <=)
 * @param {string}  [opts.referenceType]  — filter by referenceType
 * @param {string}  [opts.q]             — text search on description (case-insensitive)
 * @param {number}  [opts.page=1]
 * @param {number}  [opts.limit=50]
 */
const getTenantLedger = async (tenantId, opts = {}) => {
  const { from, to, referenceType, q, page = 1, limit = 50 } = opts;

  // Current balance: always from latest entry regardless of filters
  const latestEntry    = await LedgerEntry.findOne({ tenant: tenantId }).sort({ createdAt: -1 }).lean();
  const currentBalance = latestEntry?.balanceAfter ?? 0;

  // Build filtered query
  const filter = { tenant: tenantId };
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to)   filter.createdAt.$lte = new Date(to);
  }
  if (referenceType) filter.referenceType = referenceType;
  if (q && q.trim()) {
    const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.description = { $regex: escaped, $options: 'i' };
  }

  const total   = await LedgerEntry.countDocuments(filter);
  const entries = await LedgerEntry.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  return {
    entries,
    currentBalance,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  };
};

/**
 * addManualCharge
 *
 * Creates a standalone debit LedgerEntry for a manual charge (damage, extra, etc.)
 * Increases the tenant's outstanding balance without creating a RentPayment record.
 *
 * @param {string} propertyId
 * @param {string} tenantId
 * @param {Object} opts
 * @param {number}  opts.amount
 * @param {string}  [opts.description]
 * @param {string}  [opts.chargeDate]
 */
const addManualCharge = async (propertyId, tenantId, opts) => {
  const { amount, description, chargeDate } = opts;

  if (!amount || amount <= 0) {
    throw Object.assign(new Error('Charge amount must be positive'), { statusCode: 400 });
  }

  const prevBalance = await getLastBalance(tenantId);
  const newBalance  = prevBalance + Number(amount);

  const entry = await LedgerEntry.create({
    tenant:        tenantId,
    property:      propertyId,
    type:          'debit',
    amount:        Number(amount),
    balanceAfter:  newBalance,
    referenceType: 'adjustment',
    referenceId:   tenantId,   // self-reference for standalone charges
    description:   description || 'Manual charge',
    ...(chargeDate ? { createdAt: new Date(chargeDate) } : {}),
  });

  await Tenant.findByIdAndUpdate(tenantId, { ledgerBalance: newBalance });

  return { entry, newBalance };
};

/**
 * getTenantBalance
 *
 * Returns just the current ledger balance for a tenant.
 */
const getTenantBalance = async (tenantId) => getLastBalance(tenantId);

// ─── Overdue Sync ─────────────────────────────────────────────────────────────

/**
 * syncOverdueRents
 *
 * Scans all pending RentPayments for a property whose dueDate has passed
 * and flips them to "overdue".
 *
 * Returns: number of records updated
 */
const syncOverdueRents = async (propertyId) => {
  // Both 'pending' and 'partial' records become 'overdue' after their dueDate
  const result = await RentPayment.updateMany(
    {
      property: propertyId,
      status:   { $in: ['pending', 'partial'] },
      dueDate:  { $lt: new Date() },
    },
    { $set: { status: 'overdue' } }
  );
  return result.modifiedCount;
};

/**
 * getPendingRents
 *
 * Syncs overdue first, then returns all still-pending records.
 */
const getPendingRents = async (propertyId) => {
  await syncOverdueRents(propertyId);
  return RentPayment.find({ property: propertyId, status: 'pending' })
    .populate('tenant', 'name phone bed dueDate')
    .sort({ dueDate: 1 });
};

/**
 * getOverdueRents
 *
 * Syncs overdue first, then returns all overdue records.
 */
const getOverdueRents = async (propertyId) => {
  await syncOverdueRents(propertyId);
  return RentPayment.find({ property: propertyId, status: 'overdue' })
    .populate('tenant', 'name phone bed')
    .sort({ dueDate: 1 });
};

/**
 * markAsPaid  (legacy — kept for backward compat; prefer allocatePayment)
 *
 * Records a payment against a single RentPayment record.
 * Does NOT write LedgerEntry or Payment records.
 * Use allocatePayment for full financial tracking.
 */
const markAsPaid = async (rentId, { paymentDate, paymentMethod, notes, paidAmount } = {}) => {
  const record = await RentPayment.findById(rentId);
  if (!record) return { record: null, error: 'Rent record not found' };
  if (record.status === 'paid') return { record: null, error: 'Rent is already marked as paid' };

  const remaining = record.amount - record.paidAmount;
  const paying    = paidAmount != null ? Math.min(Number(paidAmount), remaining) : remaining;

  if (paying <= 0) return { record: null, error: 'Invalid payment amount' };

  record.paidAmount += paying;

  if (record.paidAmount >= record.amount) {
    record.status      = 'paid';
    record.paymentDate = paymentDate ? new Date(paymentDate) : new Date();
  }

  if (paymentMethod) record.paymentMethod = paymentMethod;
  if (notes) record.notes = notes;
  await record.save();

  return { record, error: null };
};

module.exports = {
  generateRentForProperty,
  allocatePayment,
  getTenantLedger,
  getTenantBalance,
  addManualCharge,
  syncOverdueRents,
  getPendingRents,
  getOverdueRents,
  markAsPaid,
};
