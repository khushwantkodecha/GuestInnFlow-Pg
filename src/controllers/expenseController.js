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
    isRecurring, recurringFrequency, attachmentUrl,
  } = req.body;

  const expenseDate = date ? new Date(date) : new Date();

  const expense = await Expense.create({
    property:    req.params.propertyId,
    type,
    customLabel: type === 'other' ? (customLabel || null) : null,
    amount:      Number(amount),
    date:        expenseDate,
    paymentMethod: paymentMethod || 'cash',
    notes:       notes || null,
    status:      'approved',   // manual adds are auto-approved
    isRecurring: !!isRecurring,
    recurringFrequency:  isRecurring ? recurringFrequency : null,
    recurringNextRun:    isRecurring ? computeNextRun(expenseDate, recurringFrequency) : null,
    isRecurringActive:   isRecurring ? true : undefined,
    attachmentUrl:       attachmentUrl || null,
  });

  res.status(201).json({ success: true, data: expense });
});

// ── GET /expenses ─────────────────────────────────────────────────────────────
// Query: ?month= &year= &type= &status= &from= &to= &recurring=true &page= &limit=
const getExpenses = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const now   = new Date();
  const month = parseInt(req.query.month) || now.getMonth() + 1;
  const year  = parseInt(req.query.year)  || now.getFullYear();

  // Pagination — default 50 per page, max 200
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
  const skip  = (page - 1) * limit;

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
    property:  req.params.propertyId,
    isDeleted: { $ne: true },
    date:      { $gte: startDate, $lte: endDate },
  };

  if (req.query.type)   filter.type   = req.query.type;
  if (req.query.status) filter.status = req.query.status;

  // Only show recurring templates (isRecurring: true, no parent)
  if (req.query.recurring === 'true') {
    filter.isRecurring       = true;
    filter.recurringParentId = null;
    delete filter.date; // recurring templates aren't filtered by date
  }

  const [expenses, total, summary] = await Promise.all([
    Expense.find(filter).sort({ date: -1 }).skip(skip).limit(limit),
    Expense.countDocuments(filter),
    Expense.aggregate([
      { $match: { ...filter } },
      { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
  ]);

  const grandTotal = summary.reduce((s, g) => s + g.total, 0);
  const totalPages = Math.ceil(total / limit);

  res.json({
    success: true,
    month, year,
    count:      expenses.length,
    total,
    page,
    limit,
    totalPages,
    hasMore:    page < totalPages,
    grandTotal,
    summary,
    data: expenses,
  });
});

// ── PATCH /expenses/:id ───────────────────────────────────────────────────────
// Editable fields: amount, date, notes, paymentMethod, attachmentUrl
// type and category fields are intentionally not editable after creation.
const editExpense = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const expense = await Expense.findOne({
    _id:       req.params.id,
    property:  req.params.propertyId,
    isDeleted: { $ne: true },
  });
  if (!expense) {
    return res.status(404).json({ success: false, message: 'Expense not found' });
  }

  const { amount, date, notes, paymentMethod, attachmentUrl } = req.body;

  if (amount !== undefined) {
    const amt = Number(amount);
    if (isNaN(amt) || amt < 1) {
      return res.status(400).json({ success: false, message: 'amount must be at least 1', code: 'INVALID_AMOUNT' });
    }
    expense.amount = amt;
  }

  if (date !== undefined) {
    const d = new Date(date);
    if (isNaN(d.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date', code: 'INVALID_DATE' });
    }
    expense.date = d;
    // If this is a recurring template, re-anchor nextRun from the new date
    if (expense.isRecurring && expense.recurringParentId == null) {
      expense.recurringNextRun = computeNextRun(d, expense.recurringFrequency);
    }
  }

  if (notes !== undefined)         expense.notes         = notes || null;
  if (paymentMethod !== undefined) expense.paymentMethod = paymentMethod;
  if (attachmentUrl !== undefined) expense.attachmentUrl = attachmentUrl || null;

  await expense.save();

  res.json({ success: true, data: expense });
});

// ── DELETE /expenses/:id ──────────────────────────────────────────────────────
// Soft-deletes by setting isDeleted:true and recording deletedAt.
// The record is retained for audit; it will not appear in any list or aggregate.
const deleteExpense = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const expense = await Expense.findOne({
    _id:       req.params.id,
    property:  req.params.propertyId,
    isDeleted: { $ne: true },
  });
  if (!expense) {
    return res.status(404).json({ success: false, message: 'Expense not found' });
  }

  expense.isDeleted = true;
  expense.deletedAt = new Date();
  await expense.save();

  res.json({ success: true, message: 'Expense deleted' });
});

// ── PATCH /expenses/:id/approve ───────────────────────────────────────────────
const approveExpense = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const expense = await Expense.findOne({
    _id: req.params.id, property: req.params.propertyId, isDeleted: { $ne: true },
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
    _id: req.params.id, property: req.params.propertyId, isDeleted: { $ne: true },
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
    _id:         req.params.id,
    property:    req.params.propertyId,
    isRecurring: true,
    isDeleted:   { $ne: true },
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

// ── POST /expenses/:id/generate-missed ───────────────────────────────────────
// Manually spawns child expense records for every period the cron missed
// (e.g. server was down, template was paused, or entries were accidentally
// deleted). Caps at 60 entries per call to prevent runaway generation.
//
// Only works on active recurring templates whose recurringNextRun is in the past.
// Each generated child starts as 'pending' so the owner can review before
// it counts toward totals.
const generateMissed = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const template = await Expense.findOne({
    _id:               req.params.id,
    property:          req.params.propertyId,
    isRecurring:       true,
    recurringParentId: null,
    isDeleted:         { $ne: true },
  });
  if (!template) {
    return res.status(404).json({ success: false, message: 'Recurring template not found' });
  }

  if (!template.isRecurringActive) {
    return res.status(400).json({
      success: false,
      message: 'Template is paused — resume it before generating missed entries',
      code:    'TEMPLATE_PAUSED',
    });
  }

  const now = new Date();
  if (template.recurringNextRun > now) {
    return res.json({
      success: true,
      message: 'No missed entries — next run is in the future',
      created: 0,
      data:    [],
    });
  }

  const created = [];
  let nextRun   = new Date(template.recurringNextRun);
  let guard     = 0;

  while (nextRun <= now && guard < 60) {
    const child = await Expense.create({
      property:          template.property,
      type:              template.type,
      customLabel:       template.customLabel,
      amount:            template.amount,
      date:              new Date(nextRun),
      paymentMethod:     template.paymentMethod,
      notes:             template.notes,
      attachmentUrl:     null,
      status:            'pending',   // owner must review before it counts
      isRecurring:       false,
      recurringParentId: template._id,
    });
    created.push(child);
    nextRun = computeNextRun(nextRun, template.recurringFrequency);
    guard++;
  }

  // Advance template's nextRun to the next future date
  template.recurringNextRun = nextRun;
  await template.save();

  res.status(201).json({
    success: true,
    message: `${created.length} missed ${created.length === 1 ? 'entry' : 'entries'} generated`,
    created: created.length,
    data:    created,
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

  const baseMatch = {
    property:  property._id,
    status:    'approved',
    isDeleted: { $ne: true },
    date:      { $gte: start, $lte: end },
  };

  const [monthly, categoryBreakdown] = await Promise.all([
    // Monthly totals
    Expense.aggregate([
      { $match: baseMatch },
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
      { $match: baseMatch },
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
  editExpense,
  deleteExpense,
  approveExpense,
  rejectExpense,
  toggleRecurring,
  generateMissed,
  getAnalytics,
};
