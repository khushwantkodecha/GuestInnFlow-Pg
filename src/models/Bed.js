const mongoose = require('mongoose');

const bedSchema = new mongoose.Schema(
  {
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Room',
      required: true,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      index: true,
    },
    bedNumber: {
      type: String,
      required: [true, 'Bed number is required'],
      trim: true,
    },
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
    },
    status: {
      type: String,
      enum: ['vacant', 'occupied', 'reserved', 'blocked'],
      default: 'vacant',
    },
    rentOverride: {
      type: Number,
      min: 0,
      default: null,
    },
    deposit: {
      type: Number,
      min: 0,
      default: null,
    },
    reservedTill: {
      type: Date,
      default: null,
    },
    reservation: {
      tenantId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', default: null },
      name:              { type: String, trim: true, default: null },
      phone:             { type: String, trim: true, default: null },
      moveInDate:        { type: Date, default: null },
      notes:             { type: String, trim: true, default: null },
      source:            { type: String, enum: ['reserved', 'existing_tenant'], default: 'reserved' },
      // ── Advance (token) amount ─────────────────────────────────────────────
      reservationAmount: { type: Number, min: 0, default: 0 },
      reservationMode:   { type: String, enum: ['adjust', 'refund', null], default: null },
      // held → advance collected, awaiting assignment/cancellation
      // converted → applied to first rent on assignment (adjust mode)
      // cancelled → reservation cancelled, advance marked for refund
      reservationStatus: { type: String, enum: ['held', 'converted', 'cancelled', null], default: null },
    },
    blockReason: {
      type: String,
      enum: ['maintenance', 'cleaning', 'personal', 'other', null],
      default: null,
    },
    blockNotes: {
      type: String,
      trim: true,
      default: null,
    },
    // ── Extra bed fields ─────────────────────────────────────────────────────
    isExtra: {
      type: Boolean,
      default: false,
    },
    isChargeable: {
      type: Boolean,
      default: true,
    },
    extraCharge: {
      type: Number,
      min: 0,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Prevent duplicate bed numbers within the same room
bedSchema.index({ room: 1, bedNumber: 1 }, { unique: true });
bedSchema.index({ property: 1, status: 1 });
bedSchema.index({ tenant: 1 });

module.exports = mongoose.model('Bed', bedSchema);
