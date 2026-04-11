/**
 * rentService.js
 *
 * Pure business logic — no req/res. Can be called from:
 *   - HTTP controllers
 *   - Cron jobs  (future automation)
 *   - CLI scripts (future backfills)
 */

const RentPayment = require('../models/RentPayment');
const Tenant = require('../models/Tenant');

/**
 * Build the exact due-date for a given tenant, month, and year.
 * Tenant.dueDate is a day-of-month (1–28).
 */
const buildDueDate = (dueDayOfMonth, month, year) => {
  // month is 1-based (Jan = 1)
  return new Date(year, month - 1, dueDayOfMonth, 23, 59, 59);
};

/**
 * generateRentForProperty
 *
 * Creates one RentPayment record per active tenant in the property for the
 * given billing cycle. Skips tenants that already have a record for that cycle.
 *
 * Returns: { created: [...], skipped: [...] }
 */
const generateRentForProperty = async (propertyId, month, year) => {
  const activeTenants = await Tenant.find({
    property: propertyId,
    status: { $in: ['active', 'notice'] },
  }).lean();

  if (!activeTenants.length) {
    return { created: [], skipped: [] };
  }

  const created = [];
  const skipped = [];

  for (const tenant of activeTenants) {
    const existing = await RentPayment.findOne({ tenant: tenant._id, month, year });
    if (existing) {
      skipped.push({ tenantId: tenant._id, name: tenant.name, reason: 'Already generated' });
      continue;
    }

    const dueDate = buildDueDate(tenant.dueDate || 1, month, year);
    const status = dueDate < new Date() ? 'overdue' : 'pending';

    const record = await RentPayment.create({
      tenant: tenant._id,
      property: propertyId,
      amount: tenant.rentAmount,
      month,
      year,
      dueDate,
      status,
    });

    created.push(record);
  }

  return { created, skipped };
};

/**
 * syncOverdueRents
 *
 * Scans all pending RentPayments for a property whose dueDate has passed
 * and flips them to "overdue".
 *
 * Returns: number of records updated
 */
const syncOverdueRents = async (propertyId) => {
  const result = await RentPayment.updateMany(
    {
      property: propertyId,
      status: 'pending',
      dueDate: { $lt: new Date() },
    },
    { $set: { status: 'overdue' } }
  );
  return result.modifiedCount;
};

/**
 * getPendingRents
 *
 * Syncs overdue first, then returns all still-pending records.
 */
const getPendingRents = async (propertyId) => {
  await syncOverdueRents(propertyId);
  return RentPayment.find({ property: propertyId, status: 'pending' })
    .populate('tenant', 'name phone bed dueDate')
    .sort({ dueDate: 1 });
};

/**
 * getOverdueRents
 *
 * Syncs overdue first, then returns all overdue records.
 */
const getOverdueRents = async (propertyId) => {
  await syncOverdueRents(propertyId);
  return RentPayment.find({ property: propertyId, status: 'overdue' })
    .populate('tenant', 'name phone bed')
    .sort({ dueDate: 1 });
};

/**
 * markAsPaid
 *
 * Records a payment against a RentPayment record.
 * - paidAmount: amount being paid now (defaults to full remaining balance)
 * - If total paid >= amount due → status becomes 'paid'
 * - If partial → paidAmount is accumulated, status stays pending/overdue
 */
const markAsPaid = async (rentId, { paymentDate, paymentMethod, notes, paidAmount } = {}) => {
  const record = await RentPayment.findById(rentId);
  if (!record) return { record: null, error: 'Rent record not found' };
  if (record.status === 'paid') return { record: null, error: 'Rent is already marked as paid' };

  const remaining = record.amount - record.paidAmount;
  const paying = paidAmount != null ? Math.min(Number(paidAmount), remaining) : remaining;

  if (paying <= 0) return { record: null, error: 'Invalid payment amount' };

  record.paidAmount += paying;

  if (record.paidAmount >= record.amount) {
    record.status = 'paid';
    record.paymentDate = paymentDate ? new Date(paymentDate) : new Date();
  }

  if (paymentMethod) record.paymentMethod = paymentMethod;
  if (notes) record.notes = notes;
  await record.save();

  return { record, error: null };
};

module.exports = {
  generateRentForProperty,
  syncOverdueRents,
  getPendingRents,
  getOverdueRents,
  markAsPaid,
};
