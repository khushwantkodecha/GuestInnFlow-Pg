const mongoose = require('mongoose');

const planConfigSchema = new mongoose.Schema(
  {
    key:         { type: String, required: true, unique: true }, // standard | pro | elite | enterprise
    name:        { type: String, required: true },
    price:       { type: Number, required: true },               // ₹ / year
    description: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PlanConfig', planConfigSchema);
