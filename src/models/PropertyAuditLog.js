/**
 * PropertyAuditLog.js
 *
 * Immutable audit trail for property changes.
 *
 * Every document records:
 *   - which property was affected
 *   - who made the change (user _id)
 *   - the action (update | delete)
 *   - only the fields that actually changed (before → after)
 *   - when it happened (createdAt — auto via timestamps)
 *
 * Records are intentionally never updated or deleted.
 * Indexes on property + changedBy support fast historical queries.
 */
const mongoose = require('mongoose')

const propertyAuditLogSchema = new mongoose.Schema(
  {
    property: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Property',
      required: true,
      index:    true,
    },
    changedBy: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      index:    true,
    },
    action: {
      type:    String,
      enum:    ['update', 'delete'],
      default: 'update',
    },
    // Stores only the fields that changed.
    // Shape: { fieldName: { before: oldValue, after: newValue } }
    // For delete actions: { deleted: { before: propertyName, after: null } }
    changes: {
      type:     mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // audit records are immutable
  }
)

module.exports = mongoose.model('PropertyAuditLog', propertyAuditLogSchema)
