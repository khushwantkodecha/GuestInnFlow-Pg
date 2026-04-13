const mongoose = require('mongoose');

/**
 * Invoice — customer-facing billing document.
 *
 * Created once per RentPayment record (one per tenant per billing cycle).
 * The invoice is a snapshot — its rentAmount and totalAmount never change
 * after creation. Only paidAmount, balance, and status are updated as
 * payments come in (synced by invoiceService.syncInvoiceWithPayment).
 *
 * Invoice number format:  INV-YYYY-NNN  (e.g. INV-2026-001)
 * Counter is per-property per-year (resets each January).
 */
const invoiceSchema = new mongoose.Schema(
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
    // Link to the RentPayment this invoice was generated from
    rentRecord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RentPayment',
      required: true,
      index: true,
    },

    // ── Identifying info ────────────────────────────────────────────────────
    invoiceNumber: {
      type: String,
      required: true,
      index: true,
    },

    // ── Billing period ──────────────────────────────────────────────────────
    periodStart: { type: Date, default: null },
    periodEnd:   { type: Date, default: null },
    month:       { type: Number, min: 1, max: 12 },  // for fast filtering
    year:        { type: Number },

    // ── Amounts (snapshot — never recalculated) ─────────────────────────────
    rentAmount:        { type: Number, required: true, min: 0 },
    additionalCharges: { type: Number, default: 0,    min: 0 },
    discount:          { type: Number, default: 0,    min: 0 },
    totalAmount:       { type: Number, required: true, min: 0 },

    // ── Payment state (updated by syncInvoiceWithPayment) ───────────────────
    paidAmount: { type: Number, default: 0, min: 0 },
    balance:    { type: Number, default: 0, min: 0 },

    status: {
      type: String,
      enum: ['unpaid', 'partial', 'paid'],
      default: 'unpaid',
    },

    // ── Dates ────────────────────────────────────────────────────────────────
    dueDate:  { type: Date, required: true },
    issuedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// One invoice per rent record (guarantees no duplicate generation)
invoiceSchema.index({ rentRecord: 1 }, { unique: true });

// Property-level listing queries
invoiceSchema.index({ property: 1, year: 1, month: 1 });
invoiceSchema.index({ property: 1, status: 1 });

// Tenant invoice history
invoiceSchema.index({ tenant: 1, issuedAt: -1 });

module.exports = mongoose.model('Invoice', invoiceSchema);
