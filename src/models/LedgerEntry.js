const mongoose = require('mongoose');

/**
 * LedgerEntry — append-only financial ledger per tenant.
 *
 * Every financial event (rent generated, payment received) writes one entry.
 * `balanceAfter` carries the running balance so any point-in-time balance can
 * be read directly from the latest entry without summing the whole history.
 *
 * Balance convention:
 *   positive → tenant has outstanding dues
 *   zero     → fully settled
 *   negative → tenant has advance/credit (overpaid)
 *
 * Entries are NEVER updated or deleted — this is an audit log.
 */
const ledgerEntrySchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: true,
    },
    // 'debit'  → rent generated (increases what tenant owes)
    // 'credit' → payment received (decreases what tenant owes; can go negative = advance)
    type: {
      type: String,
      enum: ['debit', 'credit'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    // Running balance after this entry.
    // Positive = still owes. Negative = has advance credit.
    balanceAfter: {
      type: Number,
      required: true,
    },
    // Link back to the originating document
    referenceType: {
      type: String,
      enum: ['rent_record', 'payment', 'adjustment', 'reservation_advance', 'refund', 'deposit_collected', 'deposit_adjusted', 'deposit_refunded'],
      required: true,
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    description: {
      type: String,
      trim: true,
      default: null,
    },
    // Payment method — populated where applicable (payment, refund)
    method: {
      type: String,
      enum: ['cash', 'upi', 'bank_transfer', 'cheque', 'deposit_adjustment', 'other', null],
      default: null,
    },
  },
  {
    timestamps: true,    // createdAt = canonical entry time
    // No updatedAt writes — entries are immutable after creation
  }
);

// Primary query: newest entries first for a tenant (ledger timeline)
ledgerEntrySchema.index({ tenant: 1, createdAt: -1 });
// Property-level reporting (total debits/credits for a period)
ledgerEntrySchema.index({ property: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model('LedgerEntry', ledgerEntrySchema);
