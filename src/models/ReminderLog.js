const mongoose = require('mongoose');

/**
 * ReminderLog — audit trail for every reminder sent (or attempted).
 *
 * Created by:
 *   - reminderScheduler (daily automated job)
 *   - reminderService.sendManualReminder (Rent page "Remind" button)
 *   - reminderService.sendPaymentConfirmation (after payment recorded)
 */
const reminderLogSchema = new mongoose.Schema(
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
    // null for payment_confirmation (covers multiple records)
    rentRecord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RentPayment',
      default: null,
    },

    type: {
      type: String,
      enum: ['pre_due', 'due_day', 'overdue', 'payment_confirmation'],
      required: true,
    },

    channel: {
      type: String,
      enum: ['whatsapp', 'sms', 'email'],
      default: 'whatsapp',
    },

    message: {
      type: String,
      required: true,
    },

    status: {
      type: String,
      enum: ['pending', 'sent', 'failed'],
      default: 'pending',
    },

    sentAt: {
      type: Date,
      default: null,
    },

    // Number of retry attempts made after the initial failure (max 3)
    retryCount: {
      type: Number,
      default: 0,
    },

    // Delivery metadata
    meta: {
      waUrl: { type: String, default: null },
      phone: { type: String, default: null },
      error: { type: String, default: null },
    },
  },
  { timestamps: true }
);

// Property-level log listing (newest first)
reminderLogSchema.index({ property: 1, createdAt: -1 });
// Per-tenant history
reminderLogSchema.index({ tenant: 1, createdAt: -1 });
// Duplicate-check: has this type been sent for this rentRecord today?
reminderLogSchema.index({ rentRecord: 1, type: 1, sentAt: 1 });
// Stats aggregation
reminderLogSchema.index({ property: 1, status: 1 });
reminderLogSchema.index({ property: 1, type: 1 });
// Retry query: find failed logs that haven't exhausted retry budget
reminderLogSchema.index({ status: 1, retryCount: 1, createdAt: -1 });

module.exports = mongoose.model('ReminderLog', reminderLogSchema);
