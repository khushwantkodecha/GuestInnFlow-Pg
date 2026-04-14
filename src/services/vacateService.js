/**
 * vacateService.js
 *
 * Two canonical vacate functions shared across all entry points:
 *
 *   vacateBedCore      — full vacate: bed + tenant + room rent recalculation
 *                        Used by bedController.vacateBed and, for occupied beds,
 *                        by tenantController.vacateTenant.
 *
 *   vacateTenantCore   — tenant-only vacate: no bed or room involved
 *                        Used by tenantController.vacateTenant when the tenant
 *                        has no bed, a stale bed reference, or a non-occupied
 *                        bed whose room cannot be found.
 *
 * Both functions handle the full financial lifecycle in a single MongoDB
 * transaction: deposit adjustment, cash collection, advance-credit refund,
 * bed/tenant state mutations, and deposit audit ledger entries. A crash at
 * any point leaves the DB unchanged.
 *
 * Opts shape (both functions):
 *   checkOutDate          string | Date
 *   notes                 string
 *   vacateOption          'collect' | 'proceed'   (default: 'proceed')
 *   paymentAmount         number   (required when vacateOption === 'collect')
 *   paymentMethod         string   (default: 'cash')
 *   depositAction         'adjust' | 'adjust_and_refund' | 'refund' | 'forfeit' | null
 *   refundAmount          number   (for depositAction === 'refund'; default: full balance)
 *   refundMethod          string   (for audit label; default: 'cash')
 *   advanceCreditRefund   boolean  (refund negative ledger balance to tenant at vacate)
 *   advanceCreditMethod   string   (method for advance refund; default: 'cash')
 */

const crypto        = require('crypto');
const Bed           = require('../models/Bed');
const Tenant        = require('../models/Tenant');
const Payment       = require('../models/Payment');
const RentPayment   = require('../models/RentPayment');
const LedgerEntry   = require('../models/LedgerEntry');
const Charge        = require('../models/Charge');
const rentService   = require('./rentService');
const invoiceService = require('./invoiceService');
const { runWithRetry }        = require('../utils/runWithRetry');
const { recalculateRoomRent } = require('../utils/recalculateRoomRent');

const logger = {
  info:  (event, meta = {}) => console.log(JSON.stringify({ level: 'info',  ts: new Date().toISOString(), event, ...meta })),
  warn:  (event, meta = {}) => console.warn(JSON.stringify({ level: 'warn',  ts: new Date().toISOString(), event, ...meta })),
  error: (event, meta = {}) => console.error(JSON.stringify({ level: 'error', ts: new Date().toISOString(), event, ...meta })),
};

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * applyPaymentInline
 *
 * Inlined payment allocation used inside the vacate transaction.
 * Mirrors allocatePayment Steps 5–10 but operates on the caller's session.
 * Returns the advance amount (remaining after all dues are cleared).
 */
const applyPaymentInline = async ({
  session, tenantId, propertyId,
  amount, method, notes, paymentDate,
}) => {
  let remaining = amount;
  const appliedTo = [];

  const openRents = await RentPayment.find({
    tenant:   tenantId,
    property: propertyId,
    status:   { $in: ['pending', 'partial', 'overdue'] },
  }).sort({ dueDate: 1 }).session(session);

  for (const record of openRents) {
    if (remaining <= 0) break;
    const due      = record.amount - (record.paidAmount ?? 0);
    const applying = Math.min(due, remaining);
    record.paidAmount = (record.paidAmount ?? 0) + applying;
    if (record.paidAmount >= record.amount) {
      record.status        = 'paid';
      record.paymentDate   = paymentDate ? new Date(paymentDate) : new Date();
      record.paymentMethod = method;
    } else {
      record.status = 'partial';
    }
    await record.save({ session });
    appliedTo.push({ rentRecord: record._id, amount: applying, month: record.month, year: record.year });
    remaining -= applying;
  }

  const chargeAllocations = [];
  if (remaining > 0) {
    const openCharges = await Charge.find({
      tenant:   tenantId,
      property: propertyId,
      status:   { $in: ['pending', 'partial'] },
    }).sort({ chargeDate: 1 }).session(session);

    for (const charge of openCharges) {
      if (remaining <= 0) break;
      const due      = charge.amount - (charge.paidAmount ?? 0);
      const applying = Math.min(due, remaining);
      charge.paidAmount = (charge.paidAmount ?? 0) + applying;
      charge.status     = charge.paidAmount >= charge.amount ? 'paid' : 'partial';
      await charge.save({ session });
      chargeAllocations.push({ chargeRecord: charge._id, amount: applying });
      remaining -= applying;
    }
  }

  const advanceApplied = Math.max(0, remaining);

  const [payment] = await Payment.create([{
    tenant:          tenantId,
    property:        propertyId,
    amount,
    method,
    notes:           notes ?? null,
    paymentDate:     paymentDate ? new Date(paymentDate) : new Date(),
    appliedTo,
    chargeAllocations,
    advanceApplied,
  }], { session });

  const prevBal = await rentService.getLastBalance(tenantId, session);
  const newBal  = prevBal - amount;
  const methodLabel = method.replace('_', ' ');

  await LedgerEntry.create([{
    tenant:        tenantId,
    property:      propertyId,
    type:          'credit',
    amount,
    balanceAfter:  newBal,
    referenceType: 'payment_received',
    referenceId:   payment._id,
    description:   `Payment received · ${methodLabel}`,
    method,
  }], { session });

  await Tenant.findByIdAndUpdate(tenantId, { ledgerBalance: newBal }, { session });

  return { payment, newBal, advanceApplied };
};

/**
 * _validateDepositAction  (Fix 3)
 *
 * Server-side deposit validation run inside the transaction so it reads
 * the authoritative DB state rather than trusting the caller.
 *
 * Rules:
 *  1. Any depositAction requires depositBalance > 0.
 *  2. 'refund' with refundAmount > depositBalance is rejected.
 *  3. 'refund' when open dues exist is rejected unless cash is also being
 *     collected in the same vacate request (vacateOption === 'collect').
 */
const _validateDepositAction = async ({
  session, freshTenant, propertyId, depositAction, refundAmount, vacateOption,
}) => {
  if (!depositAction) return;

  const depositBal = freshTenant.depositBalance ?? freshTenant.depositAmount ?? 0;

  if (depositBal <= 0) {
    const err = new Error('No security deposit balance to process');
    err.status = 400; err.code = 'NO_DEPOSIT_BALANCE';
    throw err;
  }

  if (depositAction === 'refund' && refundAmount != null) {
    const refAmt = Number(refundAmount);
    if (refAmt > depositBal) {
      const err = new Error(`Refund amount ₹${refAmt} exceeds deposit balance ₹${depositBal}`);
      err.status = 400; err.code = 'REFUND_EXCEEDS_DEPOSIT';
      throw err;
    }
  }

  // Refunding deposit while rent is outstanding sends money back to a tenant
  // who still owes. Block unless the operator is also collecting cash in this
  // same request (they may be clearing dues with the cash payment first).
  if (depositAction === 'refund' && vacateOption !== 'collect') {
    const openRents = await RentPayment.find({
      tenant:   freshTenant._id,
      property: propertyId,
      status:   { $in: ['pending', 'partial', 'overdue'] },
    }).session(session).lean();
    const pendingDues = openRents.reduce((s, r) => s + (r.amount - (r.paidAmount ?? 0)), 0);
    if (pendingDues > 0) {
      const err = new Error(
        `Cannot refund deposit — ₹${pendingDues} in rent dues are outstanding. ` +
        `Use "Adjust from Deposit" to clear dues first, or collect a payment during vacate.`
      );
      err.status = 400; err.code = 'REFUND_BLOCKED_BY_DUES';
      throw err;
    }
  }
};

/**
 * _applyAdvanceCreditRefund  (Fix 2)
 *
 * If the tenant's ledger balance is negative (advance credit — they overpaid),
 * writes a debit entry to zero the balance and records that the credit was
 * returned in cash. Called inside the transaction after all payment steps.
 *
 * Returns the refunded amount (0 if no advance credit existed).
 */
const _applyAdvanceCreditRefund = async ({
  session, tenantId, propertyId, advanceCreditMethod,
}) => {
  const currentBalance = await rentService.getLastBalance(tenantId, session);
  if (currentBalance >= 0) return 0;

  const creditAmt   = Math.abs(currentBalance);
  const methodLabel = (advanceCreditMethod ?? 'cash').replace('_', ' ');

  await LedgerEntry.create([{
    tenant:        tenantId,
    property:      propertyId,
    type:          'debit',
    amount:        creditAmt,
    balanceAfter:  0,
    referenceType: 'advance_refunded',
    referenceId:   tenantId,
    method:        advanceCreditMethod ?? 'cash',
    description:   `Advance credit ₹${creditAmt} refunded to tenant at vacate via ${methodLabel}`,
  }], { session });

  await Tenant.findByIdAndUpdate(tenantId, { ledgerBalance: 0 }, { session });
  return creditAmt;
};

/**
 * _writeDepositAuditEntries
 *
 * Writes deposit-related audit LedgerEntries inside the transaction.
 * All entries are AUDIT-ONLY — balanceAfter mirrors auditBalance without
 * changing it. The actual rent balance was already adjusted by
 * applyPaymentInline (for adjust actions) in the steps above.
 */
const _writeDepositAuditEntries = async ({
  session, tenantId, propertyId, depositAction,
  depositAdjustedAmount, originalDepositBal,
  refundedAmtForAudit, surplusRefundForAudit,
  refundMethod, auditBalance,
}) => {
  if (depositAction === 'forfeit' && originalDepositBal > 0) {
    await LedgerEntry.create([{
      tenant:        tenantId,
      property:      propertyId,
      type:          'credit',
      amount:        originalDepositBal,
      balanceAfter:  auditBalance,   // unchanged — audit-only
      referenceType: 'deposit_forfeited',
      referenceId:   tenantId,
      description:   `Security deposit ₹${originalDepositBal} forfeited at vacate — kept by property`,
    }], { session });

  } else if ((depositAction === 'adjust' || depositAction === 'adjust_and_refund') && depositAdjustedAmount > 0) {
    await LedgerEntry.create([{
      tenant:        tenantId,
      property:      propertyId,
      type:          'credit',
      amount:        depositAdjustedAmount,
      balanceAfter:  auditBalance,   // audit-only — rent balance already updated by applyPaymentInline
      referenceType: 'deposit_adjusted',
      referenceId:   tenantId,
      method:        'deposit_adjustment',
      description:   `Security deposit ₹${depositAdjustedAmount} adjusted against dues at vacate`,
    }], { session });

    if (depositAction === 'adjust_and_refund' && surplusRefundForAudit > 0) {
      const methodLabel = refundMethod ?? 'cash';
      await LedgerEntry.create([{
        tenant:        tenantId,
        property:      propertyId,
        type:          'credit',
        amount:        surplusRefundForAudit,
        balanceAfter:  auditBalance,
        referenceType: 'deposit_refunded',
        referenceId:   tenantId,
        method:        methodLabel,
        description:   `Security deposit surplus ₹${surplusRefundForAudit} refunded to tenant at vacate via ${methodLabel}`,
      }], { session });
    }

  } else if (depositAction === 'refund' && refundedAmtForAudit > 0) {
    const methodLabel = refundMethod ?? 'cash';
    await LedgerEntry.create([{
      tenant:        tenantId,
      property:      propertyId,
      type:          'credit',
      amount:        refundedAmtForAudit,
      balanceAfter:  auditBalance,   // audit-only
      referenceType: 'deposit_refunded',
      referenceId:   tenantId,
      method:        methodLabel,
      description:   `Security deposit ₹${refundedAmtForAudit} refunded to tenant at vacate via ${methodLabel}`,
    }], { session });
  }
};

// ─── vacateBedCore ────────────────────────────────────────────────────────────

/**
 * Full vacate: frees the bed, vacates the tenant, recalculates room rent for
 * remaining occupants, and handles all financial settlement in one transaction.
 *
 * Fix 5: freshBed and freshTenant are reloaded from DB at the start of every
 * runWithRetry attempt so in-memory mutations from a prior failed attempt
 * cannot corrupt the retry.
 */
const vacateBedCore = async ({ propertyId, room, bed, tenant, opts = {}, userId }) => {
  const {
    checkOutDate,
    notes,
    vacateOption,
    paymentAmount,
    paymentMethod,
    depositAction,
    refundAmount,
    refundMethod,
    advanceCreditRefund,
    advanceCreditMethod,
  } = opts;

  const traceId = crypto.randomUUID();

  // Pre-transaction validation — fail fast without opening a session
  if (vacateOption === 'collect') {
    const amt = Number(paymentAmount);
    if (!amt || amt <= 0) {
      const err = new Error('paymentAmount must be positive for collect option');
      err.code = 'INVALID_PAYMENT'; err.status = 400;
      throw err;
    }
  }

  let resultBed, resultTenant;

  await runWithRetry(async (session) => {
    // Fix 5: reload fresh DB state on every attempt so prior-attempt in-memory
    // mutations (e.g. tenant.depositBalance set to 0 during the mutation step)
    // don't corrupt the retry's deposit calculations or validation reads.
    const freshBed    = await Bed.findById(bed._id).session(session);
    const freshTenant = await Tenant.findById(tenant._id).session(session);

    if (!freshBed || !freshTenant) {
      const err = new Error('Bed or tenant record not found — may have been deleted concurrently');
      err.status = 404; err.code = 'NOT_FOUND';
      throw err;
    }

    // Capture original deposit balance BEFORE any mutations
    const originalDepositBal = freshTenant.depositBalance ?? freshTenant.depositAmount ?? 0;

    // Fix 3: server-side deposit validation (inside tx for authoritative reads)
    await _validateDepositAction({ session, freshTenant, propertyId, depositAction, refundAmount, vacateOption });

    // ── Step 1: Deposit adjustment ──────────────────────────────────────────
    let depositAdjustedAmount = 0;
    if (depositAction === 'adjust' || depositAction === 'adjust_and_refund') {
      if (originalDepositBal > 0) {
        // Cap at total open dues — never push deposit into advance territory
        const openRentsForCap = await RentPayment.find({
          tenant:   freshTenant._id,
          property: propertyId,
          status:   { $in: ['pending', 'partial', 'overdue'] },
        }).session(session).lean();
        const pendingTotal = openRentsForCap.reduce((s, r) => s + (r.amount - (r.paidAmount ?? 0)), 0);
        const applyAmt = Math.min(originalDepositBal, pendingTotal);

        if (applyAmt > 0) {
          await applyPaymentInline({
            session,
            tenantId:    freshTenant._id,
            propertyId,
            amount:      applyAmt,
            method:      'deposit_adjustment',
            notes:       'Adjusted from security deposit at vacate',
            paymentDate: checkOutDate ?? new Date().toISOString(),
          });
          depositAdjustedAmount = applyAmt;
          logger.info('vacate.deposit_adjusted', { traceId, tenantId: freshTenant._id, amount: applyAmt });
        }
      }
    }

    // ── Step 2: Cash collection ─────────────────────────────────────────────
    if (vacateOption === 'collect') {
      const amt = Number(paymentAmount); // validated pre-transaction
      await applyPaymentInline({
        session,
        tenantId:    freshTenant._id,
        propertyId,
        amount:      amt,
        method:      paymentMethod ?? 'cash',
        notes:       'Collected at vacate',
        paymentDate: checkOutDate ?? new Date().toISOString(),
      });
      logger.info('vacate.payment_collected', { traceId, tenantId: freshTenant._id, amount: amt });
    }

    // ── Step 3: Advance credit refund (Fix 2) ───────────────────────────────
    let advanceCreditRefunded = 0;
    if (advanceCreditRefund) {
      advanceCreditRefunded = await _applyAdvanceCreditRefund({
        session,
        tenantId:            freshTenant._id,
        propertyId,
        advanceCreditMethod,
      });
      if (advanceCreditRefunded > 0) {
        logger.info('vacate.advance_credit_refunded', { traceId, tenantId: freshTenant._id, amount: advanceCreditRefunded });
      }
    }

    // Pre-compute deposit audit amounts now that all payment steps are done
    // and depositAdjustedAmount is finalised.
    const refundedAmtForAudit   = depositAction === 'refund'
      ? (refundAmount > 0 ? Math.min(Number(refundAmount), originalDepositBal) : originalDepositBal)
      : 0;
    const surplusRefundForAudit = depositAction === 'adjust_and_refund'
      ? Math.max(0, originalDepositBal - depositAdjustedAmount)
      : 0;

    // ── Step 4: Vacate the bed ──────────────────────────────────────────────
    freshBed.status = 'vacant';
    freshBed.tenant = null;
    await freshBed.save({ session });

    // ── Step 5: Vacate the tenant ───────────────────────────────────────────
    freshTenant.status       = 'vacated';
    freshTenant.checkOutDate = checkOutDate ? new Date(checkOutDate) : new Date();
    freshTenant.bed          = null;
    if (notes !== undefined) freshTenant.vacateNotes = notes || null;

    if ((depositAction === 'adjust' || depositAction === 'adjust_and_refund') && depositAdjustedAmount > 0) {
      const newBal = Math.max(0, originalDepositBal - depositAdjustedAmount);
      if (depositAction === 'adjust_and_refund') {
        freshTenant.depositBalance  = 0;
        freshTenant.depositStatus   = 'refunded';
        freshTenant.depositReturned = true;
      } else {
        freshTenant.depositBalance = newBal;
        freshTenant.depositStatus  = newBal > 0 ? 'held' : 'adjusted';
      }
    } else if (depositAction === 'refund') {
      freshTenant.depositBalance  = Math.max(0, originalDepositBal - refundedAmtForAudit);
      freshTenant.depositStatus   = freshTenant.depositBalance > 0 ? 'held' : 'refunded';
      freshTenant.depositReturned = freshTenant.depositBalance === 0;
    } else if (depositAction === 'forfeit') {
      freshTenant.depositBalance  = 0;
      freshTenant.depositStatus   = 'forfeited';
      freshTenant.depositReturned = false;
    }

    await freshTenant.save({ session });

    // ── Step 6: Recalculate room rent for remaining tenants ─────────────────
    // Fix 4: session is now passed through — recalculateRoomRent reads beds
    // within the transaction snapshot (sees freshBed already as 'vacant').
    await recalculateRoomRent(room, session, 'vacate', traceId);

    // ── Step 7: Deposit audit ledger entries ────────────────────────────────
    const auditBalance = await rentService.getLastBalance(freshTenant._id, session);
    await _writeDepositAuditEntries({
      session,
      tenantId:              freshTenant._id,
      propertyId,
      depositAction,
      depositAdjustedAmount,
      originalDepositBal,
      refundedAmtForAudit,
      surplusRefundForAudit,
      refundMethod,
      auditBalance,
    });

    resultBed    = freshBed;
    resultTenant = freshTenant;
  });

  // Fix 6: sync all invoices to final settlement state post-commit (best-effort)
  try {
    await invoiceService.syncTenantInvoicesOnVacate(resultTenant._id);
  } catch (_) { /* non-fatal */ }

  logger.info('vacate.completed', {
    traceId,
    bedId:           bed._id,
    tenantId:        tenant._id,
    roomId:          room._id,
    depositAction:   depositAction ?? null,
    depositReturned: resultTenant.depositReturned,
    userId:          userId ?? null,
  });

  return { bed: resultBed, tenant: resultTenant };
};

// ─── vacateTenantCore ─────────────────────────────────────────────────────────

/**
 * Tenant-only vacate: no bed or room involved.
 *
 * Used for tenants with no bed assignment (never moved in, stale ref cleared,
 * or bed in non-occupied state with no discoverable room). Handles the full
 * financial lifecycle — deposit, cash collection, advance credit — without
 * room rent recalculation since there are no bed/room occupancy changes.
 *
 * Fix 1: previously these cases were bare status flips that skipped all
 * financial processing. Now every vacate path runs proper settlement.
 */
const vacateTenantCore = async ({ propertyId, tenant, opts = {}, userId }) => {
  const {
    checkOutDate,
    notes,
    vacateOption,
    paymentAmount,
    paymentMethod,
    depositAction,
    refundAmount,
    refundMethod,
    advanceCreditRefund,
    advanceCreditMethod,
  } = opts;

  const traceId = crypto.randomUUID();

  // Pre-transaction validation
  if (vacateOption === 'collect') {
    const amt = Number(paymentAmount);
    if (!amt || amt <= 0) {
      const err = new Error('paymentAmount must be positive for collect option');
      err.code = 'INVALID_PAYMENT'; err.status = 400;
      throw err;
    }
  }

  let resultTenant;

  await runWithRetry(async (session) => {
    // Fix 5: reload fresh state on every attempt
    const freshTenant = await Tenant.findById(tenant._id).session(session);
    if (!freshTenant) {
      const err = new Error('Tenant record not found — may have been deleted concurrently');
      err.status = 404; err.code = 'NOT_FOUND';
      throw err;
    }

    const originalDepositBal = freshTenant.depositBalance ?? freshTenant.depositAmount ?? 0;

    // Fix 3: server-side deposit validation
    await _validateDepositAction({ session, freshTenant, propertyId, depositAction, refundAmount, vacateOption });

    // ── Step 1: Deposit adjustment ──────────────────────────────────────────
    let depositAdjustedAmount = 0;
    if (depositAction === 'adjust' || depositAction === 'adjust_and_refund') {
      if (originalDepositBal > 0) {
        const openRentsForCap = await RentPayment.find({
          tenant:   freshTenant._id,
          property: propertyId,
          status:   { $in: ['pending', 'partial', 'overdue'] },
        }).session(session).lean();
        const pendingTotal = openRentsForCap.reduce((s, r) => s + (r.amount - (r.paidAmount ?? 0)), 0);
        const applyAmt = Math.min(originalDepositBal, pendingTotal);

        if (applyAmt > 0) {
          await applyPaymentInline({
            session,
            tenantId:    freshTenant._id,
            propertyId,
            amount:      applyAmt,
            method:      'deposit_adjustment',
            notes:       'Adjusted from security deposit at vacate',
            paymentDate: checkOutDate ?? new Date().toISOString(),
          });
          depositAdjustedAmount = applyAmt;
          logger.info('vacate.deposit_adjusted', { traceId, tenantId: freshTenant._id, amount: applyAmt });
        }
      }
    }

    // ── Step 2: Cash collection ─────────────────────────────────────────────
    if (vacateOption === 'collect') {
      const amt = Number(paymentAmount);
      await applyPaymentInline({
        session,
        tenantId:    freshTenant._id,
        propertyId,
        amount:      amt,
        method:      paymentMethod ?? 'cash',
        notes:       'Collected at vacate',
        paymentDate: checkOutDate ?? new Date().toISOString(),
      });
      logger.info('vacate.payment_collected', { traceId, tenantId: freshTenant._id, amount: amt });
    }

    // ── Step 3: Advance credit refund (Fix 2) ───────────────────────────────
    let advanceCreditRefunded = 0;
    if (advanceCreditRefund) {
      advanceCreditRefunded = await _applyAdvanceCreditRefund({
        session,
        tenantId:            freshTenant._id,
        propertyId,
        advanceCreditMethod,
      });
      if (advanceCreditRefunded > 0) {
        logger.info('vacate.advance_credit_refunded', { traceId, tenantId: freshTenant._id, amount: advanceCreditRefunded });
      }
    }

    const refundedAmtForAudit   = depositAction === 'refund'
      ? (refundAmount > 0 ? Math.min(Number(refundAmount), originalDepositBal) : originalDepositBal)
      : 0;
    const surplusRefundForAudit = depositAction === 'adjust_and_refund'
      ? Math.max(0, originalDepositBal - depositAdjustedAmount)
      : 0;

    // ── Step 4: Vacate the tenant ───────────────────────────────────────────
    freshTenant.status       = 'vacated';
    freshTenant.checkOutDate = checkOutDate ? new Date(checkOutDate) : new Date();
    freshTenant.bed          = null;
    if (notes !== undefined) freshTenant.vacateNotes = notes || null;

    if ((depositAction === 'adjust' || depositAction === 'adjust_and_refund') && depositAdjustedAmount > 0) {
      const newBal = Math.max(0, originalDepositBal - depositAdjustedAmount);
      if (depositAction === 'adjust_and_refund') {
        freshTenant.depositBalance  = 0;
        freshTenant.depositStatus   = 'refunded';
        freshTenant.depositReturned = true;
      } else {
        freshTenant.depositBalance = newBal;
        freshTenant.depositStatus  = newBal > 0 ? 'held' : 'adjusted';
      }
    } else if (depositAction === 'refund') {
      freshTenant.depositBalance  = Math.max(0, originalDepositBal - refundedAmtForAudit);
      freshTenant.depositStatus   = freshTenant.depositBalance > 0 ? 'held' : 'refunded';
      freshTenant.depositReturned = freshTenant.depositBalance === 0;
    } else if (depositAction === 'forfeit') {
      freshTenant.depositBalance  = 0;
      freshTenant.depositStatus   = 'forfeited';
      freshTenant.depositReturned = false;
    }

    await freshTenant.save({ session });

    // ── Step 5: Deposit audit ledger entries ────────────────────────────────
    const auditBalance = await rentService.getLastBalance(freshTenant._id, session);
    await _writeDepositAuditEntries({
      session,
      tenantId:              freshTenant._id,
      propertyId,
      depositAction,
      depositAdjustedAmount,
      originalDepositBal,
      refundedAmtForAudit,
      surplusRefundForAudit,
      refundMethod,
      auditBalance,
    });

    resultTenant = freshTenant;
  });

  // Fix 6: sync invoices post-commit (best-effort)
  try {
    await invoiceService.syncTenantInvoicesOnVacate(resultTenant._id);
  } catch (_) { /* non-fatal */ }

  logger.info('vacate.tenant_only.completed', {
    traceId,
    tenantId:  tenant._id,
    userId:    userId ?? null,
  });

  return { tenant: resultTenant };
};

module.exports = { vacateBedCore, vacateTenantCore };
