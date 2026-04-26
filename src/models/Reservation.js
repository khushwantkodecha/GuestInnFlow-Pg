const mongoose = require('mongoose');

const reservationSchema = new mongoose.Schema(
  {
    property:   { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    tenant:     { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant',   required: true, index: true },
    bed:        { type: mongoose.Schema.Types.ObjectId, ref: 'Bed',      required: true },
    holdUntil:      { type: Date, required: true },
    moveInDate:     { type: Date, default: null },
    amount:         { type: Number, min: 0, default: 0 },
    mode:           { type: String, enum: ['adjust', 'refund', null], default: null },
    expectedRent:   { type: Number, min: 0, default: 0 },
    depositPlanned: { type: Number, min: 0, default: 0 },
    notes:          { type: String, trim: true, default: null },
    // 'active'    — reservation is live
    // 'converted' — tenant moved in; reservation became an assignment
    // 'cancelled' — manually cancelled by operator
    // 'expired'   — holdUntil passed without move-in
    status: {
      type:    String,
      enum:    ['active', 'converted', 'cancelled', 'expired'],
      default: 'active',
      index:   true,
    },
    cancelledAt: { type: Date, default: null },
    convertedAt: { type: Date, default: null },
    expiredAt:   { type: Date, default: null },
  },
  { timestamps: true }
);

reservationSchema.index({ tenant: 1, status: 1 });
reservationSchema.index({ bed: 1, status: 1 });

module.exports = mongoose.model('Reservation', reservationSchema);
