const Expense    = require('../models/Expense');
const Property   = require('../models/Property');
const asyncHandler = require('../utils/asyncHandler');

const { EXPENSE_CATEGORIES } = require('../models/Expense');

const verifyOwnership = (propertyId, userId) =>
  Property.findOne({ _id: propertyId, owner: userId, isActive: true });

// ── Helper: compute nextRunDate ───────────────────────────────────────────────
const computeNextRun = (fromDate, frequency) => {
  const d = new Date(fromDate);
  if (frequency === 'daily')   d.setDate(d.getDate() + 1);
  if (frequency === 'weekly')  d.setDate(d.getDate() + 7);
  if (frequency === 'monthly') d.setMonth(d.getMonth() + 1);
  return d;
};

// ── POST /expenses ────────────────────────────────────────────────────────────
const addExpense = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const {
    type, customLabel, amount, date, paymentMethod, notes,
    isRecurring, recurringFrequency,
  } = req.body;

  const expenseDate = date ? new Date(date) : new Date();

  const expense = await Expense.create({
    property:    req.params.propertyId,
    type,
    customLabel: type === 'other' ? customLabel : null,
    amount:      Number(amount),
    date:        expenseDate,
    paymentMethod: paymentMethod || 'cash',
    notes:       notes || null,
    status:      'approved',   // manual adds are auto-approved
    isRecurring: !!isRecurring,
    recurringFrequency:  isRecurring ? recurringFrequency : null,
    recurringNextRun:    isRecurring ? computeNextRun(expenseDate, recurringFrequency) : null,
    isRecurringActive:   isRecurring ? true : undefined,
  });

  res.status(201).json({ success: true, data: expense });
});

// ── GET /expenses ─────────────────────────────────────────────────────────────
// Query: ?month= &year= &type= &status= &from= &to= &recurring=true
const getExpenses = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const now   = new Date();
  const month = parseInt(req.query.month) || now.getMonth() + 1;
  const year  = parseInt(req.query.year)  || now.getFullYear();

  // Date range: explicit from/to overrides month/year
  let startDate, endDate;
  if (req.query.from && req.query.to) {
    startDate = new Date(req.query.from);
    endDate   = new Date(req.query.to);
    endDate.setHours(23, 59, 59);
  } else {
    startDate = new Date(year, month - 1, 1);
    endDate   = new Date(year, month, 0, 23, 59, 59);
  }

  const filter = {
    property: req.params.propertyId,
    date: { $gte: startDate, $lte: endDate },
  };

  if (req.query.type)   filter.type   = req.query.type;
  if (req.query.status) filter.status = req.query.status;

  // Only show recurring templates (isRecurring: true, no parent)
  if (req.query.recurring === 'true') {
    filter.isRecurring = true;
    filter.recurringParentId = null;
    delete filter.date; // recurring templates aren't filtered by date
  }

  const [expenses, summary] = await Promise.all([
    Expense.find(filter).sort({ date: -1 }),
    Expense.aggregate([
      { $match: { ...filter } },
      { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
  ]);

  const grandTotal = summary.reduce((s, g) => s + g.total, 0);

  res.json({
    success: true,
    month, year,
    count: expenses.length,
    grandTotal,
    summary,
    data: expenses,
  });
});

// ── DELETE /expenses/:id ──────────────────────────────────────────────────────
const deleteExpense = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const expense = await Expense.findOneAndDelete({
    _id: req.params.id,
    property: req.params.propertyId,
  });
  if (!expense) {
    return res.status(404).json({ success: false, message: 'Expense not found' });
  }

  res.json({ success: true, message: 'Expense deleted' });
});

// ── PATCH /expenses/:id/approve ───────────────────────────────────────────────
const approveExpense = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const expense = await Expense.findOne({
    _id: req.params.id, property: req.params.propertyId,
  });
  if (!expense) {
    return res.status(404).json({ success: false, message: 'Expense not found' });
  }
  if (expense.status !== 'pending') {
    return res.status(400).json({ success: false, message: `Cannot approve an expense that is already ${expense.status}` });
  }

  expense.status     = 'approved';
  expense.approvedBy = req.user._id;
  expense.approvedAt = new Date();
  await expense.save();

  res.json({ success: true, message: 'Expense approved', data: expense });
});

// ── PATCH /expenses/:id/reject ────────────────────────────────────────────────
const rejectExpense = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const expense = await Expense.findOne({
    _id: req.params.id, property: req.params.propertyId,
  });
  if (!expense) {
    return res.status(404).json({ success: false, message: 'Expense not found' });
  }
  if (expense.status !== 'pending') {
    return res.status(400).json({ success: false, message: `Cannot reject an expense that is already ${expense.status}` });
  }

  expense.status          = 'rejected';
  expense.rejectionReason = req.body.reason || null;
  await expense.save();

  res.json({ success: true, message: 'Expense rejected', data: expense });
});

// ── PATCH /expenses/:id/toggle-recurring ─────────────────────────────────────
const toggleRecurring = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const expense = await Expense.findOne({
    _id: req.params.id,
    property: req.params.propertyId,
    isRecurring: true,
  });
  if (!expense) {
    return res.status(404).json({ success: false, message: 'Recurring expense not found' });
  }

  expense.isRecurringActive = !expense.isRecurringActive;
  await expense.save();

  res.json({
    success: true,
    message: `Recurring expense ${expense.isRecurringActive ? 'resumed' : 'paused'}`,
    data: expense,
  });
});

// ── GET /expenses/analytics?months=6 ─────────────────────────────────────────
const getAnalytics = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const n   = Math.min(parseInt(req.query.months) || 6, 12);
  const now = new Date();

  const start = new Date(now.getFullYear(), now.getMonth() - (n - 1), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const [monthly, categoryBreakdown] = await Promise.all([
    // Monthly totals
    Expense.aggregate([
      {
        $match: {
          property: property._id,
          status: 'approved',
          date: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id:   { month: { $month: '$date' }, year: { $year: '$date' } },
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),

    // Category breakdown for the whole range
    Expense.aggregate([
      {
        $match: {
          property: property._id,
          status: 'approved',
          date: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id:   '$type',
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    ]),
  ]);

  const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const monthlyFormatted = monthly.map(m => ({
    month: m._id.month,
    year:  m._id.year,
    label: MONTH_SHORT[m._id.month - 1],
    total: m.total,
    count: m.count,
  }));

  const grandTotal = categoryBreakdown.reduce((s, c) => s + c.total, 0);

  res.json({
    success: true,
    data: {
      monthly: monthlyFormatted,
      categoryBreakdown,
      grandTotal,
    },
  });
});

module.exports = {
  addExpense,
  getExpenses,
  deleteExpense,
  approveExpense,
  rejectExpense,
  toggleRecurring,
  getAnalytics,
};
