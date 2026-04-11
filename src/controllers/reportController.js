const Property = require('../models/Property');
const RentPayment = require('../models/RentPayment');
const Expense = require('../models/Expense');
const Tenant = require('../models/Tenant');
const asyncHandler = require('../utils/asyncHandler');

// ── Shared helpers ────────────────────────────────────────────────────────────

/**
 * Resolve which propertyIds to scope the report to.
 * - If ?propertyId is given, verify ownership and return [id].
 * - Otherwise return all active property IDs for the user.
 * Returns null if the specified property is not found / not owned.
 */
const resolvePropertyIds = async (userId, propertyId) => {
  if (propertyId) {
    const property = await Property.findOne(
      { _id: propertyId, owner: userId, isActive: true },
      '_id name'
    ).lean();
    if (!property) return null;
    return { ids: [property._id], properties: [property] };
  }

  const properties = await Property.find(
    { owner: userId, isActive: true },
    '_id name'
  ).lean();
  return { ids: properties.map((p) => p._id), properties };
};

/**
 * Parse ?from and ?to query params into Date objects.
 * Defaults to the first and last day of the current month.
 */
const parseDateRange = (from, to) => {
  const now = new Date();
  const start = from
    ? new Date(from)
    : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = to
    ? new Date(new Date(to).setHours(23, 59, 59, 999))
    : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  if (isNaN(start) || isNaN(end)) return null;
  if (start > end) return null;
  return { start, end };
};

// ── Report 1: Monthly Income ──────────────────────────────────────────────────

// GET /api/reports/income
// Query: ?propertyId=  &from=YYYY-MM-DD  &to=YYYY-MM-DD
const getIncomeReport = asyncHandler(async (req, res) => {
  const resolved = await resolvePropertyIds(req.user._id, req.query.propertyId);
  if (!resolved) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const range = parseDateRange(req.query.from, req.query.to);
  if (!range) {
    return res.status(400).json({ success: false, message: 'Invalid date range' });
  }

  // Sync overdue before reporting
  await RentPayment.updateMany(
    { property: { $in: resolved.ids }, status: 'pending', dueDate: { $lt: new Date() } },
    { $set: { status: 'overdue' } }
  );

  // Group rent payments by month+year, then by status
  const monthlyBreakdown = await RentPayment.aggregate([
    {
      $match: {
        property: { $in: resolved.ids },
        dueDate: { $gte: range.start, $lte: range.end },
      },
    },
    {
      $group: {
        _id: { month: '$month', year: '$year', status: '$status' },
        totalAmount: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.year': 1, '_id.month': 1 } },
  ]);

  // Reshape into { "2026-04": { paid, pending, overdue, total } }
  const monthMap = {};
  for (const row of monthlyBreakdown) {
    const key = `${row._id.year}-${String(row._id.month).padStart(2, '0')}`;
    if (!monthMap[key]) {
      monthMap[key] = { month: row._id.month, year: row._id.year, paid: 0, pending: 0, overdue: 0, totalBilled: 0, collectionRate: 0 };
    }
    monthMap[key][row._id.status] = row.totalAmount;
    monthMap[key].totalBilled += row.totalAmount;
  }

  // Compute collection rate per month
  const months = Object.values(monthMap).map((m) => ({
    ...m,
    collectionRate: m.totalBilled > 0 ? Math.round((m.paid / m.totalBilled) * 100) : 0,
  }));

  // Period totals
  const totals = months.reduce(
    (acc, m) => {
      acc.totalBilled += m.totalBilled;
      acc.paid += m.paid;
      acc.pending += m.pending;
      acc.overdue += m.overdue;
      return acc;
    },
    { totalBilled: 0, paid: 0, pending: 0, overdue: 0 }
  );
  totals.collectionRate =
    totals.totalBilled > 0 ? Math.round((totals.paid / totals.totalBilled) * 100) : 0;

  res.json({
    success: true,
    report: 'income',
    filters: { properties: resolved.properties, from: range.start, to: range.end },
    totals,
    data: months,
  });
});

// ── Report 2: Pending Rent ────────────────────────────────────────────────────

// GET /api/reports/pending-rent
// Query: ?propertyId=  &from=YYYY-MM-DD  &to=YYYY-MM-DD  &status=pending|overdue
const getPendingRentReport = asyncHandler(async (req, res) => {
  const resolved = await resolvePropertyIds(req.user._id, req.query.propertyId);
  if (!resolved) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const range = parseDateRange(req.query.from, req.query.to);
  if (!range) {
    return res.status(400).json({ success: false, message: 'Invalid date range' });
  }

  // Sync overdue before reporting
  await RentPayment.updateMany(
    { property: { $in: resolved.ids }, status: 'pending', dueDate: { $lt: new Date() } },
    { $set: { status: 'overdue' } }
  );

  const statusFilter = req.query.status && ['pending', 'overdue'].includes(req.query.status)
    ? [req.query.status]
    : ['pending', 'overdue'];

  const records = await RentPayment.find({
    property: { $in: resolved.ids },
    status: { $in: statusFilter },
    dueDate: { $gte: range.start, $lte: range.end },
  })
    .populate('tenant', 'name phone bed')
    .populate('property', 'name')
    .sort({ dueDate: 1 });

  // Summary by status
  const summary = records.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + r.amount;
      acc.total += r.amount;
      return acc;
    },
    { pending: 0, overdue: 0, total: 0 }
  );

  res.json({
    success: true,
    report: 'pending-rent',
    filters: { properties: resolved.properties, from: range.start, to: range.end, status: statusFilter },
    summary,
    count: records.length,
    data: records,
  });
});

// ── Report 3: Expense ─────────────────────────────────────────────────────────

// GET /api/reports/expenses
// Query: ?propertyId=  &from=YYYY-MM-DD  &to=YYYY-MM-DD  &type=electricity|...
const getExpenseReport = asyncHandler(async (req, res) => {
  const resolved = await resolvePropertyIds(req.user._id, req.query.propertyId);
  if (!resolved) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const range = parseDateRange(req.query.from, req.query.to);
  if (!range) {
    return res.status(400).json({ success: false, message: 'Invalid date range' });
  }

  const match = {
    property: { $in: resolved.ids },
    date: { $gte: range.start, $lte: range.end },
  };
  if (req.query.type) match.type = req.query.type;

  const [records, byType, byMonth] = await Promise.all([
    // Full record list
    Expense.find(match)
      .populate('property', 'name')
      .sort({ date: -1 }),

    // Grouped by expense type
    Expense.aggregate([
      { $match: match },
      { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),

    // Grouped by month
    Expense.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            year: { $year: '$date' },
            month: { $month: '$date' },
          },
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),
  ]);

  const grandTotal = byType.reduce((sum, t) => sum + t.total, 0);

  // Shape monthly breakdown
  const monthly = byMonth.map((m) => ({
    month: m._id.month,
    year: m._id.year,
    period: `${m._id.year}-${String(m._id.month).padStart(2, '0')}`,
    total: m.total,
    count: m.count,
  }));

  res.json({
    success: true,
    report: 'expenses',
    filters: { properties: resolved.properties, from: range.start, to: range.end, type: req.query.type || 'all' },
    grandTotal,
    byType,
    byMonth: monthly,
    count: records.length,
    data: records,
  });
});

module.exports = { getIncomeReport, getPendingRentReport, getExpenseReport };
