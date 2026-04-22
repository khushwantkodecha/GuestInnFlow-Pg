const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema(
  {
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: true,
    },
    roomNumber: {
      type: String,
      required: [true, 'Room number is required'],
      trim: true,
      uppercase: true,   // stored normalised
      index: true,
    },
    type: {
      type: String,
      enum: ['single', 'double', 'triple', 'dormitory'],
      required: true,
    },
    capacity: {
      type: Number,
      required: [true, 'Capacity is required'],
      min: 1,
    },
    floor: {
      type: Number,
      default: 0,
    },
    baseRent: {
      type: Number,
      required: [true, 'Base rent is required'],
      min: 0,
    },
    rentType: {
      type: String,
      enum: ['per_bed'],
      default: 'per_bed',
    },
    gender: {
      type: String,
      enum: ['male', 'female', 'unisex'],
      default: 'unisex',
    },
    status: {
      type: String,
      enum: ['available', 'maintenance', 'blocked'],
      default: 'available',
    },
    hasAC: {
      type: Boolean,
      default: false,
    },
    hasAttachedBathroom: {
      type: Boolean,
      default: false,
    },
    category: {
      type: String,
      enum: ['standard', 'premium', 'luxury'],
      default: 'standard',
    },
    notes:    { type: String, trim: true },
    amenities: [{ type: String }],
    isActive: {
      type: Boolean,
      default: true,
    },

    // ── Bed numbering style (immutable after creation) ───────────────────────
    bedNumberingType: {
      type:    String,
      enum:    ['alphabet', 'numeric'],
      default: 'alphabet',
    },
  },
  { timestamps: true }
);

// Prevent duplicate room numbers within the same property (active rooms only)
roomSchema.index({ property: 1, roomNumber: 1 }, { unique: true, partialFilterExpression: { isActive: true } });

// Optimise room listing queries: Room.find({ property, isActive: true })
roomSchema.index({ property: 1, isActive: 1 });

module.exports = mongoose.model('Room', roomSchema);
