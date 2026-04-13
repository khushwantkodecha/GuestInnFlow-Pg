/**
 * reminderService.js
 *
 * Core reminder engine. Responsible for:
 *   - buildMessage            → contextual, type-aware message templates
 *   - getOrCreateSettings     → lazy-load per-property settings
 *   - logAndDeliver           → persist ReminderLog + call notification transport
 *   - sendPaymentConfirmation → called from rentService after payment recorded
 *   - sendManualReminder      → called from notificationController / reminderController
 *   - runDailyReminders       → daily scheduler logic (called by cron)
 *
 * Delivery is intentionally abstract: logAndDeliver calls notificationService.sendWhatsApp,
 * which is a stub unless WHATSAPP_PROVIDER + credentials are set in .env.
 * Replacing the stub requires no changes here.
 */

const RentPayment      = require('../models/RentPayment');
const Tenant           = require('../models/Tenant');
const Property         = require('../models/Property');
const ReminderLog      = require('../models/ReminderLog');
const ReminderSettings = require('../models/ReminderSettings');
const { sendWhatsApp } = require('./notificationService');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const fmt = (n) => `₹${(n ?? 0).toLocaleString('en-IN')}`;
const fdt = (d) => new Date(d).toLocaleDateString('en-IN', {
  day: 'numeric', month: 'long', year: 'numeric',
});

// ─── Message Templates ────────────────────────────────────────────────────────

/**
 * buildMessage
 *
 * Returns a WhatsApp-ready plain-text message for the given reminder type.
 *
 * @param {'pre_due'|'due_day'|'overdue'|'payment_confirmation'} type
 * @param {{ name, amount, balance, dueDate, month, year, propertyName }} data
 */
const buildMessage = (type, data) => {
  const { name, amount, balance, dueDate, month, year, propertyName } = data;
  const period = month ? `${MONTH_NAMES[(month ?? 1) - 1]} ${year}` : '';
  const prop   = propertyName ?? 'your PG';

  switch (type) {
    case 'pre_due':
      return [
        `Hi ${name},`,
        ``,
        `This is a friendly reminder that your rent of *${fmt(amount)}* for *${period}* at *${prop}* is due on *${fdt(dueDate)}*.`,
        ``,
        `Please pay on time to avoid late charges. 🙏`,
        ``,
        `— ${prop} Management`,
      ].join('\n');

    case 'due_day':
      return [
        `Hi ${name},`,
        ``,
        `🔔 Your rent of *${fmt(amount)}* for *${period}* at *${prop}* is due *today*.`,
        ``,
        `Please make the payment at your earliest convenience.`,
        ``,
        `— ${prop} Management`,
      ].join('\n');

    case 'overdue':
      return [
        `Hi ${name},`,
        ``,
        `⚠️ Your rent for *${period}* at *${prop}* is overdue.`,
        ``,
        `Amount Due: *${fmt(amount)}*`,
        balance < amount ? `Remaining Balance: *${fmt(balance)}*` : null,
        ``,
        `Please clear the dues immediately to avoid further issues.`,
        ``,
        `— ${prop} Management`,
      ].filter((l) => l !== null).join('\n');

    case 'payment_confirmation':
      return [
        `Hi ${name},`,
        ``,
        `✅ We have received your payment of *${fmt(amount)}* at *${prop}*.`,
        ``,
        balance > 0
          ? `Remaining balance: *${fmt(balance)}*\nPlease clear the remaining dues soon.`
          : `Your account is fully settled. Thank you! 🎉`,
        ``,
        `— ${prop} Management`,
      ].join('\n');

    default:
      return `Hi ${name}, this is a reminder from ${prop}.`;
  }
};

// ─── Settings ─────────────────────────────────────────────────────────────────

/**
 * getOrCreateSettings
 *
 * Returns the reminder settings for a property, creating default settings
 * if none exist yet (upsert with setDefaultsOnInsert).
 */
const getOrCreateSettings = (propertyId) =>
  ReminderSettings.findOneAndUpdate(
    { property: propertyId },
    { $setOnInsert: { property: propertyId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

// ─── Duplicate Prevention ─────────────────────────────────────────────────────

/**
 * hasSentToday
 *
 * Returns true if a 'sent' reminder of this type already exists for this
 * rent record today.  payment_confirmation always passes (null rentRecord).
 */
const hasSentToday = async (rentRecordId, type) => {
  if (!rentRecordId) return false;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const existing = await ReminderLog.findOne({
    rentRecord: rentRecordId,
    type,
    status: 'sent',
    sentAt: { $gte: startOfDay },
  });
  return !!existing;
};

/**
 * countOverdueReminders
 *
 * Returns the number of 'sent' overdue reminders for a rent record.
 * Used to enforce maxOverdueReminders.
 */
const countOverdueReminders = (rentRecordId) =>
  ReminderLog.countDocuments({ rentRecord: rentRecordId, type: 'overdue', status: 'sent' });

// ─── Delivery ─────────────────────────────────────────────────────────────────

/**
 * logAndDeliver
 *
 * 1. Creates a ReminderLog with status 'pending'.
 * 2. Calls the notification transport (sendWhatsApp stub or real API).
 * 3. Updates log to 'sent' | 'failed'.
 *
 * Returns the saved ReminderLog.
 */
const logAndDeliver = async ({
  tenantId, propertyId, rentRecordId, type, message, channel = 'whatsapp', phone,
}) => {
  const cleanPhone = (phone ?? '').replace(/[^\d]/g, '');
  const waUrl = cleanPhone
    ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`
    : null;

  const log = await ReminderLog.create({
    tenant:     tenantId,
    property:   propertyId,
    rentRecord: rentRecordId ?? null,
    type,
    channel,
    message,
    status: 'pending',
    meta: { waUrl, phone: phone ?? null },
  });

  try {
    if (channel === 'whatsapp' && phone) {
      await sendWhatsApp(phone, message);
    }
    log.status = 'sent';
    log.sentAt  = new Date();
    await log.save();
  } catch (err) {
    log.status    = 'failed';
    log.meta.error = err.message;
    await log.save();
  }

  return log;
};

// ─── Payment Confirmation ─────────────────────────────────────────────────────

/**
 * sendPaymentConfirmation
 *
 * Called from rentService.allocatePayment after a payment is recorded.
 * Sends a single confirmation for the whole payment (not per-record).
 * Non-fatal: errors are caught and logged, payment flow is unaffected.
 *
 * @param {string} tenantId
 * @param {string} propertyId
 * @param {{ paidAmount: number, newBalance: number }} opts
 */
const sendPaymentConfirmation = async (tenantId, propertyId, { paidAmount, newBalance }) => {
  try {
    const [tenant, property] = await Promise.all([
      Tenant.findById(tenantId).select('name phone status').lean(),
      Property.findById(propertyId).select('name').lean(),
    ]);

    if (!tenant || tenant.status === 'vacated' || !tenant.phone) return;

    const message = buildMessage('payment_confirmation', {
      name:         tenant.name,
      amount:       paidAmount,
      balance:      Math.max(0, newBalance),
      propertyName: property?.name ?? 'your PG',
    });

    await logAndDeliver({
      tenantId,
      propertyId,
      rentRecordId: null,
      type:    'payment_confirmation',
      message,
      channel: 'whatsapp',
      phone:   tenant.phone,
    });
  } catch (err) {
    // Non-fatal — payment already recorded successfully
    console.error('[reminderService] sendPaymentConfirmation error:', err.message);
  }
};

// ─── Manual Reminder ──────────────────────────────────────────────────────────

/**
 * sendManualReminder
 *
 * Triggered from the Rent page "Remind" button or POST /reminders/send.
 * Picks the appropriate type based on current rent status.
 *
 * @param {string} tenantId
 * @param {string} propertyId
 * @returns {{ log, message, waUrl, phone, tenantName }}
 */
const sendManualReminder = async (tenantId, propertyId) => {
  const [tenant, property] = await Promise.all([
    Tenant.findById(tenantId).select('name phone status').lean(),
    Property.findById(propertyId).select('name').lean(),
  ]);

  if (!tenant)
    throw Object.assign(new Error('Tenant not found'), { statusCode: 404 });
  if (tenant.status === 'vacated')
    throw Object.assign(new Error('Cannot send reminder to a vacated tenant'), { statusCode: 400 });
  if (!tenant.phone)
    throw Object.assign(new Error('Tenant has no phone number on record'), { statusCode: 400 });

  const rentRecord = await RentPayment.findOne({
    tenant:   tenantId,
    property: propertyId,
    status:   { $in: ['pending', 'partial', 'overdue'] },
  }).sort({ year: -1, month: -1 });

  if (!rentRecord)
    throw Object.assign(new Error('No pending rent found for this tenant'), { statusCode: 404 });

  const type = rentRecord.status === 'overdue' ? 'overdue' : 'due_day';

  const message = buildMessage(type, {
    name:         tenant.name,
    amount:       rentRecord.amount,
    balance:      rentRecord.balance ?? rentRecord.amount,
    dueDate:      rentRecord.dueDate,
    month:        rentRecord.month,
    year:         rentRecord.year,
    propertyName: property?.name ?? 'your PG',
  });

  const log = await logAndDeliver({
    tenantId,
    propertyId,
    rentRecordId: rentRecord._id,
    type,
    message,
    channel: 'whatsapp',
    phone:   tenant.phone,
  });

  return {
    log,
    message,
    waUrl:      log.meta?.waUrl ?? null,
    phone:      tenant.phone,
    tenantName: tenant.name,
  };
};

// ─── Daily Scheduler Logic ────────────────────────────────────────────────────

/**
 * runDailyReminders
 *
 * Main job called by the cron scheduler every morning.
 *
 * For each open rent record (balance > 0, status not paid):
 *   - pre_due  : if today === dueDate - preDueDays
 *   - due_day  : if today === dueDate
 *   - overdue  : if today is one of overdueEscalationDays past due (capped by maxOverdueReminders)
 *
 * Duplicate prevention: skips if already sent today (same type + rentRecord).
 * Edge cases handled:
 *   - vacated tenants → skip
 *   - no phone       → skip
 *   - balance === 0  → skip (fully paid)
 *   - max cap reached → skip
 *
 * @returns {{ processed, sent, skipped, failed }}
 */
const runDailyReminders = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const stats = { processed: 0, sent: 0, skipped: 0, failed: 0 };

  try {
    const allSettings = await ReminderSettings.find({ enabled: true }).lean();
    if (!allSettings.length) return stats;

    const propertyIds = allSettings.map((s) => s.property);
    const settingsMap = Object.fromEntries(
      allSettings.map((s) => [s.property.toString(), s])
    );

    const properties = await Property.find({ _id: { $in: propertyIds } })
      .select('name')
      .lean();
    const propMap = Object.fromEntries(
      properties.map((p) => [p._id.toString(), p])
    );

    const openRecords = await RentPayment.find({
      property: { $in: propertyIds },
      status:   { $in: ['pending', 'partial', 'overdue'] },
      balance:  { $gt: 0 },
    })
      .populate('tenant', 'name phone status ledgerBalance')
      .lean();

    for (const record of openRecords) {
      stats.processed++;

      const tenant = record.tenant;
      if (!tenant || tenant.status === 'vacated' || !tenant.phone) {
        stats.skipped++;
        continue;
      }

      // Skip if tenant has advance credit (net ledger balance ≤ 0 means
      // they owe nothing or have excess paid — no reminder needed)
      if (tenant.ledgerBalance !== null && tenant.ledgerBalance !== undefined
          && tenant.ledgerBalance <= 0) {
        stats.skipped++;
        continue;
      }

      const settings = settingsMap[record.property.toString()];
      if (!settings) { stats.skipped++; continue; }

      const property  = propMap[record.property.toString()];

      // normalise due date to midnight for day-diff calculation
      const dueDate = new Date(record.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      // positive = days PAST due, negative = days BEFORE due
      const diffDays = Math.round((today - dueDate) / 86_400_000);

      let type = null;

      if (diffDays === -settings.preDueDays) {
        type = 'pre_due';
      } else if (diffDays === 0) {
        type = 'due_day';
      } else if (diffDays > 0 && settings.overdueEscalationDays.includes(diffDays)) {
        const sentCount = await countOverdueReminders(record._id);
        if (sentCount >= settings.maxOverdueReminders) {
          stats.skipped++;
          continue;
        }
        type = 'overdue';
      }

      if (!type) { stats.skipped++; continue; }

      // Skip if already sent today
      const alreadySent = await hasSentToday(record._id, type);
      if (alreadySent) { stats.skipped++; continue; }

      const message = buildMessage(type, {
        name:         tenant.name,
        amount:       record.amount,
        balance:      record.balance ?? record.amount,
        dueDate:      record.dueDate,
        month:        record.month,
        year:         record.year,
        propertyName: property?.name ?? 'your PG',
      });

      try {
        await logAndDeliver({
          tenantId:     tenant._id,
          propertyId:   record.property,
          rentRecordId: record._id,
          type,
          message,
          channel:      (settings.channels ?? ['whatsapp'])[0],
          phone:        tenant.phone,
        });
        stats.sent++;
      } catch (err) {
        stats.failed++;
        console.error('[reminderService] runDailyReminders deliver error:', err.message);
      }
    }
  } catch (err) {
    console.error('[reminderService] runDailyReminders fatal:', err.message);
  }

  return stats;
};

module.exports = {
  buildMessage,
  getOrCreateSettings,
  sendPaymentConfirmation,
  sendManualReminder,
  runDailyReminders,
};
