const Property    = require('../models/Property');
const Room        = require('../models/Room');
const Bed         = require('../models/Bed');
const Tenant      = require('../models/Tenant');
const RentPayment = require('../models/RentPayment');
const Payment     = require('../models/Payment');
const Expense     = require('../models/Expense');
const asyncHandler = require('../utils/asyncHandler');

/**
 * computeStats(propertyIds)
 *
 * Core aggregation engine. Accepts an array of propertyIds and returns a
 * fully-shaped stats object. Called by both dashboard endpoints to avoid
 * duplication.
 *
 * Query strategy:
 *  - Sync overdue rents in one bulk updateMany (single DB op, not N per property)
 *  - Fetch roomIds in one query (needed because Bed has no property ref)
 *  - Fire all remaining stat queries in parallel via Promise.all
 */
const computeStats = async (propertyIds) => {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const startOfMonth = new Date(currentYear, currentMonth - 1, 1);
  const endOfMonth = new Date(currentYear, currentMonth, 0, 23, 59, 59);

  // Single bulk overdue sync across all target properties
  await RentPayment.updateMany(
    { property: { $in: propertyIds }, status: 'pending', dueDate: { $lt: now } },
    { $set: { status: 'overdue' } }
  );

  // Fetch active roomIds — required bridge for bed stats (Bed has no property field)
  const roomIds = await Room.find(
    { property: { $in: propertyIds }, isActive: true },
    '_id'
  ).lean().then((docs) => docs.map((d) => d._id));

  // All remaining queries run in parallel
  const [
    totalRooms,
    bedStats,
    tenantStats,
    newCheckIns,
    rentStats,
    expectedRentResult,
    expenseStats,
    depositStats,
    monthlyCollectedResult,
    pendingDuesResult,
  ] = await Promise.all([

    // 1. Total active rooms
    Room.countDocuments({ property: { $in: propertyIds }, isActive: true }),

    // 2. Bed counts grouped by status
    Bed.aggregate([
      { $match: { room: { $in: roomIds }, isActive: true } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),

    // 3. Tenant counts grouped by status
    Tenant.aggregate([
      { $match: { property: { $in: propertyIds } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),

    // 4. New check-ins in current calendar month (exclude incomplete — no bed yet)
    Tenant.countDocuments({
      property:    { $in: propertyIds },
      status:      { $in: ['active', 'notice'] },
      checkInDate: { $gte: startOfMonth, $lte: now },
    }),

    // 5. Rent payment amounts grouped by status for current month
    RentPayment.aggregate([
      { $match: { property: { $in: propertyIds }, month: currentMonth, year: currentYear } },
      {
        $group: {
          _id: '$status',
          totalAmount: { $sum: '$amount' },
          totalPaid:   { $sum: '$paidAmount' },
          count:       { $sum: 1 },
          dueCount:    { $sum: { $cond: [{ $gt: ['$balance', 0] }, 1, 0] } },
        },
      },
    ]),

    // 6. Expected monthly rent = sum of rentAmount across all active/notice tenants
    Tenant.aggregate([
      { $match: { property: { $in: propertyIds }, status: { $in: ['active', 'notice'] } } },
      { $group: { _id: null, total: { $sum: '$rentAmount' } } },
    ]),

    // 7. Expenses for current month grouped by type
    Expense.aggregate([
      { $match: { property: { $in: propertyIds }, date: { $gte: startOfMonth, $lte: endOfMonth } } },
      { $group: { _id: '$type', total: { $sum: '$amount' } } },
    ]),

    // 8. Deposit stats — total expected vs collected (exclude incomplete — no bed yet)
    Tenant.aggregate([
      { $match: { property: { $in: propertyIds }, status: { $ne: 'incomplete' } } },
      {
        $group: {
          _id: null,
          total:     { $sum: '$depositAmount' },
          collected: { $sum: { $cond: ['$depositPaid', '$depositAmount', 0] } },
        },
      },
    ]),

    // 9. Monthly collected — actual payments received this month, excluding deposits and reversals
    Payment.aggregate([
      {
        $match: {
          property:    { $in: propertyIds },
          paymentDate: { $gte: startOfMonth, $lte: endOfMonth },
          reversed:    { $ne: true },
          method:      { $ne: 'deposit_adjustment' },
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),

    // 10. Pending dues = sum of remaining balance across all non-paid rent records
    RentPayment.aggregate([
      {
        $match: {
          property: { $in: propertyIds },
          status:   { $in: ['pending', 'partial', 'overdue'] },
        },
      },
      {
        $group: {
          _id:  null,
          total: { $sum: '$balance' },
        },
      },
    ]),
  ]);

  // ── Shape results ──────────────────────────────────────────────────────────

  const bedMap = { vacant: 0, occupied: 0, reserved: 0, blocked: 0 };
  for (const b of bedStats) bedMap[b._id] = b.count;
  const totalBeds      = bedMap.vacant + bedMap.occupied + bedMap.reserved + bedMap.blocked;
  const occupiedBeds   = bedMap.occupied;
  const reservedBeds   = bedMap.reserved;
  const vacantBeds     = Math.max(totalBeds - occupiedBeds, 0);
  const extraOccupants = Math.max(occupiedBeds - totalBeds, 0);

  let bedStatus;
  if      (totalBeds === 0 && occupiedBeds === 0) bedStatus = 'no_capacity';
  else if (totalBeds === 0 && occupiedBeds  >  0) bedStatus = 'invalid_state';
  else if (occupiedBeds > totalBeds)              bedStatus = 'over_capacity';
  else if (occupiedBeds === totalBeds)            bedStatus = 'full';
  else                                            bedStatus = 'vacant';

  const tenantMap = { active: 0, vacated: 0, notice: 0 };
  for (const t of tenantStats) tenantMap[t._id] = t.count;

  const rentMap = {
    paid:    { totalAmount: 0, totalPaid: 0, count: 0, dueCount: 0 },
    pending: { totalAmount: 0, totalPaid: 0, count: 0, dueCount: 0 },
    overdue: { totalAmount: 0, totalPaid: 0, count: 0, dueCount: 0 },
  };
  for (const r of rentStats) rentMap[r._id] = { totalAmount: r.totalAmount, totalPaid: r.totalPaid, count: r.count, dueCount: r.dueCount ?? 0 };

  const expectedRent  = expectedRentResult[0]?.total ?? 0;
  // actual money received this month from Payment records (excludes deposits and reversals)
  const collectedRent = monthlyCollectedResult[0]?.total ?? 0;
  // pending = remaining balance on unpaid/partially-paid rent billing records
  const pendingRent = (rentMap.pending.totalAmount - (rentMap.pending.totalPaid ?? 0))
    + (rentMap.overdue.totalAmount - (rentMap.overdue.totalPaid ?? 0));
  const collectedDeposit = depositStats[0]?.collected ?? 0;
  const totalDeposit     = depositStats[0]?.total     ?? 0;

  const expenseTypes = ['electricity', 'water', 'food', 'maintenance', 'internet', 'salary', 'other'];
  const expenseBreakdown = Object.fromEntries(expenseTypes.map((t) => [t, 0]));
  for (const e of expenseStats) expenseBreakdown[e._id] = e.total;
  const totalExpenses = Object.values(expenseBreakdown).reduce((sum, v) => sum + v, 0);

  const pendingDues = pendingDuesResult[0]?.total ?? 0;
  const hasRentRecords = (rentMap.paid.count + rentMap.pending.count + rentMap.overdue.count) > 0;

  return {
    properties: {
      total: propertyIds.length,
    },
    rooms: {
      total: totalRooms,
    },
    beds: {
      total:         totalBeds,
      occupied:      occupiedBeds,
      reserved:      reservedBeds,
      vacant:        vacantBeds,
      extraOccupants,
      status:        bedStatus,
      occupancyRate: totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0,
    },
    tenants: {
      active: tenantMap.active,
      onNotice: tenantMap.notice,
      total: tenantMap.active + tenantMap.notice,
      newCheckInsThisMonth: newCheckIns,
    },
    financials: {
      month: currentMonth,
      year: currentYear,
      expectedRent,
      collectedRent,
      pendingRent,
      overdueRent: rentMap.overdue.totalAmount,
      totalExpenses,
      netIncome: collectedRent - totalExpenses,
      collectionRate: expectedRent > 0 ? Math.round((collectedRent / expectedRent) * 100) : 0,
      pendingDues,    // sum of balance across non-paid RentPayment records
      hasRentRecords, // true if any RentPayment records exist for this property this month
      breakdown: {
        paid:    { amount: rentMap.paid.totalAmount,                                                    count: rentMap.paid.count },
        pending: { amount: rentMap.pending.totalAmount - (rentMap.pending.totalPaid ?? 0),              count: rentMap.pending.dueCount },
        overdue: { amount: rentMap.overdue.totalAmount - (rentMap.overdue.totalPaid ?? 0),              count: rentMap.overdue.dueCount },
      },
    },
    expenses: {
      month: currentMonth,
      year: currentYear,
      total: totalExpenses,
      breakdown: expenseBreakdown,
    },
    deposits: {
      total: totalDeposit,
      collected: collectedDeposit,
    },
  };
};

// ── Controllers ───────────────────────────────────────────────────────────────

// GET /api/dashboard/property/:propertyId
// Returns stats for a single property
const getPropertyDashboard = asyncHandler(async (req, res) => {
  const property = await Property.findOne(
    { _id: req.params.propertyId, owner: req.user._id, isActive: true },
    '_id name address type'
  ).lean();

  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const stats = await computeStats([property._id]);
  res.json({
    success: true,
    data: {
      property: { id: property._id, name: property.name, address: property.address, type: property.type },
      ...stats,
    },
  });
});

// Zero-value stats returned when user has no properties yet
const emptyStats = (totalProperties = 0) => ({
  properties: { total: totalProperties },
  rooms:      { total: 0 },
  beds:       { total: 0, occupied: 0, reserved: 0, vacant: 0, extraOccupants: 0, status: 'no_capacity', occupancyRate: 0 },
  tenants:    { active: 0, onNotice: 0, total: 0, newCheckInsThisMonth: 0 },
  financials: {
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    expectedRent: 0, collectedRent: 0,
    pendingRent: 0, overdueRent: 0, totalExpenses: 0, netIncome: 0, collectionRate: 0,
    pendingDues: 0,
    hasRentRecords: false,
    breakdown: {
      paid:    { amount: 0, count: 0 },
      pending: { amount: 0, count: 0 },
      overdue: { amount: 0, count: 0 },
    },
  },
  expenses: {
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    total: 0,
    breakdown: {
      electricity: 0, water: 0, food: 0, maintenance: 0,
      internet: 0, salary: 0, other: 0,
    },
  },
  deposits: { total: 0, collected: 0 },
});

// GET /api/dashboard/property/:propertyId/recent-activity
// Returns last 5 non-reversed payments for the property
const Charge = require('../models/Charge');

const getRecentActivity = asyncHandler(async (req, res) => {
  const property = await Property.findOne(
    { _id: req.params.propertyId, owner: req.user._id, isActive: true },
    '_id'
  ).lean();
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });

  const [payments, charges] = await Promise.all([
    Payment.find({ property: property._id, reversed: false })
      .sort({ createdAt: -1 })
      .limit(8)
      .populate('tenant', 'name phone')
      .lean(),
    Charge.find({ property: property._id })
      .sort({ createdAt: -1 })
      .limit(8)
      .populate('tenant', 'name phone')
      .lean(),
  ]);

  // Merge, tag with type, sort by createdAt desc, return top 8
  const activity = [
    ...payments.map(p => ({ ...p, _type: 'payment' })),
    ...charges.map(c  => ({ ...c, _type: 'charge'  })),
  ]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 8);

  res.json({ success: true, data: activity });
});

module.exports = { getPropertyDashboard, getRecentActivity };
