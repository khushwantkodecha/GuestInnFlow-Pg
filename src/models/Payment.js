const mongoose = require('mongoose');

/**
 * Payment — individual payment transaction record.
 *
 * One Payment is created each time money is received from a tenant.
 * It stores the full allocation breakdown (which RentPayment records were
 * settled and how much was applied to each).
 *
 * A single payment can partially or fully cover multiple open rent records
 * (oldest-first allocation via allocatePayment in rentService.js).
 */
const paymentSchema = new mongoose.Schema(
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
      index: true,
    },
    amount: {
      type: Number,
      required: [true, 'Payment amount is required'],
      min: 1,
    },
    method: {
      type: String,
      enum: ['cash', 'upi', 'bank_transfer', 'cheque', 'other'],
      default: 'cash',
    },
    referenceId: {
      type: String,
      trim: true,
      default: null,
      // UTR number, cheque number, etc.
    },
    paymentDate: {
      type: Date,
      default: Date.now,
    },
    notes: {
      type: String,
      trim: true,
      default: null,
    },
    // Breakdown of which RentPayment records this payment was applied to.
    // Empty when the entire payment goes toward advance balance (no open records).
    appliedTo: [
      {
        rentRecord: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'RentPayment',
          required: true,
        },
        amount: {
          type: Number,
          required: true,
          min: 0,
        },
        month: { type: Number },
        year:  { type: Number },
      },
    ],
    // Breakdown of which Charge records this payment was applied to.
    // Populated by allocatePayment Step 7 when a payment covers open charges.
    // Used by reversePayment to restore Charge status on reversal.
    chargeAllocations: [
      {
        chargeRecord: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Charge',
          required: true,
        },
        amount: {
          type: Number,
          required: true,
          min: 0,
        },
      },
    ],
    // Amount of this payment that went toward advance balance
    // (i.e., payment exceeded total dues at the time of recording).
    advanceApplied: {
      type: Number,
      default: 0,
      min: 0,
    },
    // ── Idempotency ────────────────────────────────────────────────────────────
    // Optional caller-supplied key (e.g. UUID from the client) to prevent
    // duplicate payments on network retry. Stored as a sparse unique index so
    // that payments without a key are never blocked by each other.
    idempotencyKey: {
      type: String,
      trim: true,
      default: null,
    },
    // ── Reversal ───────────────────────────────────────────────────────────────
    reversed: {
      type: Boolean,
      default: false,
      index: true,
    },
    reversedAt: {
      type: Date,
      default: null,
    },
    // User who triggered the reversal
    reversedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reversalReason: {
      type: String,
      trim: true,
      default: null,
    },
  },
  { timestamps: true }
);

// Fast queries: tenant history, property-month reporting
paymentSchema.index({ tenant: 1, createdAt: -1 });
paymentSchema.index({ property: 1, paymentDate: -1 });
// Idempotency: unique among keys that are not null
paymentSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Payment', paymentSchema);
