const Property         = require('../models/Property');
const ReminderLog      = require('../models/ReminderLog');
const ReminderSettings = require('../models/ReminderSettings');
const asyncHandler     = require('../utils/asyncHandler');
const reminderService  = require('../services/reminderService');

const verifyOwnership = (propertyId, userId) =>
  Property.findOne({ _id: propertyId, owner: userId, isActive: true });

// ─── Logs ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/properties/:propertyId/reminders
 * Query: ?type= &status= &tenantId= &limit= &offset=
 */
const getLogs = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });

  const filter = { property: req.params.propertyId };
  if (req.query.type)     filter.type   = req.query.type;
  if (req.query.status)   filter.status = req.query.status;
  if (req.query.tenantId) filter.tenant = req.query.tenantId;

  const limit  = Math.min(parseInt(req.query.limit)  || 50, 200);
  const offset = parseInt(req.query.offset) || 0;

  const [logs, total] = await Promise.all([
    ReminderLog.find(filter)
      .populate('tenant', 'name phone')
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit),
    ReminderLog.countDocuments(filter),
  ]);

  res.json({ success: true, count: logs.length, total, data: logs });
});

// ─── Stats ────────────────────────────────────────────────────────────────────

/**
 * GET /api/properties/:propertyId/reminders/stats
 */
const getStats = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });

  const now        = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [monthAgg, todayAgg, typeAgg] = await Promise.all([
    // This month: grouped by status
    ReminderLog.aggregate([
      { $match: { property: property._id, createdAt: { $gte: startMonth } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    // Today: total count
    ReminderLog.countDocuments({ property: property._id, createdAt: { $gte: startToday } }),
    // This month: grouped by type
    ReminderLog.aggregate([
      { $match: { property: property._id, createdAt: { $gte: startMonth }, status: 'sent' } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]),
  ]);

  const byStatus  = Object.fromEntries(monthAgg.map((r) => [r._id, r.count]));
  const byType    = Object.fromEntries(typeAgg.map((r) => [r._id, r.count]));
  const monthTotal = Object.values(byStatus).reduce((a, b) => a + b, 0);

  res.json({
    success: true,
    data: {
      thisMonth: {
        total:   monthTotal,
        sent:    byStatus.sent    ?? 0,
        failed:  byStatus.failed  ?? 0,
        pending: byStatus.pending ?? 0,
      },
      today: { total: todayAgg },
      byType: {
        pre_due:              byType.pre_due              ?? 0,
        due_day:              byType.due_day              ?? 0,
        overdue:              byType.overdue              ?? 0,
        payment_confirmation: byType.payment_confirmation ?? 0,
      },
    },
  });
});

// ─── Settings ─────────────────────────────────────────────────────────────────

/**
 * GET /api/properties/:propertyId/reminders/settings
 */
const getSettings = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });

  const settings = await reminderService.getOrCreateSettings(req.params.propertyId);
  res.json({ success: true, data: settings });
});

/**
 * PUT /api/properties/:propertyId/reminders/settings
 * Body: { enabled, channels, preDueDays, overdueEscalationDays, maxOverdueReminders }
 */
const updateSettings = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });

  const ALLOWED = ['enabled', 'channels', 'preDueDays', 'overdueEscalationDays', 'maxOverdueReminders'];
  const updates = {};
  for (const key of ALLOWED) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  const settings = await ReminderSettings.findOneAndUpdate(
    { property: req.params.propertyId },
    { $set: updates },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  res.json({ success: true, data: settings });
});

// ─── Manual Trigger ───────────────────────────────────────────────────────────

/**
 * POST /api/properties/:propertyId/reminders/trigger
 * Runs the full daily reminder logic immediately (useful for testing).
 */
const triggerDailyRun = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });

  const stats = await reminderService.runDailyReminders();
  res.json({
    success: true,
    message: `Daily reminder run complete: ${stats.sent} sent, ${stats.skipped} skipped, ${stats.failed} failed`,
    data: stats,
  });
});

/**
 * POST /api/properties/:propertyId/reminders/send
 * Body: { tenantId }
 * Manually sends a contextual reminder for one tenant.
 */
const sendToTenant = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });

  const { tenantId } = req.body;
  if (!tenantId) return res.status(400).json({ success: false, message: 'tenantId is required' });

  const result = await reminderService.sendManualReminder(tenantId, req.params.propertyId);

  res.json({
    success: true,
    data: {
      tenantId,
      tenantName: result.tenantName,
      phone:      result.phone,
      message:    result.message,
      waUrl:      result.waUrl,
      status:     result.log.status,
    },
  });
});

module.exports = { getLogs, getStats, getSettings, updateSettings, triggerDailyRun, sendToTenant };
