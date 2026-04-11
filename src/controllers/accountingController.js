/**
 * accountingController.js
 *
 * Combines RentPayments (revenue) + Expenses (costs) into a unified
 * accounting view — overview, cash flow, P&L, and monthly chart data.
 */

const Property    = require('../models/Property');
const RentPayment = require('../models/RentPayment');
const Expense     = require('../models/Expense');
const asyncHandler = require('../utils/asyncHandler');

const verifyOwnership = (propertyId, userId) =>
  Property.findOne({ _id: propertyId, owner: userId, isActive: true });

// ─── Shared date helpers ──────────────────────────────────────────────────────

const monthRange = (month, year) => ({
  start: new Date(year, month - 1, 1),
  end:   new Date(year, month, 0, 23, 59, 59),
});

// ─── GET /accounting/overview?month=&year= ────────────────────────────────────
//
// Returns: revenue, expenses, netProfit, cashBalance, collectionRate,
//          profitMargin, expenseBreakdown, recentTransactions
const getOverview = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const now   = new Date();
  const month = parseInt(req.query.month) || now.getMonth() + 1;
  const year  = parseInt(req.query.year)  || now.getFullYear();
  const { start, end } = monthRange(month, year);

  const [
    rentPayments,
    expenses,
    expenseSummary,
    allRentsThisMonth,
  ] = await Promise.all([
    // Paid rent this month
    RentPayment.find({
      property: req.params.propertyId,
      status:   'paid',
      paymentDate: { $gte: start, $lte: end },
    }).populate('tenant', 'name phone'),

    // All expenses this month
    Expense.find({
      property: req.params.propertyId,
      date: { $gte: start, $lte: end },
    }).sort({ date: -1 }),

    // Expense by category
    Expense.aggregate([
      { $match: { property: property._id, date: { $gte: start, $lte: end } } },
      { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),

    // All rent records this month (for collection rate)
    RentPayment.find({
      property: req.params.propertyId,
      month, year,
    }),
  ]);

  const revenue      = rentPayments.reduce((s, r) => s + r.paidAmount, 0);
  const totalExpense = expenses.reduce((s, e) => s + e.amount, 0);
  const netProfit    = revenue - totalExpense;

  const totalBilled    = allRentsThisMonth.reduce((s, r) => s + r.amount, 0);
  const totalCollected = allRentsThisMonth.reduce((s, r) => s + (r.status === 'paid' ? r.amount : r.paidAmount ?? 0), 0);
  const collectionRate = totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 100) : 0;
  const profitMargin   = revenue > 0 ? Math.round((netProfit / revenue) * 100) : 0;

  const pendingRent = allRentsThisMonth
    .filter(r => r.status === 'pending' || r.status === 'overdue')
    .reduce((s, r) => s + (r.amount - (r.paidAmount ?? 0)), 0);

  res.json({
    success: true,
    month, year,
    data: {
      revenue,
      totalExpense,
      netProfit,
      pendingRent,
      collectionRate,
      profitMargin,
      expenseBreakdown: expenseSummary,
      totalBilled,
    },
  });
});

// ─── GET /accounting/cashflow?month=&year= ────────────────────────────────────
//
// Returns combined inflow (rent) + outflow (expenses) sorted by date DESC
const getCashFlow = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const now   = new Date();
  const month = parseInt(req.query.month) || now.getMonth() + 1;
  const year  = parseInt(req.query.year)  || now.getFullYear();
  const { start, end } = monthRange(month, year);

  const [payments, expenses] = await Promise.all([
    RentPayment.find({
      property: req.params.propertyId,
      status: 'paid',
      paymentDate: { $gte: start, $lte: end },
    }).populate('tenant', 'name phone'),

    Expense.find({
      property: req.params.propertyId,
      date: { $gte: start, $lte: end },
    }),
  ]);

  const inflows = payments.map(r => ({
    _id:    r._id,
    type:   'inflow',
    label:  r.tenant?.name ?? 'Rent',
    sub:    r.paymentMethod ?? 'cash',
    amount: r.paidAmount,
    date:   r.paymentDate,
  }));

  const outflows = expenses.map(e => ({
    _id:    e._id,
    type:   'outflow',
    label:  e.type,
    sub:    e.notes || '',
    amount: e.amount,
    date:   e.date,
  }));

  const combined = [...inflows, ...outflows].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  );

  const totalIn  = inflows.reduce((s, i) => s + i.amount, 0);
  const totalOut = outflows.reduce((s, o) => s + o.amount, 0);

  res.json({
    success: true,
    data: combined,
    totalIn,
    totalOut,
    net: totalIn - totalOut,
  });
});

// ─── GET /accounting/chart?months=6 ──────────────────────────────────────────
//
// Returns last N months of revenue/expense/profit for chart rendering
const getChartData = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const n   = Math.min(parseInt(req.query.months) || 6, 12);
  const now = new Date();
  const months = [];

  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ month: d.getMonth() + 1, year: d.getFullYear() });
  }

  const results = await Promise.all(
    months.map(async ({ month, year }) => {
      const { start, end } = monthRange(month, year);

      const [revenue, expense] = await Promise.all([
        RentPayment.aggregate([
          {
            $match: {
              property: property._id,
              status: 'paid',
              paymentDate: { $gte: start, $lte: end },
            },
          },
          { $group: { _id: null, total: { $sum: '$paidAmount' } } },
        ]),
        Expense.aggregate([
          {
            $match: {
              property: property._id,
              date: { $gte: start, $lte: end },
            },
          },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
      ]);

      const rev = revenue[0]?.total ?? 0;
      const exp = expense[0]?.total ?? 0;

      return {
        month, year,
        label: new Date(year, month - 1).toLocaleString('default', { month: 'short' }),
        revenue: rev,
        expense: exp,
        profit:  rev - exp,
      };
    })
  );

  res.json({ success: true, data: results });
});

module.exports = { getOverview, getCashFlow, getChartData };
