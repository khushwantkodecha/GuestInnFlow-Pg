const mongoose = require('mongoose');

/**
 * InvoiceCounter — atomic per-property per-year sequence.
 *
 * Used to generate invoice numbers in the format INV-YYYY-NNN.
 * The `seq` field is atomically incremented via findOneAndUpdate + $inc
 * so concurrent invoice generation never produces duplicate numbers.
 */
const invoiceCounterSchema = new mongoose.Schema({
  property: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: true,
  },
  year: {
    type: Number,
    required: true,
  },
  seq: {
    type: Number,
    default: 0,
  },
});

invoiceCounterSchema.index({ property: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('InvoiceCounter', invoiceCounterSchema);
