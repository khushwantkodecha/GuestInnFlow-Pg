const mongoose = require('mongoose');

const propertySchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: [true, 'Property name is required'],
      trim: true,
      index: true,
    },
    address: {
      street: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      pincode: { type: String, trim: true },
    },
    type: {
      type: String,
      enum: ['pg', 'hostel'],
      default: 'pg',
    },
    amenities: [{ type: String }],
    description: { type: String, trim: true },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Property', propertySchema);
