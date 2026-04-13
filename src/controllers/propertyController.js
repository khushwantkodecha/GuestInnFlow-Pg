const Property          = require('../models/Property');
const Room              = require('../models/Room');
const Bed               = require('../models/Bed');
const Tenant            = require('../models/Tenant');
const RentPayment       = require('../models/RentPayment');
const Expense           = require('../models/Expense');
const PropertyAuditLog  = require('../models/PropertyAuditLog');
const asyncHandler      = require('../utils/asyncHandler');

// ── Audit helper ──────────────────────────────────────────────────────────────
// Computes a diff between two plain objects (only the top-level editable fields).
// Returns { fieldName: { before, after } } for every field that actually changed.
const diffObjects = (before, after) => {
  const FIELDS = ['name', 'type', 'description', 'amenities'];
  const ADDRESS_FIELDS = ['street', 'city', 'state', 'pincode'];
  const changes = {};

  for (const f of FIELDS) {
    const b = before[f] ?? null;
    const a = after[f]  ?? null;
    // Shallow compare (amenities array: stringify for equality)
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      changes[f] = { before: b, after: a };
    }
  }

  // Address sub-object — compare each sub-field individually
  for (const f of ADDRESS_FIELDS) {
    const b = before.address?.[f] ?? null;
    const a = after.address?.[f]  ?? null;
    if (b !== a) {
      changes[`address.${f}`] = { before: b, after: a };
    }
  }

  return changes;
};

// Fire-and-forget audit write — never blocks the HTTP response.
const writeAuditLog = (propertyId, userId, action, changes) => {
  if (!Object.keys(changes).length) return; // nothing changed, skip
  PropertyAuditLog.create({ property: propertyId, changedBy: userId, action, changes })
    .catch((err) => console.error('[AuditLog] Failed to write:', err.message));
};

// ── Shared aggregation helper ─────────────────────────────────────────────────
// Given an array of propertyIds, returns a map of propertyId → stats object.
// Used by both /stats/all and individual /stats endpoints.
const buildStatsForProperties = async (propertyIds) => {
  if (!propertyIds.length) return {};

  // Bridge: rooms per property (Bed has no property ref — needs roomIds)
  const allRooms = await Room.find(
    { property: { $in: propertyIds }, isActive: true },
    '_id property'
  ).lean();

  const roomIds   = allRooms.map((r) => r._id);
  const roomCount = {};
  for (const r of allRooms) {
    const pid = String(r.property);
    roomCount[pid] = (roomCount[pid] ?? 0) + 1;
  }

  // Run all aggregations in parallel
  const [bedsByStatus, tenantCounts, revenueAgg] = await Promise.all([
    // Bed counts grouped by property + status
    Bed.aggregate([
      { $match: { room: { $in: roomIds }, isActive: true } },
      { $lookup: { from: 'rooms', localField: 'room', foreignField: '_id', as: 'roomDoc' } },
      { $unwind: '$roomDoc' },
      {
        $group: {
          _id: { property: '$roomDoc.property', status: '$status' },
          count: { $sum: 1 },
        },
      },
    ]),
    // Active + notice tenant head-count per property
    Tenant.aggregate([
      { $match: { property: { $in: propertyIds }, status: { $in: ['active', 'notice'] } } },
      { $group: { _id: '$property', count: { $sum: 1 } } },
    ]),
    // Revenue = SUM(tenant.rentAmount) for active tenants only.
    // billingSnapshot.isExtra flags extra-bed tenants for the breakdown.
    // Fallback to billingSnapshot.finalRent if rentAmount is somehow missing.
    Tenant.aggregate([
      { $match: { property: { $in: propertyIds }, status: 'active' } },
      {
        $group: {
          _id: '$property',
          totalRevenue: {
            $sum: { $ifNull: ['$rentAmount', { $ifNull: ['$billingSnapshot.finalRent', 0] }] },
          },
          extraRevenue: {
            $sum: {
              $cond: [
                { $eq: ['$billingSnapshot.isExtra', true] },
                { $ifNull: ['$rentAmount', { $ifNull: ['$billingSnapshot.finalRent', 0] }] },
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  // Build per-property stat maps
  const bedMap     = {};
  const tenantMap  = {};
  const revenueMap = {};

  for (const p of propertyIds) {
    const pid = String(p);
    bedMap[pid]     = { vacant: 0, occupied: 0, reserved: 0, total: 0 };
    tenantMap[pid]  = 0;
    revenueMap[pid] = { totalRevenue: 0, extraRevenue: 0 };
  }

  for (const b of bedsByStatus) {
    const pid = String(b._id.property);
    if (bedMap[pid]) {
      bedMap[pid][b._id.status] = b.count;
      bedMap[pid].total += b.count;
    }
  }

  for (const t of tenantCounts) {
    const pid = String(t._id);
    if (tenantMap[pid] !== undefined) tenantMap[pid] = t.count;
  }

  for (const r of revenueAgg) {
    const pid = String(r._id);
    if (revenueMap[pid]) {
      revenueMap[pid].totalRevenue = r.totalRevenue ?? 0;
      revenueMap[pid].extraRevenue = r.extraRevenue ?? 0;
    }
  }

  const result = {};
  for (const p of propertyIds) {
    const pid  = String(p);
    const beds = bedMap[pid];
    const rev  = revenueMap[pid];
    result[pid] = {
      totalRooms:     roomCount[pid] ?? 0,
      totalBeds:      beds.total,
      occupiedBeds:   beds.occupied,
      vacantBeds:     beds.vacant,
      reservedBeds:   beds.reserved,
      activeTenants:  tenantMap[pid],
      // Revenue fields — always sourced from tenant.rentAmount, never from room.baseRent
      totalRevenue:   rev.totalRevenue,
      normalRevenue:  rev.totalRevenue - rev.extraRevenue,
      extraRevenue:   rev.extraRevenue,
      occupancyRate:  beds.total > 0 ? Math.round((beds.occupied / beds.total) * 100) : 0,
    };
  }

  return result;
};

// ── Controllers ───────────────────────────────────────────────────────────────

// GET /api/properties  — active only
const getProperties = asyncHandler(async (req, res) => {
  const properties = await Property.find({ owner: req.user._id, isActive: true });
  res.json({ success: true, count: properties.length, data: properties });
});

// GET /api/properties/all  — active + inactive
const getAllProperties = asyncHandler(async (req, res) => {
  const properties = await Property.find({ owner: req.user._id }).sort({ isActive: -1, createdAt: -1 });
  res.json({ success: true, count: properties.length, data: properties });
});

// GET /api/properties/stats/all
// Returns stats for ALL user properties in a single request.
// Frontend maps results by propertyId — eliminates N per-card API calls.
const getAllPropertyStats = asyncHandler(async (req, res) => {
  const properties = await Property.find({ owner: req.user._id }, '_id').lean();
  const propertyIds = properties.map((p) => p._id);
  const statsMap = await buildStatsForProperties(propertyIds);
  res.json({ success: true, data: statsMap });
});

// GET /api/properties/:id
const getProperty = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.id, owner: req.user._id });
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });
  res.json({ success: true, data: property });
});

// GET /api/properties/:id/stats  — single property stats
const getPropertyStats = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.id, owner: req.user._id });
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });

  const statsMap = await buildStatsForProperties([property._id]);
  res.json({ success: true, data: statsMap[String(property._id)] });
});

// GET /api/properties/:id/analytics
// Returns last 6 months of occupancy rate + collected rent for sparkline charts.
const getPropertyAnalytics = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.id, owner: req.user._id });
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });

  const now   = new Date();
  const months = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ month: d.getMonth() + 1, year: d.getFullYear() });
  }

  // Run all month queries in parallel
  const [rentResults, tenantResults] = await Promise.all([
    // Collected rent per month
    RentPayment.aggregate([
      {
        $match: {
          property: property._id,
          status: 'paid',
          month: { $in: months.map((m) => m.month) },
          year:  { $in: [...new Set(months.map((m) => m.year))] },
        },
      },
      { $group: { _id: { month: '$month', year: '$year' }, collected: { $sum: '$amount' } } },
    ]),
    // Active tenants snapshot per month (approximated from checkInDate/checkOutDate)
    Tenant.aggregate([
      { $match: { property: property._id } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
        },
      },
    ]),
  ]);

  // Also get current bed count for occupancy rate denominator
  const rooms   = await Room.find({ property: property._id, isActive: true }, '_id').lean();
  const roomIds = rooms.map((r) => r._id);
  const totalBeds = await Bed.countDocuments({ room: { $in: roomIds }, isActive: true });

  // Map rent results by month-year key
  const rentByKey = {};
  for (const r of rentResults) {
    rentByKey[`${r._id.year}-${r._id.month}`] = r.collected;
  }

  // Build monthly rent per month from RentPayments grouped by month+year
  const rentAll = await RentPayment.aggregate([
    {
      $match: {
        property: property._id,
        month: { $in: months.map((m) => m.month) },
        year:  { $in: [...new Set(months.map((m) => m.year))] },
      },
    },
    {
      $group: {
        _id: { month: '$month', year: '$year' },
        collected: { $sum: '$paidAmount' },
        expected:  { $sum: '$amount' },
        occupied:  {
          $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] },
        },
        total: { $sum: 1 },
      },
    },
  ]);

  const rentAllByKey = {};
  for (const r of rentAll) {
    rentAllByKey[`${r._id.year}-${r._id.month}`] = r;
  }

  const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const trend = months.map(({ month, year }) => {
    const key  = `${year}-${month}`;
    const data = rentAllByKey[key] ?? {};
    const collected = data.collected ?? 0;
    const expected  = data.expected  ?? 0;
    const occupancy = totalBeds > 0 && data.total
      ? Math.round((data.occupied / data.total) * 100)
      : 0;

    return {
      label:       `${MONTH_LABELS[month - 1]} ${year !== now.getFullYear() ? String(year).slice(2) : ''}`.trim(),
      month,
      year,
      collected,
      expected,
      occupancyRate: occupancy,
      collectionRate: expected > 0 ? Math.round((collected / expected) * 100) : 0,
    };
  });

  res.json({ success: true, data: { trend, totalBeds } });
});

// POST /api/properties
const createProperty = asyncHandler(async (req, res) => {
  const property = await Property.create({ ...req.body, owner: req.user._id });
  res.status(201).json({ success: true, data: property });
});

// PUT /api/properties/:id
const updateProperty = asyncHandler(async (req, res) => {
  // req.body is already validated + stripped by Zod middleware (unknown keys removed).
  // We still defensively whitelist here as a second layer.
  const { name, type, address, description, amenities } = req.body;
  const allowed = { name, type, address, description, amenities };
  Object.keys(allowed).forEach((k) => allowed[k] === undefined && delete allowed[k]);

  // Fetch the current state BEFORE update so we can diff and audit.
  const before = await Property.findOne({ _id: req.params.id, owner: req.user._id }).lean();
  if (!before) return res.status(404).json({ success: false, message: 'Property not found' });

  const property = await Property.findOneAndUpdate(
    { _id: req.params.id, owner: req.user._id },
    allowed,
    { new: true, runValidators: true }
  );

  // Async audit — fire-and-forget, never delays the response.
  const changes = diffObjects(before, property.toObject());
  writeAuditLog(property._id, req.user._id, 'update', changes);

  res.json({ success: true, data: property });
});

// DELETE /api/properties/:id  — soft deactivate
const deleteProperty = asyncHandler(async (req, res) => {
  const property = await Property.findOneAndUpdate(
    { _id: req.params.id, owner: req.user._id },
    { isActive: false },
    { new: true }
  );
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });
  res.json({ success: true, message: 'Property deactivated' });
});

// DELETE /api/properties/:id/permanent  — hard delete (irreversible)
// Cascades to rooms, beds (tenants/rent/expenses are kept for history).
const permanentDeleteProperty = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.id, owner: req.user._id });
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });

  // Safety gate 1: require explicit confirmation header
  if (req.headers['x-confirm-delete'] !== 'PERMANENT') {
    return res.status(400).json({
      success: false,
      message: 'Send header x-confirm-delete: PERMANENT to confirm hard delete',
    });
  }

  // Safety gate 2: property must already be deactivated (isActive: false).
  // Prevents accidental permanent deletion of a live property.
  if (property.isActive) {
    return res.status(409).json({
      success: false,
      message: 'Property must be deactivated before it can be permanently deleted',
    });
  }

  // Cascade delete rooms and beds
  const rooms   = await Room.find({ property: property._id }, '_id').lean();
  const roomIds = rooms.map((r) => r._id);
  await Bed.deleteMany({ room: { $in: roomIds } });
  await Room.deleteMany({ property: property._id });
  await Property.findByIdAndDelete(property._id);

  // Async audit — log the deletion with the property name for the record.
  writeAuditLog(
    property._id,
    req.user._id,
    'delete',
    { deleted: { before: property.name, after: null } }
  );

  res.json({ success: true, message: 'Property permanently deleted' });
});

// PATCH /api/properties/:id/reactivate
const reactivateProperty = asyncHandler(async (req, res) => {
  const property = await Property.findOneAndUpdate(
    { _id: req.params.id, owner: req.user._id },
    { isActive: true },
    { new: true }
  );
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });
  res.json({ success: true, message: 'Property reactivated', data: property });
});

module.exports = {
  getProperties,
  getAllProperties,
  getAllPropertyStats,
  getProperty,
  getPropertyStats,
  getPropertyAnalytics,
  createProperty,
  updateProperty,
  deleteProperty,
  permanentDeleteProperty,
  reactivateProperty,
};
