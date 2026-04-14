/**
 * rentService.js
 *
 * Pure business logic — no req/res. Can be called from:
 *   - HTTP controllers
 *   - Cron jobs  (future automation)
 *   - CLI scripts (future backfills)
 */

const mongoose       = require('mongoose');
const RentPayment    = require('../models/RentPayment');
const Payment        = require('../models/Payment');
const LedgerEntry    = require('../models/LedgerEntry');
const Charge         = require('../models/Charge');
const Tenant         = require('../models/Tenant');
const Bed            = require('../models/Bed');
const invoiceService = require('./invoiceService');
const { runWithRetry } = require('../utils/runWithRetry');

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * computePersonalCycle
 *
 * Given a tenant's billing anchor date and a target calendar month/year,
 * returns the personal billing cycle dates for that month.
 *
 * The billingDay is derived from billingStartDate (or checkInDate fallback).
 * Capped at the last day of the target month so short months (Feb, etc.) work.
 *
 * @param {Date|null} billingStartDate  — immutable anchor (set at first assignment)
 * @param {Date|null} checkInDate       — fallback anchor
 * @param {number}    month             — 1–12
 * @param {number}    year
 * @param {number}    graceDays         — tenant.dueDate (0–28, default 5)
 * @returns {{ cycleStart, cycleEnd, dueDate, billingDay }}
 */
const computePersonalCycle = (billingStartDate, checkInDate, month, year, graceDays = 5) => {
  const anchor   = billingStartDate || checkInDate || new Date();
  const rawDay   = new Date(anchor).getDate();          // 1–31
  const lastDay  = new Date(year, month, 0).getDate();  // last day of target month
  const billingDay = Math.min(rawDay, lastDay);

  // cycleStart = billingDay of target month
  const cycleStart = new Date(year, month - 1, billingDay, 0, 0, 0, 0);

  // cycleEnd = 1 ms before same day next month
  const nextMonth = month === 12 ? 1  : month + 1;
  const nextYear  = month === 12 ? year + 1 : year;
  const lastDayNext    = new Date(nextYear, nextMonth, 0).getDate();
  const billingDayNext = Math.min(rawDay, lastDayNext);
  const nextCycleStart = new Date(nextYear, nextMonth - 1, billingDayNext, 0, 0, 0, 0);
  const cycleEnd = new Date(nextCycleStart.getTime() - 1);  // 1 ms before midnight

  // dueDate = cycleStart + graceDays (end of that day)
  const dueDate = new Date(cycleStart);
  dueDate.setDate(dueDate.getDate() + Number(graceDays));
  dueDate.setHours(23, 59, 59, 999);

  return { cycleStart, cycleEnd, dueDate, billingDay };
};

/**
 * Get the last ledger balance for a tenant (0 if no entries yet).
 * This is the authoritative "what does this tenant owe right now" figure.
 *
 * @param {string|ObjectId} tenantId
 * @param {mongoose.ClientSession|null} [session] — pass the active transaction
 *   session so the read participates in snapshot isolation and sees this
 *   session's own prior writes.
 */
const getLastBalance = async (tenantId, session = null) => {
  const query = LedgerEntry.findOne({ tenant: tenantId })
    .sort({ createdAt: -1 })
    .lean();
  if (session) query.session(session);
  const entry = await query;
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

  for (const tenant of activeTenants) {
    // Fast-path idempotency check outside transaction — avoids starting a session
    // for tenants that already have rent generated this cycle.
    const existing = await RentPayment.findOne({ tenant: tenant._id, month, year });
    if (existing) {
      skipped.push({ tenantId: tenant._id, name: tenant.name, reason: 'Already generated' });
      continue;
    }

    // ── Personal billing cycle ────────────────────────────────────────────────
    const graceDays = tenant.dueDate ?? 5;
    const { cycleStart, cycleEnd, dueDate } = computePersonalCycle(
      tenant.billingStartDate, tenant.checkInDate, month, year, graceDays
    );

    // Skip if the billing cycle hasn't started yet (tenant checked in after cycleStart)
    const billingAnchor = tenant.billingStartDate || tenant.checkInDate;
    if (billingAnchor && cycleStart < new Date(billingAnchor)) {
      skipped.push({ tenantId: tenant._id, name: tenant.name, reason: 'Billing cycle not started yet' });
      continue;
    }

    // Skip if cycle start is in the future (generate only on/after cycle start)
    if (cycleStart > new Date()) {
      skipped.push({ tenantId: tenant._id, name: tenant.name, reason: 'Cycle starts in the future' });
      continue;
    }

    const status = dueDate < new Date() ? 'overdue' : 'pending';

    // Resolve room from bed (read-only snapshot — safe outside transaction)
    let roomId = null;
    if (tenant.bed) {
      const bedDoc = await Bed.findById(tenant.bed).select('room').lean();
      roomId = bedDoc?.room ?? null;
    }

    // Fix 1+2: Wrap RentPayment + LedgerEntry + Tenant cache update in a single
    // transaction per tenant. Race-safe idempotency re-check inside the transaction
    // prevents duplicate records when two concurrent requests generate rent simultaneously.
    let createdRecord = null;
    await runWithRetry(async (session) => {
      createdRecord = null; // reset on retry

      // Race-safe re-check inside transaction
      const dup = await RentPayment.findOne({ tenant: tenant._id, month, year }).session(session).lean();
      if (dup) return; // already committed by a concurrent request — skip

      const [record] = await RentPayment.create([{
        tenant:      tenant._id,
        property:    propertyId,
        room:        roomId,
        bed:         tenant.bed ?? null,
        amount:      tenant.rentAmount,
        month,
        year,
        periodStart: cycleStart,
        periodEnd:   cycleEnd,
        dueDate,
        status,
      }], { session });

      // Fix 2: pass session so the balance read participates in snapshot isolation
      // and sees this session's own prior writes (prevents stale reads under concurrent generation).
      const prevBalance = await getLastBalance(tenant._id, session);
      const newBalance  = prevBalance + tenant.rentAmount;

      await LedgerEntry.create([{
        tenant:        tenant._id,
        property:      propertyId,
        type:          'debit',
        amount:        tenant.rentAmount,
        balanceAfter:  newBalance,
        referenceType: 'rent_generated',
        referenceId:   record._id,
        description:   `Rent for ${MONTH_SHORT[month - 1]} ${year}`,
      }], { session });

      await Tenant.findByIdAndUpdate(tenant._id, { ledgerBalance: newBalance }, { session });

      createdRecord = record;
    });

    if (createdRecord) created.push(createdRecord);
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
 * Safety guarantees:
 *  - Tenant ownership is verified before any DB write.
 *  - Idempotency: if opts.idempotencyKey is supplied and a Payment with that
 *    key already exists, the existing result is returned without re-processing.
 *  - Transaction: all writes (RentPayment updates, Charge updates, Payment
 *    creation, LedgerEntry credit, Tenant balance cache) commit atomically.
 *    MongoDB automatically retries on transient WriteConflict errors, which
 *    prevents double-allocation when two concurrent payments race for the same
 *    open records.
 *
 * Flow:
 *  1. Verify tenant belongs to property.
 *  2. Idempotency pre-check (outside tx — fast path for network retries).
 *  3. Open transaction.
 *  4. Idempotency re-check inside tx (race-safe double-check).
 *  5. Collect all pending/overdue RentPayment records (oldest first).
 *  6. Apply payment sequentially until exhausted.
 *  7. Allocate any remaining amount against open Charge records (FIFO).
 *  8. Create Payment document.
 *  9. Write LedgerEntry credit.
 * 10. Cache Tenant.ledgerBalance.
 * 11. Commit.
 * 12. Post-commit: sync invoices + send confirmation reminder (non-critical).
 *
 * @param {string} propertyId
 * @param {string} tenantId
 * @param {Object} opts
 * @param {number}  opts.amount
 * @param {string}  opts.method           — payment method
 * @param {string}  [opts.referenceId]    — UTR / cheque number
 * @param {string}  [opts.paymentDate]    — ISO date string; defaults to now
 * @param {string}  [opts.notes]
 * @param {string}  [opts.idempotencyKey] — caller-supplied deduplication key
 *
 * @returns {{ payment, allocated, advanceAmount, newBalance, idempotent? }}
 */
const allocatePayment = async (propertyId, tenantId, opts) => {
  const { amount, method, referenceId, paymentDate, notes, idempotencyKey } = opts;

  if (!amount || amount <= 0) {
    throw Object.assign(new Error('Payment amount must be positive'), { statusCode: 400 });
  }

  // Fix 4: Verify tenant belongs to property before touching any records.
  // Intentionally no status filter — vacated tenants are valid payment targets.
  // Post-vacate payments are a legitimate use case (e.g. settling dues after
  // move-out), so 'vacated' status must not block this lookup.
  const tenantDoc = await Tenant.findOne({ _id: tenantId, property: propertyId })
    .select('_id')
    .lean();
  if (!tenantDoc) {
    throw Object.assign(
      new Error('Tenant not found for this property'),
      { statusCode: 404 }
    );
  }

  // Fix 5 (pre-check): Fast idempotency lookup outside the transaction so that
  // simple network retries return immediately without starting a session.
  if (idempotencyKey) {
    const existing = await Payment.findOne({ idempotencyKey }).lean();
    if (existing) {
      const currentBalance = await getLastBalance(tenantId);
      return {
        payment:       existing,
        allocated:     existing.appliedTo,
        advanceAmount: existing.advanceApplied,
        newBalance:    currentBalance,
        idempotent:    true,
      };
    }
  }

  // Fix 1 & 2: Run everything inside a MongoDB multi-document transaction.
  // session.withTransaction() automatically retries on transient errors
  // (e.g. WriteConflict when two payments race for the same RentPayment record).
  const session = await mongoose.startSession();

  let txResult;
  // Tracks records that need invoice sync after commit (populated inside tx,
  // reset on retry so we don't sync stale data if withTransaction retries).
  const invoiceSyncQueue = [];

  try {
    await session.withTransaction(async () => {
      // Reset retry state
      invoiceSyncQueue.length = 0;

      // Fix 5 (race-safe re-check inside tx): a concurrent request may have
      // committed a payment with the same key between the pre-check above and
      // the transaction start.
      if (idempotencyKey) {
        const dup = await Payment.findOne({ idempotencyKey }).session(session).lean();
        if (dup) {
          const currentBalance = await getLastBalance(tenantId, session);
          txResult = {
            payment:       dup,
            allocated:     dup.appliedTo,
            advanceAmount: dup.advanceApplied,
            newBalance:    currentBalance,
            idempotent:    true,
          };
          return; // abort transaction body — result already set
        }
      }

      // Step 5: Open records — oldest due-date first
      const openRecords = await RentPayment.find({
        tenant:   tenantId,
        property: propertyId,
        status:   { $in: ['pending', 'partial', 'overdue'] },
      }).sort({ dueDate: 1 }).session(session);

      // Step 6: Allocate oldest-first
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

        await record.save({ session });

        // Queue for post-commit invoice sync — capture current paidAmount/amount
        invoiceSyncQueue.push({
          id:         record._id,
          paidAmount: record.paidAmount,
          amount:     record.amount,
        });

        appliedTo.push({
          rentRecord: record._id,
          amount:     applying,
          month:      record.month,
          year:       record.year,
        });

        remaining -= applying;
      }

      // Step 7: Allocate any remaining amount against open Charge records (FIFO by chargeDate)
      const chargeAllocations = [];
      if (remaining > 0) {
        const openCharges = await Charge.find({
          tenant:   tenantId,
          property: propertyId,
          status:   { $in: ['pending', 'partial'] },
        }).sort({ chargeDate: 1 }).session(session);

        for (const charge of openCharges) {
          if (remaining <= 0) break;

          const due      = charge.amount - charge.paidAmount;
          const applying = Math.min(due, remaining);

          charge.paidAmount += applying;
          charge.status      = charge.paidAmount >= charge.amount ? 'paid' : 'partial';
          await charge.save({ session });

          // Fix 5: track charge allocations so reversePayment can restore Charge status
          chargeAllocations.push({ chargeRecord: charge._id, amount: applying });

          remaining -= applying;
        }
      }

      const advanceAmount = remaining; // > 0 when payment exceeded all open dues

      // Step 8: Create Payment record
      const [payment] = await Payment.create(
        [{
          tenant:            tenantId,
          property:          propertyId,
          amount,
          method:            method ?? 'cash',
          referenceId:       referenceId ?? null,
          paymentDate:       paymentDate ? new Date(paymentDate) : new Date(),
          notes:             notes ?? null,
          appliedTo,
          chargeAllocations,
          advanceApplied:    advanceAmount,
          ...(idempotencyKey ? { idempotencyKey } : {}),
        }],
        { session }
      );

      // Step 9: LedgerEntry credit
      // getLastBalance uses session so it reads within snapshot isolation —
      // sees the session's own prior writes and is not affected by concurrent
      // transactions that haven't committed yet.
      const prevBalance = await getLastBalance(tenantId, session);
      const newBalance  = prevBalance - amount;

      const methodLabel = (method ?? 'cash').replace('_', ' ');
      const description = referenceId
        ? `Payment received · ${methodLabel} · ${referenceId}`
        : `Payment received · ${methodLabel}`;

      await LedgerEntry.create(
        [{
          tenant:        tenantId,
          property:      propertyId,
          type:          'credit',
          amount,
          balanceAfter:  newBalance,
          referenceType: 'payment_received',
          referenceId:   payment._id,
          description,
          method:        method ?? 'cash',
        }],
        { session }
      );

      // Step 10: Cache balance on tenant
      await Tenant.findByIdAndUpdate(
        tenantId,
        { ledgerBalance: newBalance },
        { session }
      );

      txResult = { payment, allocated: appliedTo, advanceAmount, newBalance };
    });
  } finally {
    await session.endSession();
  }

  // Steps 11–12: Post-commit non-critical operations (outside transaction).
  // These are best-effort — a failure here does NOT roll back the payment.
  if (txResult && !txResult.idempotent) {
    for (const { id, paidAmount, amount: total } of invoiceSyncQueue) {
      try {
        await invoiceService.syncInvoiceWithPayment(id, paidAmount, total);
      } catch (_) { /* non-fatal */ }
    }

    // Payment confirmation reminder — lazy-require avoids circular dependency
    try {
      const reminderService = require('./reminderService');
      await reminderService.sendPaymentConfirmation(tenantId, propertyId, {
        paidAmount: amount,
        newBalance: txResult.newBalance,
      });
    } catch (_) { /* non-fatal */ }
  }

  return txResult;
};

// ─── Payment Reversal ─────────────────────────────────────────────────────────

/**
 * reversePayment
 *
 * Reverses a previously recorded payment: restores the settled RentPayment
 * records to their pre-payment status, writes a balancing LedgerEntry debit,
 * and marks the original Payment as reversed.
 *
 * Atomicity: all writes run inside a MongoDB transaction. If any step fails
 * the entire reversal is rolled back.
 *
 * Limitations:
 *  - Only the RentPayment records listed in payment.appliedTo are restored.
 *    Charge records settled by the payment (step 2b in allocatePayment) are
 *    not currently tracked in appliedTo and cannot be automatically reversed.
 *    This is a known gap; a full Charge settlement log is a future improvement.
 *  - A reversed payment cannot be reversed again (idempotency guard).
 *
 * @param {string} propertyId
 * @param {string} paymentId
 * @param {Object} [opts]
 * @param {string}  [opts.reason]     — human-readable reversal reason
 * @param {string}  [opts.reversedBy] — User ID of the operator triggering reversal
 *
 * @returns {{ reversedPayment, newBalance }}
 */
const reversePayment = async (propertyId, paymentId, opts = {}) => {
  const { reason, reversedBy } = opts;

  // Load the original payment (pre-transaction read — safe, we re-check inside tx)
  const originalPayment = await Payment.findOne({ _id: paymentId, property: propertyId }).lean();
  if (!originalPayment) {
    throw Object.assign(new Error('Payment not found'), { statusCode: 404 });
  }
  if (originalPayment.reversed) {
    throw Object.assign(new Error('Payment has already been reversed'), { statusCode: 409 });
  }

  const tenantId = originalPayment.tenant.toString();

  const session = await mongoose.startSession();
  let txResult;
  // Captures the restored RentPayment state for each entry so invoice sync can
  // run post-commit without re-reading from the DB.
  const reversalSyncQueue = [];

  try {
    await session.withTransaction(async () => {
      // Reset on transaction retry
      reversalSyncQueue.length = 0;

      // Re-check inside transaction — prevents double-reversal under concurrent requests
      const pmt = await Payment.findById(paymentId).session(session);
      if (!pmt || pmt.reversed) {
        throw Object.assign(new Error('Payment has already been reversed'), { statusCode: 409 });
      }

      // Restore each RentPayment record that was settled by this payment
      for (const entry of originalPayment.appliedTo) {
        const rentRecord = await RentPayment.findById(entry.rentRecord).session(session);
        if (!rentRecord) continue; // Deleted record — skip safely

        rentRecord.paidAmount = Math.max(0, rentRecord.paidAmount - entry.amount);

        if (rentRecord.paidAmount <= 0) {
          // Fully unpaid: restore to overdue if dueDate has passed, else pending
          rentRecord.status        = rentRecord.dueDate < new Date() ? 'overdue' : 'pending';
          rentRecord.paymentDate   = null;
          rentRecord.paymentMethod = null;
        } else {
          // Still partially paid
          rentRecord.status = 'partial';
        }

        await rentRecord.save({ session });

        // Queue for post-commit invoice sync
        reversalSyncQueue.push({
          id:         entry.rentRecord,
          paidAmount: rentRecord.paidAmount,
          amount:     rentRecord.amount,
        });
      }

      // Fix 5: Restore Charge records that were settled by this payment.
      // chargeAllocations was added by allocatePayment Step 7 — older payments
      // without this field will have an empty array, so this loop is safe.
      for (const alloc of (originalPayment.chargeAllocations ?? [])) {
        const chargeRecord = await Charge.findById(alloc.chargeRecord).session(session);
        if (!chargeRecord) continue; // deleted — skip safely

        chargeRecord.paidAmount = Math.max(0, chargeRecord.paidAmount - alloc.amount);
        if (chargeRecord.paidAmount <= 0) {
          chargeRecord.status = 'pending';
        } else {
          chargeRecord.status = 'partial';
        }
        await chargeRecord.save({ session });
      }

      // Mark the payment as reversed
      pmt.reversed       = true;
      pmt.reversedAt     = new Date();
      if (reversedBy) pmt.reversedBy    = reversedBy;
      if (reason)     pmt.reversalReason = reason;
      await pmt.save({ session });

      // Write a balancing LedgerEntry debit — undoes the original credit
      const prevBalance = await getLastBalance(tenantId, session);
      const newBalance  = prevBalance + originalPayment.amount;

      await LedgerEntry.create(
        [{
          tenant:        tenantId,
          property:      propertyId,
          type:          'debit',
          amount:        originalPayment.amount,
          balanceAfter:  newBalance,
          referenceType: 'payment_reversal',
          referenceId:   pmt._id,
          description:   `Payment reversal · ${reason || 'No reason provided'}`,
        }],
        { session }
      );

      // Update cached balance
      await Tenant.findByIdAndUpdate(
        tenantId,
        { ledgerBalance: newBalance },
        { session }
      );

      txResult = { reversedPayment: pmt, newBalance };
    });
  } finally {
    await session.endSession();
  }

  // Fix 1: Sync linked invoices post-commit (non-critical — reversal is already committed).
  // syncInvoiceWithPayment skips void invoices automatically.
  for (const { id, paidAmount, amount } of reversalSyncQueue) {
    try {
      await invoiceService.syncInvoiceWithPayment(id, paidAmount, amount);
    } catch (_) { /* non-fatal */ }
  }

  return txResult;
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
 * Creates a trackable Charge record AND a debit LedgerEntry for a manual charge
 * (damage, extra service, penalty, etc.).
 *
 * The Charge record carries lifecycle state (pending → partial → paid) so
 * outstanding charges can be listed and settled via allocatePayment, which
 * processes open Charges in FIFO order after clearing open RentPayments.
 *
 * @param {string} propertyId
 * @param {string} tenantId
 * @param {Object} opts
 * @param {number}  opts.amount
 * @param {string}  [opts.description]
 * @param {string}  [opts.chargeDate]
 * @param {string}  [opts.chargeType]  — 'damage' | 'extra' | 'penalty' | 'other'
 * @param {string}  [opts.dueDate]     — ISO date; when the charge is due
 */
const addManualCharge = async (propertyId, tenantId, opts) => {
  const { amount, description, chargeDate, chargeType, dueDate } = opts;

  if (!amount || amount <= 0) {
    throw Object.assign(new Error('Charge amount must be positive'), { statusCode: 400 });
  }

  // Fix 6: Wrap Charge.create + LedgerEntry.create + back-link + Tenant balance cache
  // in a single transaction so a crash midway cannot leave a charge without a ledger
  // entry, or a ledger entry without the charge back-link.
  let txResult;
  await runWithRetry(async (session) => {
    const [charge] = await Charge.create([{
      tenant:      tenantId,
      property:    propertyId,
      amount:      Number(amount),
      description: description || 'Manual charge',
      chargeType:  chargeType  || 'other',
      chargeDate:  chargeDate  ? new Date(chargeDate) : new Date(),
      dueDate:     dueDate     ? new Date(dueDate) : null,
    }], { session });

    // Fix 2: pass session so balance read is snapshot-isolated within the transaction.
    const prevBalance = await getLastBalance(tenantId, session);
    const newBalance  = prevBalance + Number(amount);

    const [entry] = await LedgerEntry.create([{
      tenant:        tenantId,
      property:      propertyId,
      type:          'debit',
      amount:        Number(amount),
      balanceAfter:  newBalance,
      referenceType: 'adjustment',
      referenceId:   charge._id,
      description:   description || 'Manual charge',
      ...(chargeDate ? { createdAt: new Date(chargeDate) } : {}),
    }], { session });

    // Back-link the ledger entry to the charge (inside transaction — atomically consistent)
    await Charge.findByIdAndUpdate(charge._id, { ledgerEntryId: entry._id }, { session });

    await Tenant.findByIdAndUpdate(tenantId, { ledgerBalance: newBalance }, { session });

    txResult = { entry, charge, newBalance };
  });

  // Post-commit: attach charge to the most relevant open invoice (best-effort).
  // Invoice attachment is non-critical — the charge and ledger entry are already committed.
  try {
    const invoiceId = await invoiceService.attachChargeToInvoice(
      tenantId, propertyId, Number(txResult.charge.amount), chargeDate ?? null
    );
    if (invoiceId) {
      await Charge.findByIdAndUpdate(txResult.charge._id, { invoiceId });
    }
  } catch (_) { /* non-fatal */ }

  return txResult;
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
  reversePayment,
  getTenantLedger,
  getTenantBalance,
  getLastBalance,
  addManualCharge,
  syncOverdueRents,
  getPendingRents,
  getOverdueRents,
  markAsPaid,
};
