/**
 * invoiceReconciliationScheduler.js
 *
 * Nightly cron that detects and repairs stale invoice payment state.
 *
 * WHY THIS EXISTS
 * ──────────────
 * syncInvoiceWithPayment is called post-transaction from allocatePayment and
 * reversePayment. Because it runs outside the transaction, it can silently fail
 * (DB timeout, application crash, process restart mid-response). When it fails,
 * the Invoice retains stale paidAmount / balance / status while the underlying
 * RentPayment holds the correct state.
 *
 * This cron is the safety net: it finds every open invoice whose payment state
 * diverges from its linked RentPayment and writes the correct values.
 *
 * WHAT IS RECONCILED
 * ──────────────────
 * - paidAmount: taken from RentPayment (source of truth)
 * - balance:    invoice.totalAmount − paidAmount (respects additionalCharges)
 * - status:     derived from paidAmount vs invoice.totalAmount
 *
 * WHAT IS NOT RECONCILED
 * ──────────────────────
 * - Void invoices: intentionally excluded — they are closed.
 * - invoice.totalAmount: not recomputed — additionalCharges belong to the
 *   invoice layer and are not stored on RentPayment.
 * - Orphaned invoices (RentPayment deleted): logged but not deleted.
 *
 * SCHEDULE
 * ────────
 * 02:00 IST — after overdue sync (01:00 IST) so overdue status is already set
 * on RentPayments before we reconcile invoice payment state.
 */

const cron        = require('node-cron');
const Invoice     = require('../models/Invoice');
const RentPayment = require('../models/RentPayment');
const { deriveStatus } = require('./invoiceService');

const logger = {
  info:  (event, meta = {}) =>
    console.log(JSON.stringify({ level: 'info',  ts: new Date().toISOString(), event, ...meta })),
  error: (event, meta = {}) =>
    console.error(JSON.stringify({ level: 'error', ts: new Date().toISOString(), event, ...meta })),
};

/**
 * runInvoiceReconciliation
 *
 * Fetches all non-void invoices in an open payment state (unpaid / partial),
 * batch-loads their linked RentPayments, and updates any that are out of sync.
 *
 * Returns: { checked: number, fixed: number, orphaned: number }
 */
const runInvoiceReconciliation = async () => {
  // Only check open invoices — paid invoices are terminal unless reversed, which
  // Fix 1 (reversePayment sync) handles immediately at reversal time. Void invoices
  // are intentionally excluded.
  const invoices = await Invoice.find({
    status: { $in: ['unpaid', 'partial'] },
  })
    .select('_id rentRecord paidAmount balance status totalAmount')
    .lean();

  if (invoices.length === 0) {
    return { checked: 0, fixed: 0, orphaned: 0 };
  }

  // Batch-load all linked RentPayments in a single query
  const rentRecordIds = invoices.map((i) => i.rentRecord);
  const rentRecords   = await RentPayment.find({ _id: { $in: rentRecordIds } })
    .select('_id paidAmount amount')
    .lean();

  const rentMap = new Map(rentRecords.map((r) => [r._id.toString(), r]));

  let fixed    = 0;
  let orphaned = 0;

  for (const invoice of invoices) {
    const rent = rentMap.get(invoice.rentRecord.toString());

    if (!rent) {
      // RentPayment was deleted — invoice is orphaned. Log for investigation;
      // do not auto-delete as the invoice may be needed for audit purposes.
      logger.error('cron.invoice_reconciliation.orphaned_invoice', {
        invoiceId:    invoice._id.toString(),
        rentRecordId: invoice.rentRecord.toString(),
      });
      orphaned++;
      continue;
    }

    // Compute what the invoice fields should look like.
    // Use invoice.totalAmount (not rent.amount) so additionalCharges are preserved.
    const correctPaid    = rent.paidAmount;
    const correctBalance = Math.max(0, invoice.totalAmount - correctPaid);
    const correctStatus  = deriveStatus(correctPaid, invoice.totalAmount);

    const needsUpdate =
      invoice.paidAmount !== correctPaid    ||
      invoice.balance    !== correctBalance ||
      invoice.status     !== correctStatus;

    if (needsUpdate) {
      await Invoice.updateOne(
        { _id: invoice._id },
        { $set: { paidAmount: correctPaid, balance: correctBalance, status: correctStatus } }
      );
      fixed++;
    }
  }

  return { checked: invoices.length, fixed, orphaned };
};

const startInvoiceReconciliationScheduler = () => {
  // Nightly at 02:00 IST — after overdue sync cron (01:00 IST)
  cron.schedule(
    '0 2 * * *',
    async () => {
      logger.info('cron.invoice_reconciliation.started');
      try {
        const stats = await runInvoiceReconciliation();
        logger.info('cron.invoice_reconciliation.completed', stats);
      } catch (err) {
        logger.error('cron.invoice_reconciliation.failed', { error: err.message });
      }
    },
    { scheduled: true, timezone: 'Asia/Kolkata' }
  );

  logger.info('cron.invoice_reconciliation.scheduled', {
    schedule: '0 2 * * * (nightly 02:00 IST)',
  });
};

module.exports = { startInvoiceReconciliationScheduler, runInvoiceReconciliation };
