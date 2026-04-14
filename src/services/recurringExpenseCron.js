/**
 * recurringExpenseCron.js
 *
 * Runs daily at midnight IST.
 * Finds all active recurring expense templates whose nextRunDate has arrived,
 * spawns a child expense record (pending approval), then advances nextRunDate.
 */

const cron    = require('node-cron');
const Expense = require('../models/Expense');

const logger = {
  info:  (event, meta = {}) => console.log(JSON.stringify({ level: 'info',  ts: new Date().toISOString(), event, ...meta })),
  error: (event, meta = {}) => console.error(JSON.stringify({ level: 'error', ts: new Date().toISOString(), event, ...meta })),
};

const computeNextRun = (fromDate, frequency) => {
  const d = new Date(fromDate);
  if (frequency === 'daily')   d.setDate(d.getDate() + 1);
  if (frequency === 'weekly')  d.setDate(d.getDate() + 7);
  if (frequency === 'monthly') d.setMonth(d.getMonth() + 1);
  return d;
};

const runRecurringExpenses = async () => {
  const now = new Date();

  try {
    // Find all due recurring templates (excluding soft-deleted)
    const due = await Expense.find({
      isRecurring:       true,
      isRecurringActive: true,
      recurringParentId: null,               // templates only, not child instances
      recurringNextRun:  { $lte: now },
      isDeleted:         { $ne: true },
    });

    if (!due.length) return;

    let created = 0;
    for (const template of due) {
      try {
        // Spawn child expense (pending approval so owner reviews it)
        await Expense.create({
          property:          template.property,
          type:              template.type,
          customLabel:       template.customLabel,
          amount:            template.amount,
          date:              template.recurringNextRun,
          paymentMethod:     template.paymentMethod,
          notes:             template.notes,
          status:            'pending',          // needs approval
          isRecurring:       false,              // child is a one-off instance
          recurringParentId: template._id,
        });

        // Advance the template's nextRunDate
        template.recurringNextRun = computeNextRun(
          template.recurringNextRun,
          template.recurringFrequency
        );
        await template.save();
        created++;
      } catch (innerErr) {
        logger.error('cron.recurring_expense.spawn_failed', {
          templateId: template._id.toString(),
          error: innerErr.message,
        });
      }
    }

    if (created > 0) {
      logger.info('cron.recurring_expenses.processed', { created });
    }
  } catch (err) {
    logger.error('cron.recurring_expenses.failed', { error: err.message });
  }
};

/**
 * Start the recurring expense cron.
 * Schedule: daily at 00:05 IST (slight offset to avoid midnight contention)
 */
const startRecurringExpenseCron = () => {
  cron.schedule('5 0 * * *', runRecurringExpenses, {
    scheduled: true,
    timezone: 'Asia/Kolkata',
  });
  logger.info('cron.recurring_expenses.started', {
    schedule: '5 0 * * * (daily 00:05 IST)',
  });
};

module.exports = { startRecurringExpenseCron, runRecurringExpenses };
