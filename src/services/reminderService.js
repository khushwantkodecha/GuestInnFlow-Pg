/**
 * reminderService.js
 *
 * Core reminder engine. Responsible for:
 *   - buildMessage            → contextual, type-aware message templates
 *   - getOrCreateSettings     → lazy-load per-property settings
 *   - logAndDeliver           → persist ReminderLog + call notification transport
 *   - retryFailedReminders    → retry failed logs up to MAX_RETRY_ATTEMPTS times
 *   - sendPaymentConfirmation → called from rentService after payment recorded
 *   - sendManualReminder      → called from reminderController POST /send
 *   - runDailyReminders       → daily scheduler logic (called by cron or manual trigger)
 *
 * Delivery transport is in notificationService.sendWhatsApp.
 * Set WHATSAPP_PROVIDER + credentials in .env to enable real delivery.
 */

const RentPayment      = require('../models/RentPayment');
const Tenant           = require('../models/Tenant');
const Property         = require('../models/Property');
const ReminderLog      = require('../models/ReminderLog');
const ReminderSettings = require('../models/ReminderSettings');
const { sendWhatsApp, isValidPhone, normalizePhone } = require('./notificationService');

// Maximum retry attempts after initial delivery failure
const MAX_RETRY_ATTEMPTS = 3;

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
 * Fix 3: pre_due and due_day now show the remaining balance instead of
 * the full rent amount when the tenant has made a partial payment
 * (i.e. when balance < amount).
 *
 * @param {'pre_due'|'due_day'|'overdue'|'payment_confirmation'} type
 * @param {{ name, amount, balance, dueDate, month, year, propertyName }} data
 */
const buildMessage = (type, data) => {
  const { name, amount, balance, dueDate, month, year, propertyName } = data;
  const period   = month ? `${MONTH_NAMES[(month ?? 1) - 1]} ${year}` : '';
  const prop     = propertyName ?? 'your PG';
  // partiallyPaid is true when the tenant has made at least one partial payment
  const partiallyPaid = typeof balance === 'number' && balance < amount;

  switch (type) {
    case 'pre_due':
      return [
        `Hi ${name},`,
        ``,
        partiallyPaid
          ? `This is a friendly reminder that your *remaining balance of ${fmt(balance)}* (rent ${fmt(amount)}) for *${period}* at *${prop}* is due on *${fdt(dueDate)}*.`
          : `This is a friendly reminder that your rent of *${fmt(amount)}* for *${period}* at *${prop}* is due on *${fdt(dueDate)}*.`,
        ``,
        `Please pay on time to avoid late charges. 🙏`,
        ``,
        `— ${prop} Management`,
      ].join('\n');

    case 'due_day':
      return [
        `Hi ${name},`,
        ``,
        partiallyPaid
          ? `🔔 Your *remaining balance of ${fmt(balance)}* (rent ${fmt(amount)}) for *${period}* at *${prop}* is due *today*.`
          : `🔔 Your rent of *${fmt(amount)}* for *${period}* at *${prop}* is due *today*.`,
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
        // Show remaining balance line only when a partial payment has been made
        partiallyPaid ? `Remaining Balance: *${fmt(balance)}*` : null,
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
 * rent record today.  Returns false when rentRecordId is null (callers
 * must use hasSentConfirmationToday for payment_confirmation instead).
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
 * hasSentConfirmationToday
 *
 * Fix 5: Returns true if a payment_confirmation has already been sent to
 * this tenant today.  Prevents duplicate confirmations when multiple
 * payments are recorded in a single day.
 */
const hasSentConfirmationToday = async (tenantId) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const existing = await ReminderLog.findOne({
    tenant: tenantId,
    type:   'payment_confirmation',
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
 * Fix 7: Validates and normalises the phone number before attempting delivery.
 * Invalid numbers create a failed log with retryCount exhausted (no point
 * retrying without a valid number).
 *
 * 1. Validate phone — fail-fast if invalid.
 * 2. Normalise to E.164 for provider compatibility.
 * 3. Create a ReminderLog with status 'pending'.
 * 4. Call the notification transport (sendWhatsApp).
 * 5. Update log to 'sent' | 'failed'.
 *
 * Returns the saved ReminderLog.
 */
const logAndDeliver = async ({
  tenantId, propertyId, rentRecordId, type, message, channel = 'whatsapp', phone,
}) => {
  // Fix 7 — validate phone before creating any log or hitting the provider
  if (channel === 'whatsapp' && !isValidPhone(phone)) {
    const log = await ReminderLog.create({
      tenant:     tenantId,
      property:   propertyId,
      rentRecord: rentRecordId ?? null,
      type,
      channel,
      message,
      status:     'failed',
      retryCount: MAX_RETRY_ATTEMPTS, // exhausted — no point retrying without a valid number
      meta: {
        waUrl: null,
        phone: phone ?? null,
        error: `Invalid or missing phone number: "${phone ?? ''}"`,
      },
    });
    return log;
  }

  // Normalise to E.164 so wa.me links and provider calls are consistent
  const normalized = channel === 'whatsapp' ? normalizePhone(phone) : phone;
  const digitsOnly = normalized ? normalized.replace('+', '') : '';
  const waUrl = digitsOnly
    ? `https://wa.me/${digitsOnly}?text=${encodeURIComponent(message)}`
    : null;

  const log = await ReminderLog.create({
    tenant:     tenantId,
    property:   propertyId,
    rentRecord: rentRecordId ?? null,
    type,
    channel,
    message,
    status: 'pending',
    meta: { waUrl, phone: normalized ?? phone ?? null },
  });

  try {
    if (channel === 'whatsapp' && normalized) {
      await sendWhatsApp(normalized, message);
    }
    log.status = 'sent';
    log.sentAt  = new Date();
    await log.save();
  } catch (err) {
    log.status     = 'failed';
    log.meta.error = err.message;
    await log.save();
  }

  return log;
};

// ─── Retry System ─────────────────────────────────────────────────────────────

/**
 * retryFailedReminders
 *
 * Fix 6: Finds failed ReminderLogs from the last 24 hours whose retryCount
 * is below MAX_RETRY_ATTEMPTS and re-attempts delivery.
 *
 * On success: sets status='sent', increments retryCount.
 * On failure: increments retryCount (eventually reaching MAX_RETRY_ATTEMPTS
 *             which excludes it from future retry passes).
 * Invalid phone: sets retryCount=MAX_RETRY_ATTEMPTS to stop further retries.
 *
 * Called by the retry cron (10:00 IST) — 1 hour after the main daily run.
 *
 * @returns {{ attempted, recovered, exhausted }}
 */
const retryFailedReminders = async () => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const failed = await ReminderLog.find({
    status:     'failed',
    retryCount: { $lt: MAX_RETRY_ATTEMPTS },
    createdAt:  { $gte: cutoff },
  })
    .select('_id channel message meta retryCount')
    .lean();

  const stats = { attempted: failed.length, recovered: 0, exhausted: 0 };

  for (const log of failed) {
    const phone = log.meta?.phone;

    // Phone became invalid between initial attempt and retry — exhaust immediately
    if (!phone || !isValidPhone(phone)) {
      await ReminderLog.updateOne(
        { _id: log._id },
        { $set: { retryCount: MAX_RETRY_ATTEMPTS, 'meta.error': 'Phone invalid — retries exhausted' } }
      );
      stats.exhausted++;
      continue;
    }

    try {
      if (log.channel === 'whatsapp') {
        await sendWhatsApp(phone, log.message);
      }
      await ReminderLog.updateOne(
        { _id: log._id },
        { $set: { status: 'sent', sentAt: new Date() }, $inc: { retryCount: 1 } }
      );
      stats.recovered++;
    } catch (err) {
      const newCount = log.retryCount + 1;
      await ReminderLog.updateOne(
        { _id: log._id },
        {
          $inc: { retryCount: 1 },
          $set: { 'meta.error': `retry ${newCount}: ${err.message}` },
        }
      );
      if (newCount >= MAX_RETRY_ATTEMPTS) stats.exhausted++;
    }
  }

  return stats;
};

// ─── Payment Confirmation ─────────────────────────────────────────────────────

/**
 * sendPaymentConfirmation
 *
 * Called from rentService.allocatePayment after a payment is recorded.
 * Non-fatal: errors are caught and logged; payment flow is unaffected.
 *
 * Fix 5: skips delivery if a confirmation has already been sent today
 * for this tenant (prevents duplicate messages when multiple payments
 * are recorded in one day).
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

    // Fix 5 — one confirmation per tenant per day maximum
    const alreadySent = await hasSentConfirmationToday(tenantId);
    if (alreadySent) return;

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
 * Triggered from POST /reminders/send.
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
 * Fix 4: Accepts an optional propertyId to scope the run to a single property.
 * When called from the cron (no argument), all enabled properties are processed.
 * When called from POST /reminders/trigger, only the requesting property runs.
 *
 * For each open rent record (balance > 0, status not paid):
 *   - pre_due  : if today === dueDate − preDueDays
 *   - due_day  : if today === dueDate
 *   - overdue  : if today is one of overdueEscalationDays past due (capped by maxOverdueReminders)
 *
 * Duplicate prevention: skips if already sent today (same type + rentRecord).
 *
 * Guards applied per record:
 *   - vacated tenants           → skip  (Fix 2 — tenant.status === 'vacated')
 *   - no phone                  → skip
 *   - balance === 0             → skip (fully paid — query already excludes these)
 *   - net ledger credit         → skip (tenant has advance; no debt)
 *   - max overdue cap reached   → skip
 *
 * @param {string|null} propertyId  Optional. Scopes the run to one property.
 * @returns {{ processed, sent, skipped, failed }}
 */
const runDailyReminders = async (propertyId = null) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const stats = { processed: 0, sent: 0, skipped: 0, failed: 0 };

  try {
    // Fix 4: filter settings to the requested property when propertyId is provided
    const settingsQuery = { enabled: true };
    if (propertyId) settingsQuery.property = propertyId;

    const allSettings = await ReminderSettings.find(settingsQuery).lean();
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

      // Fix 2: skip vacated tenants, tenants without phone
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

      const property = propMap[record.property.toString()];

      // Normalise due date to midnight for day-diff calculation
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

      // Skip if already sent today for this type + record
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
  retryFailedReminders,
  sendPaymentConfirmation,
  sendManualReminder,
  runDailyReminders,
};
