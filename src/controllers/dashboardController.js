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
    overCapacityResult,
    totalRevenueResult,
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

    // 4. New check-ins in current calendar month
    Tenant.countDocuments({
      property: { $in: propertyIds },
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
          count: { $sum: 1 },
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

    // 8. Deposit stats — total expected vs collected
    Tenant.aggregate([
      { $match: { property: { $in: propertyIds } } },
      {
        $group: {
          _id: null,
          total:     { $sum: '$depositAmount' },
          collected: { $sum: { $cond: ['$depositPaid', '$depositAmount', 0] } },
        },
      },
    ]),

    // 10. Total revenue = sum of all recorded payments (all time)
    Payment.aggregate([
      { $match: { property: { $in: propertyIds } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),

    // 11. Pending dues = sum of remaining balance across all non-paid rent records
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

    // 9. Over-capacity rooms — rooms where total active beds > stated capacity
    Room.aggregate([
      { $match: { property: { $in: propertyIds }, isActive: true } },
      {
        $lookup: {
          from: 'beds',
          let: { roomId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$room', '$$roomId'] },
                    { $eq: ['$isActive', true] },
                  ],
                },
              },
            },
            { $count: 'n' },
          ],
          as: 'bedCounts',
        },
      },
      {
        $project: {
          capacity: 1,
          totalBeds: { $ifNull: [{ $arrayElemAt: ['$bedCounts.n', 0] }, 0] },
        },
      },
      { $match: { $expr: { $gt: ['$totalBeds', '$capacity'] } } },
    ]),
  ]);

  // ── Shape results ──────────────────────────────────────────────────────────

  const bedMap = { vacant: 0, occupied: 0, reserved: 0 };
  for (const b of bedStats) bedMap[b._id] = b.count;
  const totalBeds = bedMap.vacant + bedMap.occupied + bedMap.reserved;

  const tenantMap = { active: 0, vacated: 0, notice: 0 };
  for (const t of tenantStats) tenantMap[t._id] = t.count;

  const rentMap = {
    paid:    { totalAmount: 0, totalPaid: 0, count: 0 },
    pending: { totalAmount: 0, totalPaid: 0, count: 0 },
    overdue: { totalAmount: 0, totalPaid: 0, count: 0 },
  };
  for (const r of rentStats) rentMap[r._id] = { totalAmount: r.totalAmount, totalPaid: r.totalPaid, count: r.count };

  const expectedRent = expectedRentResult[0]?.total ?? 0;
  // collected = fully paid records + partial payments on pending/overdue records
  const collectedRent = rentMap.paid.totalAmount
    + (rentMap.pending.totalPaid ?? 0)
    + (rentMap.overdue.totalPaid ?? 0);
  // pending = remaining balance on unpaid/partially-paid records
  const pendingRent = (rentMap.pending.totalAmount - (rentMap.pending.totalPaid ?? 0))
    + (rentMap.overdue.totalAmount - (rentMap.overdue.totalPaid ?? 0));
  const collectedDeposit = depositStats[0]?.collected ?? 0;
  const totalDeposit = depositStats[0]?.total ?? 0;

  const expenseTypes = ['electricity', 'water', 'food', 'maintenance', 'internet', 'salary', 'other'];
  const expenseBreakdown = Object.fromEntries(expenseTypes.map((t) => [t, 0]));
  for (const e of expenseStats) expenseBreakdown[e._id] = e.total;
  const totalExpenses = Object.values(expenseBreakdown).reduce((sum, v) => sum + v, 0);

  const overCapacityRooms = overCapacityResult.length;
  const overCapacityBeds  = overCapacityResult.reduce((sum, r) => sum + (r.totalBeds - r.capacity), 0);
  const totalRevenue      = totalRevenueResult[0]?.total ?? 0;
  const pendingDues       = pendingDuesResult[0]?.total   ?? 0;

  return {
    properties: {
      total: propertyIds.length,
    },
    rooms: {
      total: totalRooms,
      overCapacity: overCapacityRooms,
      overCapacityBeds,
    },
    beds: {
      total: totalBeds,
      occupied: bedMap.occupied,
      vacant: bedMap.vacant,
      reserved: bedMap.reserved,
      occupancyRate: totalBeds > 0 ? Math.round((bedMap.occupied / totalBeds) * 100) : 0,
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
      collectedDeposit,
      totalCollected: collectedRent + collectedDeposit,
      pendingRent,
      overdueRent: rentMap.overdue.totalAmount,
      totalExpenses,
      netIncome: collectedRent + collectedDeposit - totalExpenses,
      collectionRate: expectedRent > 0 ? Math.round((collectedRent / expectedRent) * 100) : 0,
      // Financial layer metrics
      totalRevenue,   // sum of all Payment records (all time)
      pendingDues,    // sum of balance across non-paid RentPayment records
      breakdown: {
        paid:    { amount: rentMap.paid.totalAmount,                                                    count: rentMap.paid.count },
        pending: { amount: rentMap.pending.totalAmount - (rentMap.pending.totalPaid ?? 0),              count: rentMap.pending.count },
        overdue: { amount: rentMap.overdue.totalAmount - (rentMap.overdue.totalPaid ?? 0),              count: rentMap.overdue.count },
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

// GET /api/dashboard
// Returns stats across ALL properties owned by the logged-in user
const getOwnerDashboard = asyncHandler(async (req, res) => {
  const properties = await Property.find(
    { owner: req.user._id, isActive: true },
    '_id'
  ).lean();

  const propertyIds = properties.map((p) => p._id);

  if (!propertyIds.length) {
    return res.json({ success: true, data: emptyStats(0) });
  }

  const stats = await computeStats(propertyIds);
  res.json({ success: true, data: stats });
});

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
  rooms:      { total: 0, overCapacity: 0, overCapacityBeds: 0 },
  beds:       { total: 0, occupied: 0, vacant: 0, reserved: 0, occupancyRate: 0 },
  tenants:    { active: 0, onNotice: 0, total: 0, newCheckInsThisMonth: 0 },
  financials: {
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    expectedRent: 0, collectedRent: 0, collectedDeposit: 0, totalCollected: 0,
    pendingRent: 0, overdueRent: 0, totalExpenses: 0, netIncome: 0, collectionRate: 0,
    totalRevenue: 0, pendingDues: 0,
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

module.exports = { getOwnerDashboard, getPropertyDashboard };
