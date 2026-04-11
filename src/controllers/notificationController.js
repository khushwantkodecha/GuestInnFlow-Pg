const Tenant = require('../models/Tenant');
const RentPayment = require('../models/RentPayment');
const Property = require('../models/Property');
const { sendWhatsApp, buildRentReminderMessage } = require('../services/notificationService');
const asyncHandler = require('../utils/asyncHandler');

// POST /api/properties/:propertyId/notifications/rent-reminder
// Body: { tenantId }
const sendRentReminder = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.propertyId, owner: req.user._id });
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const { tenantId } = req.body;
  if (!tenantId) {
    return res.status(400).json({ success: false, message: 'tenantId is required' });
  }

  const tenant = await Tenant.findOne({ _id: tenantId, property: req.params.propertyId });
  if (!tenant) {
    return res.status(404).json({ success: false, message: 'Tenant not found in this property' });
  }
  if (tenant.status === 'vacated') {
    return res.status(400).json({ success: false, message: 'Cannot send reminder to a vacated tenant' });
  }
  if (!tenant.phone) {
    return res.status(400).json({ success: false, message: 'Tenant has no phone number on record' });
  }

  // Find the latest unpaid (pending or overdue) rent for this tenant
  const rentRecord = await RentPayment.findOne({
    tenant: tenantId,
    status: { $in: ['pending', 'overdue'] },
  }).sort({ year: -1, month: -1 });

  if (!rentRecord) {
    return res.status(404).json({ success: false, message: 'No pending or overdue rent found for this tenant' });
  }

  const message = buildRentReminderMessage(tenant, rentRecord);
  const result = await sendWhatsApp(tenant.phone, message);

  res.json({
    success: true,
    data: {
      tenantId: tenant._id,
      tenantName: tenant.name,
      phone: tenant.phone,
      rentMonth: rentRecord.month,
      rentYear: rentRecord.year,
      rentStatus: rentRecord.status,
      message,
      whatsapp: result,
    },
  });
});

// POST /api/properties/:propertyId/notifications/rent-reminder/bulk
// Sends reminders to ALL tenants with pending/overdue rent in this property
const sendBulkRentReminders = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.propertyId, owner: req.user._id });
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  // All unpaid rent records for this property this month
  const unpaidRents = await RentPayment.find({
    property: req.params.propertyId,
    month: currentMonth,
    year: currentYear,
    status: { $in: ['pending', 'overdue'] },
  }).populate('tenant', 'name phone status');

  if (!unpaidRents.length) {
    return res.json({ success: true, message: 'No pending reminders to send', data: { sent: 0, skipped: 0 } });
  }

  const results = { sent: [], skipped: [] };

  for (const rent of unpaidRents) {
    const tenant = rent.tenant;

    if (!tenant || tenant.status === 'vacated' || !tenant.phone) {
      results.skipped.push({
        tenantId: tenant?._id,
        name: tenant?.name,
        reason: !tenant?.phone ? 'No phone number' : 'Tenant vacated',
      });
      continue;
    }

    const message = buildRentReminderMessage(tenant, rent);
    const whatsapp = await sendWhatsApp(tenant.phone, message);

    results.sent.push({
      tenantId: tenant._id,
      name: tenant.name,
      phone: tenant.phone,
      rentStatus: rent.status,
      message,
      whatsapp,
    });
  }

  res.json({
    success: true,
    data: {
      totalProcessed: unpaidRents.length,
      sent: results.sent.length,
      skipped: results.skipped.length,
      details: results,
    },
  });
});

module.exports = { sendRentReminder, sendBulkRentReminders };
