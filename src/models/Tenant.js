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
    checkInDate: {
      type: Date,
      required: [true, 'Check-in date is required'],
    },
    checkOutDate: {
      type: Date,
      default: null,
    },
    rentAmount: {
      type: Number,
      required: [true, 'Rent amount is required'],
      min: 0,
    },
    dueDate: {
      type: Number,
      min: 1,
      max: 28,
      default: 1,
      // Day of month on which rent is due (1–28)
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
    // Immutable billing snapshot — captured at assignment, never updated after.
    // IMPORTANT: Do NOT modify this after assignment. It is a permanent audit trail.
    billingSnapshot: {
      baseRent:         { type: Number },
      rentType:         { type: String, enum: ['per_bed', 'per_room'] },
      roomCapacity:     { type: Number },
      occupiedAtAssign: { type: Number },
      divisorUsed:      { type: Number },
      isEarlyOccupant:  { type: Boolean },       // true when first tenant in per_room
      overrideApplied:  { type: Boolean },
      overrideSource:   { type: String, enum: ['bed', 'request', null] },
      isExtra:          { type: Boolean },
      isChargeable:     { type: Boolean },
      extraCharge:      { type: Number },
      finalRent:        { type: Number },
      traceId:          { type: String },         // UUID for production log correlation
      assignedAt:       { type: Date },
    },
    status: {
      type: String,
      enum: ['active', 'vacated', 'notice'],
      default: 'active',
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
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// ── Profile completion ───────────────────────────────────────────────────────
// A profile is complete when all 6 criteria are satisfied.
const PROFILE_FIELDS = [
  { key: 'name',             label: 'Name',              check: (t) => !!t.name },
  { key: 'phone',            label: 'Phone',             check: (t) => !!t.phone },
  { key: 'aadharNumber',     label: 'ID Proof',          check: (t) => !!t.aadharNumber },
  { key: 'agreement',        label: 'Agreement',         check: (t) => !!t.checkInDate && t.rentAmount > 0 },
  { key: 'address',          label: 'Address',           check: (t) => !!t.address },
  { key: 'emergencyContact', label: 'Emergency Contact', check: (t) => !!(t.emergencyContact?.name && t.emergencyContact?.phone) },
  { key: 'idProofUploaded',  label: 'ID Document',       check: (t) => !!(t.documents?.idProofUrl || t.idProofUploaded) },
  { key: 'idVerified',       label: 'ID Verified',       check: (t) => !!(t.verification?.idVerified) },
  { key: 'policeCheck',      label: 'Police Verification', check: (t) => t.verification?.policeStatus === 'verified' },
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
