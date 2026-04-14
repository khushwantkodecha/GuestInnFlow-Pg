const mongoose = require('mongoose');

/**
 * Charge — trackable manual charge record.
 *
 * Created by addManualCharge for any non-rent debit: damage, extra service,
 * penalty, etc. Unlike LedgerEntry (append-only audit log), a Charge record
 * has lifecycle state (pending → partial → paid) so outstanding charges can
 * be listed, filtered, and cleared independently of rent records.
 *
 * Every Charge creation also writes a LedgerEntry debit so the ledger stays
 * authoritative. Charge status is settled by allocatePayment, which processes
 * open Charges in FIFO order after clearing open RentPayments.
 */
const chargeSchema = new mongoose.Schema(
  {
    tenant: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Tenant',
      required: true,
      index:    true,
    },
    property: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Property',
      required: true,
    },
    amount: {
      type:     Number,
      required: [true, 'Charge amount is required'],
      min:      1,
    },
    paidAmount: {
      type:    Number,
      default: 0,
      min:     0,
    },
    // Stored balance (amount - paidAmount) kept in sync by pre-save hook.
    // Stored (not virtual) to support DB aggregations.
    balance: {
      type:    Number,
      default: null,
    },
    status: {
      type:    String,
      enum:    ['pending', 'partial', 'paid'],
      default: 'pending',
    },
    dueDate: {
      type:    Date,
      default: null,
    },
    description: {
      type:    String,
      trim:    true,
      default: null,
    },
    chargeType: {
      type:    String,
      enum:    ['damage', 'extra', 'penalty', 'other'],
      default: 'other',
    },
    chargeDate: {
      type:    Date,
      default: Date.now,
    },
    // Back-link to the LedgerEntry debit written at creation
    ledgerEntryId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'LedgerEntry',
      default: null,
    },
    // Back-link to the Invoice this charge was added to (set by attachChargeToInvoice).
    // Null when no open invoice existed at the time the charge was created.
    invoiceId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     'Invoice',
      default: null,
    },
  },
  { timestamps: true }
);

// Keep `balance` in sync on every save
chargeSchema.pre('save', function (next) {
  this.balance = Math.max(0, this.amount - (this.paidAmount ?? 0));
  next();
});

// Efficient queries: tenant outstanding charges, property-level reporting
chargeSchema.index({ tenant: 1, status: 1 });
chargeSchema.index({ property: 1, status: 1, chargeDate: -1 });

module.exports = mongoose.model('Charge', chargeSchema);
