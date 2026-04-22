const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema(
  {
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: true,
    },
    bed: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bed',
      default: null,
    },
    name: {
      type: String,
      required: [true, 'Tenant name is required'],
      trim: true,
      index: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      index: true,
    },
    aadharNumber: {
      type: String,
      trim: true,
    },
    emergencyContact: {
      name: { type: String, trim: true },
      phone: { type: String, trim: true },
      relation: { type: String, trim: true },
    },
    address: {
      type: String,
      trim: true,
      default: null,
    },
    idProofUploaded: {
      type: Boolean,
      default: false,
    },
    // ── Documents ────────────────────────────────────────────────────────────
    documents: {
      idProofUrl: { type: String, trim: true, default: null },
      photoUrl:   { type: String, trim: true, default: null },
    },
    // ── Agreement ────────────────────────────────────────────────────────────
    agreementType:    { type: String, enum: ['monthly', 'fixed', null], default: null },
    agreementFileUrl: { type: String, trim: true, default: null },
    // ── Verification ─────────────────────────────────────────────────────────
    verification: {
      policeStatus:             { type: String, enum: ['pending', 'submitted', 'verified'], default: 'pending' },
      idVerified:               { type: Boolean, default: false },
      emergencyContactVerified: { type: Boolean, default: false },
    },
    // ── Reservation amount (token/advance collected at reservation time) ────────
    // Mirrored from bed.reservation.reservationAmount at reservation time.
    // Cleared (set to 0) when the advance is disposed at check-in.
    reservationAmount: {
      type:    Number,
      default: 0,
      min:     0,
    },

    checkInDate: {
      type: Date,
      default: null,   // set during bed assignment; null for 'reserved' tenants
    },
    checkOutDate: {
      type: Date,
      default: null,
    },
    rentAmount: {
      type: Number,
      default: 0,      // set during bed assignment; 0 for 'reserved' tenants
      min: 0,
    },
    // billingStartDate: immutable anchor for the personal billing cycle.
    // Set to checkInDate on first bed assignment and never changed on room transfer.
    // billingDay = billingStartDate.getDate(); cycle starts on this day each month.
    billingStartDate: {
      type: Date,
      default: null,
    },
    depositAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    depositPaid: {
      type: Boolean,
      default: false,
    },
    depositBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    depositStatus: {
      type: String,
      // 'pending'  — amount recorded, not yet collected
      // 'held'     — collected and held (= "paid" in spec terms)
      // 'adjusted' — applied against rent dues
      // 'refunded' — returned to tenant
      // 'forfeited'— kept by property
      enum: ['pending', 'held', 'adjusted', 'refunded', 'forfeited', null],
      default: null,
    },
    depositPaidAt: {
      type: Date,
      default: null,
    },
    // Billing snapshot — updated on every rent recalculation event
    // (assign, vacate, change-room, extra bed add/remove).
    // finalRent mirrors rentAmount; other fields provide calculation context.
    billingSnapshot: {
      baseRent:        { type: Number },
      rentType:        { type: String, enum: ['per_bed'] },
      roomCapacity:    { type: Number },
      divisorUsed:     { type: Number },   // normalOccupied at the time of last recalc
      overrideApplied: { type: Boolean },
      overrideSource:  { type: String, enum: ['bed', 'request', null] },
      isExtra:         { type: Boolean },
      isChargeable:    { type: Boolean },
      extraCharge:     { type: Number },
      finalRent:       { type: Number },
      traceId:         { type: String },   // UUID linking log lines to this recalc event
      assignedAt:      { type: Date },
    },
    // Append-only transfer history — one entry written on every room/bed change.
    transferHistory: [
      {
        fromBed:        { type: mongoose.Schema.Types.ObjectId, ref: 'Bed' },
        fromRoom:       { type: mongoose.Schema.Types.ObjectId, ref: 'Room' },
        toBed:          { type: mongoose.Schema.Types.ObjectId, ref: 'Bed' },
        toRoom:         { type: mongoose.Schema.Types.ObjectId, ref: 'Room' },
        fromBedNumber:  { type: String },
        fromRoomNumber: { type: String },
        toBedNumber:    { type: String },
        toRoomNumber:   { type: String },
        fromRent:       { type: Number },
        toRent:         { type: Number },
        changedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        traceId:        { type: String },
        transferredAt:  { type: Date, default: Date.now },
      },
    ],
    // Append-only rent history — one entry written on every recalculation.
    // Each entry records the full before/after state so any point in time can
    // be reconstructed without scanning the whole collection.
    rentHistory: [
      {
        oldRent:     { type: Number },            // rentAmount BEFORE this recalc
        newRent:     { type: Number, required: true }, // rentAmount AFTER (= persisted rentAmount)
        source:      { type: String },            // engine token: 'per_bed' | 'per_room_split' | 'override' | 'extra_*'
        divisorUsed: { type: Number },            // null for per_bed / extra beds
        reason:      { type: String },            // 'assign' | 'vacate' | 'change_room' | 'extra_bed_change'
                                                  // | 'base_rent_update' | 'rent_type_update'
        traceId:     { type: String },            // UUID linking log lines to this recalc event
        changedAt:   { type: Date, default: Date.now },
      },
    ],
    status: {
      type: String,
      // 'reserved' = bed held, not yet moved in (was 'lead')
      enum: ['active', 'vacated', 'notice', 'merged', 'reserved'],
      default: 'active',
    },
    // Set when this tenant record was absorbed into another via the merge flow.
    mergedInto: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
    },
    // ── Vacate metadata ──────────────────────────────────────────────────────
    vacateNotes: {
      type: String,
      trim: true,
      default: null,
    },
    depositReturned: {
      type: Boolean,
      default: false,
    },
    // ── Financial ledger cache ───────────────────────────────────────────────
    // Mirrors the last LedgerEntry.balanceAfter for this tenant.
    // Positive = tenant still owes. Negative = tenant has advance credit.
    // Updated by allocatePayment and generateRentForProperty in rentService.
    // Source of truth is LedgerEntry; this is a read-optimised snapshot.
    ledgerBalance: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Unique identity: one active tenant per phone per property.
tenantSchema.index(
  { property: 1, phone: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['active', 'notice', 'reserved'] } },
    name: 'unique_active_phone_per_property',
  }
);

// Compound indexes for efficient property-scoped search and sorting
tenantSchema.index({ property: 1, name:      1 }, { name: 'prop_name' });
tenantSchema.index({ property: 1, status:    1 }, { name: 'prop_status' });
tenantSchema.index({ property: 1, updatedAt: -1 }, { name: 'prop_recent' });

// ── Profile completion ───────────────────────────────────────────────────────
// A profile is COMPLETE when the 7 fields required for daily rent tracking are present.
// Optional fields (aadhaar, address, emergency contact, documents) do NOT block completion.
// 'bed' is a system-assigned field (set via bed assignment), not user-fillable — excluded from profile fields.
const PROFILE_FIELDS = [
  { key: 'name',             label: 'Name',              check: (t) => !!t.name },
  { key: 'phone',            label: 'Phone',             check: (t) => !!t.phone },
  { key: 'moveInDate',       label: 'Move-in Date',      check: (t) => !!t.checkInDate },
  { key: 'monthlyRent',      label: 'Monthly Rent',      check: (t) => !!(t.rentAmount > 0) },
  { key: 'aadharNumber',     label: 'Aadhaar Number',    check: (t) => !!t.aadharNumber },
  { key: 'emergencyContact', label: 'Emergency Contact', check: (t) => !!(t.emergencyContact?.name && t.emergencyContact?.phone) },
];

// Stored field — kept in sync by pre-save hook so it can be queried/indexed.
tenantSchema.add({
  profileStatus: {
    type:    String,
    enum:    ['incomplete', 'complete'],
    default: 'incomplete',
    index:   true,
  },
});

// Recompute profileStatus on every save.
tenantSchema.pre('save', function (next) {
  // Keep idProofUploaded in sync with documents.idProofUrl
  if (this.documents?.idProofUrl) this.idProofUploaded = true;
  this.profileStatus = PROFILE_FIELDS.every(f => f.check(this)) ? 'complete' : 'incomplete';
  next();
});

// Virtual for the detailed breakdown (percent, missing list).
tenantSchema.virtual('profileCompletion').get(function () {
  const filled = PROFILE_FIELDS.filter(f => f.check(this));
  return {
    total:   PROFILE_FIELDS.length,
    filled:  filled.length,
    percent: Math.round((filled.length / PROFILE_FIELDS.length) * 100),
    missing: PROFILE_FIELDS.filter(f => !f.check(this)).map(f => f.label),
  };
});

module.exports = mongoose.model('Tenant', tenantSchema);
