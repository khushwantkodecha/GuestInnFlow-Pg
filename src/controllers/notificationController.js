const Tenant          = require('../models/Tenant');
const Property        = require('../models/Property');
const asyncHandler    = require('../utils/asyncHandler');
const reminderService = require('../services/reminderService');

/**
 * POST /api/properties/:propertyId/notifications/rent-reminder
 * Body: { tenantId }
 *
 * Manual reminder triggered from the Rent page.
 * Delegates to reminderService.sendManualReminder so that the
 * reminder is logged in ReminderLog and uses the same contextual
 * message templates as the automated scheduler.
 */
const sendRentReminder = asyncHandler(async (req, res) => {
  const property = await Property.findOne({
    _id: req.params.propertyId,
    owner: req.user._id,
  });
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const { tenantId } = req.body;
  if (!tenantId) {
    return res.status(400).json({ success: false, message: 'tenantId is required' });
  }

  const result = await reminderService.sendManualReminder(tenantId, req.params.propertyId);

  res.json({
    success: true,
    data: {
      tenantId,
      tenantName: result.tenantName,
      phone:      result.phone,
      message:    result.message,
      whatsapp: {
        sent:  result.log.status === 'sent',
        waUrl: result.waUrl,
        note:  result.log.status !== 'sent'
          ? 'WhatsApp provider not configured. Set WHATSAPP_PROVIDER and credentials in .env to enable.'
          : undefined,
      },
    },
  });
});

/**
 * POST /api/properties/:propertyId/notifications/rent-reminder/bulk
 * Sends reminders to all tenants with pending/overdue rent in this property.
 * Runs the full daily reminder logic scoped to this property.
 */
const sendBulkRentReminders = asyncHandler(async (req, res) => {
  const property = await Property.findOne({
    _id: req.params.propertyId,
    owner: req.user._id,
  });
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const stats = await reminderService.runDailyReminders();

  res.json({
    success: true,
    data: {
      totalProcessed: stats.processed,
      sent:           stats.sent,
      skipped:        stats.skipped,
      failed:         stats.failed,
    },
  });
});

module.exports = { sendRentReminder, sendBulkRentReminders };
