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
    // Amount of this payment that went toward advance balance
    // (i.e., payment exceeded total dues at the time of recording).
    advanceApplied: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

// Fast queries: tenant history, property-month reporting
paymentSchema.index({ tenant: 1, createdAt: -1 });
paymentSchema.index({ property: 1, paymentDate: -1 });

module.exports = mongoose.model('Payment', paymentSchema);
