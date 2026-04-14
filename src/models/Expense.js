const mongoose = require('mongoose');

// ── Category list ─────────────────────────────────────────────────────────────
// Predefined categories + open 'custom' slot (label stored separately)
const EXPENSE_CATEGORIES = [
  'electricity', 'water', 'food', 'maintenance', 'internet',
  'salary', 'rent', 'cleaning', 'security', 'taxes', 'other',
];

const expenseSchema = new mongoose.Schema(
  {
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: true,
    },

    // ── Category ──────────────────────────────────────────────────────────────
    type: {
      type: String,
      enum: EXPENSE_CATEGORIES,
      required: [true, 'Expense type is required'],
    },
    // Free-text label for custom/other categories
    customLabel: {
      type: String,
      trim: true,
      default: null,
    },

    // ── Core ──────────────────────────────────────────────────────────────────
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [1, 'Amount must be greater than 0'],
    },
    date: {
      type: Date,
      required: [true, 'Expense date is required'],
      default: Date.now,
    },
    paymentMethod: {
      type: String,
      enum: ['cash', 'upi', 'bank_transfer', 'cheque', 'other'],
      default: 'cash',
    },
    notes: {
      type: String,
      trim: true,
      default: null,
    },

    // ── Approval workflow ─────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'approved',  // manual entries auto-approved; recurring start as pending
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: null,
    },

    // ── Recurring ─────────────────────────────────────────────────────────────
    isRecurring: {
      type: Boolean,
      default: false,
    },
    recurringFrequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', null],
      default: null,
    },
    recurringNextRun: {
      type: Date,
      default: null,
    },
    recurringParentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Expense',
      default: null,   // non-null on child instances spawned by cron
    },
    isRecurringActive: {
      type: Boolean,
      default: true,   // set false to pause without deleting
    },

    // ── Attachment ────────────────────────────────────────────────────────────
    // URL to a receipt image or scanned invoice (S3, Cloudinary, etc.)
    attachmentUrl: {
      type: String,
      trim: true,
      default: null,
    },

    // ── Soft delete ───────────────────────────────────────────────────────────
    // Records are never hard-deleted — isDeleted:true hides them from all reads.
    // deletedAt is kept for audit purposes.
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
expenseSchema.index({ property: 1, date: -1, isDeleted: 1 });
expenseSchema.index({ property: 1, type: 1, date: -1 });
expenseSchema.index({ property: 1, status: 1, isDeleted: 1 });
expenseSchema.index({ isRecurring: 1, recurringNextRun: 1, isRecurringActive: 1, isDeleted: 1 }); // cron

module.exports = mongoose.model('Expense', expenseSchema);
module.exports.EXPENSE_CATEGORIES = EXPENSE_CATEGORIES;
