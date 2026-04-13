const mongoose = require('mongoose');

/**
 * ReminderSettings — per-property configuration for the reminder engine.
 *
 * Created lazily (with defaults) the first time a property's settings are read.
 * One document per property (unique index on `property`).
 */
const reminderSettingsSchema = new mongoose.Schema(
  {
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: true,
      unique: true,
    },

    // Master switch — when false, no automated reminders are sent
    enabled: {
      type: Boolean,
      default: true,
    },

    // Delivery channels (ordered by priority; first is primary)
    channels: {
      type: [String],
      enum: ['whatsapp', 'sms', 'email'],
      default: ['whatsapp'],
    },

    // Days BEFORE due date to send the pre-due reminder (e.g. 2 → 2 days before)
    preDueDays: {
      type: Number,
      default: 2,
      min: 1,
      max: 14,
    },

    // Days AFTER due date on which to send escalating overdue reminders
    // Default: day 1 (gentle), day 3 (warning), day 7 (strong)
    overdueEscalationDays: {
      type: [Number],
      default: [1, 3, 7],
    },

    // Hard cap on total overdue reminders per rent cycle (anti-spam)
    maxOverdueReminders: {
      type: Number,
      default: 3,
      min: 1,
      max: 10,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ReminderSettings', reminderSettingsSchema);
