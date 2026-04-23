const mongoose = require('mongoose');

const rentPaymentSchema = new mongoose.Schema(
  {
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: true,
    },
    // Room + Bed snapshots at the time of generation (historical reference)
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Room',
      default: null,
    },
    bed: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bed',
      default: null,
    },
    amount: {
      type: Number,
      required: [true, 'Rent amount is required'],
      min: 0,
    },
    month: {
      type: Number,
      required: true,
      min: 1,
      max: 12,
    },
    year: {
      type: Number,
      required: true,
    },
    // Explicit period window (for pro-rated or partial months)
    periodStart: {
      type: Date,
      default: null,
    },
    periodEnd: {
      type: Date,
      default: null,
    },
    dueDate: {
      type: Date,
      required: true,
    },
    // 'partial' = some payment recorded but balance > 0
    status: {
      type: String,
      enum: ['pending', 'partial', 'paid', 'overdue'],
      default: 'pending',
    },
    paidAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Stored balance (amount - paidAmount) — kept in sync by pre-save hook.
    // Stored (not virtual) so it can be used in DB aggregations for pendingDues.
    balance: {
      type: Number,
      default: null,
    },
    paymentDate: {
      type: Date,
      default: null,
    },
    paymentMethod: {
      type: String,
      enum: ['cash', 'upi', 'bank_transfer', 'cheque', 'deposit_adjustment'],
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: null,
    },
    // Whether this rent record belongs to an extra (over-capacity) bed.
    // Mirrored from tenant.billingSnapshot.isExtra at generation time so
    // aggregations can split extra vs. normal revenue without a join.
    isExtra: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Keep `balance` in sync on every save
rentPaymentSchema.pre('save', function (next) {
  this.balance = Math.max(0, this.amount - (this.paidAmount ?? 0));
  next();
});

// One rent record per tenant per billing cycle
rentPaymentSchema.index({ tenant: 1, month: 1, year: 1 }, { unique: true });

// Fast queries: property + status, property + month/year
rentPaymentSchema.index({ property: 1, status: 1 });
rentPaymentSchema.index({ property: 1, month: 1, year: 1 });

// Pending-dues aggregation: sum balance across non-paid records
rentPaymentSchema.index({ property: 1, balance: 1, status: 1 });

module.exports = mongoose.model('RentPayment', rentPaymentSchema);
