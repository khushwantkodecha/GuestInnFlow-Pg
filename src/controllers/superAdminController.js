const jwt        = require('jsonwebtoken');
const mongoose   = require('mongoose');
const SuperAdmin = require('../models/SuperAdmin');
const User       = require('../models/User');
const Property   = require('../models/Property');
const Room       = require('../models/Room');
const Bed        = require('../models/Bed');
const Tenant     = require('../models/Tenant');
const Payment    = require('../models/Payment');
const PlanConfig = require('../models/PlanConfig');
const PLANS      = require('../config/plans');
const asyncHandler = require('../utils/asyncHandler');
const { sendAccountActivatedEmail } = require('../services/emailService');

const signToken = (id) =>
  jwt.sign({ id, role: 'superadmin' }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

// ── Auth ──────────────────────────────────────────────────────────────────────

// POST /api/superadmin/login
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }

  const admin = await SuperAdmin.findOne({ email }).select('+password');
  if (!admin || !(await admin.comparePassword(password))) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
  if (!admin.isActive) {
    return res.status(403).json({ success: false, message: 'Account is inactive' });
  }

  const token = signToken(admin._id);
  res.json({
    success: true,
    token,
    admin: { id: admin._id, name: admin.name, email: admin.email },
  });
});

// GET /api/superadmin/me
const getMe = asyncHandler(async (req, res) => {
  res.json({ success: true, data: req.superAdmin });
});

// ── Platform Stats ────────────────────────────────────────────────────────────

// GET /api/superadmin/stats
const getPlatformStats = asyncHandler(async (req, res) => {
  const now           = new Date();
  const startOfMonth  = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth    = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const [
    totalOwners,
    activeOwners,
    totalProperties,
    totalTenants,
    revenueResult,
    ownerGrowthRaw,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ isActive: true }),
    Property.countDocuments({ isActive: true }),
    Tenant.countDocuments({ status: { $in: ['active', 'notice'] } }),

    // Monthly revenue — actual payments received this month, no reversals/deposits
    Payment.aggregate([
      {
        $match: {
          paymentDate: { $gte: startOfMonth, $lte: endOfMonth },
          reversed:    { $ne: true },
          method:      { $ne: 'deposit_adjustment' },
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),

    // New owner signups per month for last 12 months
    User.aggregate([
      {
        $match: {
          createdAt: { $gte: new Date(now.getFullYear(), now.getMonth() - 11, 1) },
        },
      },
      {
        $group: {
          _id:   { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]),
  ]);

  // Total beds — count via rooms → beds to avoid scanning entire Bed collection per property
  const allRoomIds = await Room.find({ isActive: true }, '_id').lean().then(r => r.map(d => d._id));
  const totalBeds  = await Bed.countDocuments({ room: { $in: allRoomIds }, isActive: true });

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const ownerGrowth = ownerGrowthRaw.map(g => ({
    month: `${MONTHS[g._id.month - 1]} ${g._id.year}`,
    count: g.count,
  }));

  res.json({
    success: true,
    data: {
      totalOwners,
      activeOwners,
      totalProperties,
      totalBeds,
      totalTenants,
      monthlyRevenue: revenueResult[0]?.total ?? 0,
      ownerGrowth,
    },
  });
});

// ── Owners ────────────────────────────────────────────────────────────────────

// GET /api/superadmin/owners?search=&status=&sort=&page=&limit=
const getOwners = asyncHandler(async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 20);
  const search = req.query.search?.trim() || '';
  const status = req.query.status || 'all';   // 'all' | 'active' | 'inactive'
  const sort   = req.query.sort   || 'newest'; // 'newest' | 'oldest' | 'name_asc' | 'name_desc'

  const filter = {};

  if (search) {
    filter.$or = [
      { name:  { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }
  if (status === 'active')   filter.isActive = true;
  if (status === 'inactive') filter.isActive = false;

  const SORT_MAP = {
    newest:    { createdAt: -1 },
    oldest:    { createdAt:  1 },
    name_asc:  { name:  1 },
    name_desc: { name: -1 },
  };
  const sortQuery = SORT_MAP[sort] || SORT_MAP.newest;

  const total  = await User.countDocuments(filter);
  const users  = await User.find(filter)
    .sort(sortQuery)
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  if (users.length === 0) {
    return res.json({ success: true, owners: [], total, page, pages: Math.ceil(total / limit) });
  }

  // Aggregate property + tenant counts for this page of users only
  const userIds = users.map(u => u._id);

  const [propertyCounts, tenantCounts] = await Promise.all([
    Property.aggregate([
      { $match: { owner: { $in: userIds } } },
      { $group: { _id: '$owner', count: { $sum: 1 } } },
    ]),
    Tenant.aggregate([
      { $match: { property: { $exists: true } } },
      {
        $lookup: {
          from:         'properties',
          localField:   'property',
          foreignField: '_id',
          as:           'prop',
        },
      },
      { $unwind: '$prop' },
      { $match: { 'prop.owner': { $in: userIds } } },
      { $group: { _id: '$prop.owner', count: { $sum: 1 } } },
    ]),
  ]);

  const propMap   = Object.fromEntries(propertyCounts.map(p => [p._id.toString(), p.count]));
  const tenantMap = Object.fromEntries(tenantCounts.map(t => [t._id.toString(), t.count]));

  const owners = users.map(u => ({
    ...u,
    propertyCount: propMap[u._id.toString()]   ?? 0,
    tenantCount:   tenantMap[u._id.toString()]  ?? 0,
  }));

  res.json({ success: true, owners, total, page, pages: Math.ceil(total / limit) });
});

// GET /api/superadmin/owners/:id
const getOwner = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).lean();
  if (!user) return res.status(404).json({ success: false, message: 'Owner not found' });

  const ownerId = user._id;
  const now     = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  // Fetch all their properties with bed + tenant counts
  const properties = await Property.find({ owner: ownerId }).lean();
  const propertyIds = properties.map(p => p._id);

  if (propertyIds.length === 0) {
    return res.json({
      success: true,
      data: { ...user, properties: [], propertyCount: 0, bedCount: 0, tenantCount: 0, monthlyRevenue: 0 },
    });
  }

  const [roomIds, tenantCounts, bedCounts, revenueResult] = await Promise.all([
    Room.find({ property: { $in: propertyIds }, isActive: true }, '_id property').lean(),
    Tenant.aggregate([
      { $match: { property: { $in: propertyIds } } },
      { $group: { _id: '$property', count: { $sum: 1 } } },
    ]),
    Bed.aggregate([
      {
        $lookup: {
          from:         'rooms',
          localField:   'room',
          foreignField: '_id',
          as:           'roomDoc',
        },
      },
      { $unwind: '$roomDoc' },
      { $match: { 'roomDoc.property': { $in: propertyIds }, isActive: true } },
      { $group: { _id: '$roomDoc.property', count: { $sum: 1 } } },
    ]),
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
  ]);

  const tenantMap  = Object.fromEntries(tenantCounts.map(t => [t._id.toString(), t.count]));
  const bedMap     = Object.fromEntries(bedCounts.map(b => [b._id.toString(), b.count]));

  const enrichedProperties = properties.map(p => ({
    ...p,
    tenantCount: tenantMap[p._id.toString()] ?? 0,
    bedCount:    bedMap[p._id.toString()]    ?? 0,
  }));

  const totals = enrichedProperties.reduce(
    (acc, p) => ({ beds: acc.beds + p.bedCount, tenants: acc.tenants + p.tenantCount }),
    { beds: 0, tenants: 0 }
  );

  res.json({
    success: true,
    data: {
      ...user,
      properties:     enrichedProperties,
      propertyCount:  properties.length,
      bedCount:       totals.beds,
      tenantCount:    totals.tenants,
      monthlyRevenue: revenueResult[0]?.total ?? 0,
    },
  });
});

// PATCH /api/superadmin/owners/:id/status
const toggleOwnerStatus = asyncHandler(async (req, res) => {
  const { active } = req.body;
  if (typeof active !== 'boolean') {
    return res.status(400).json({ success: false, message: '`active` must be a boolean' });
  }

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { isActive: active },
    { new: true }
  );
  if (!user) return res.status(404).json({ success: false, message: 'Owner not found' });

  // Also deactivate / reactivate all their properties
  await Property.updateMany({ owner: user._id }, { isActive: active });

  // Notify user when their account is activated
  if (active) {
    sendAccountActivatedEmail({ name: user.name, email: user.email }).catch(() => {});
  }

  res.json({ success: true, data: user });
});

// DELETE /api/superadmin/owners/:id
const deleteOwner = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'Owner not found' });

  // Soft-delete: deactivate user + all their properties
  user.isActive = false;
  await user.save();
  await Property.updateMany({ owner: user._id }, { isActive: false });

  res.json({ success: true, message: 'Owner deactivated' });
});

// ── Properties ────────────────────────────────────────────────────────────────

// GET /api/superadmin/properties?search=&status=&type=&sort=&page=&limit=
const getAllProperties = asyncHandler(async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 20);
  const search = req.query.search?.trim() || '';
  const status = req.query.status || 'all';   // 'all' | 'active' | 'inactive'
  const type   = req.query.type   || 'all';   // 'all' | 'pg' | 'hostel'
  const sort   = req.query.sort   || 'newest'; // 'newest' | 'oldest' | 'name_asc' | 'name_desc'

  const SORT_MAP = {
    newest:    { createdAt: -1 },
    oldest:    { createdAt:  1 },
    name_asc:  { name:  1 },
    name_desc: { name: -1 },
  };
  const sortQuery = SORT_MAP[sort] || SORT_MAP.newest;

  // If searching, match property name OR owner name/email
  let ownerIds = [];
  if (search) {
    const matchingOwners = await User.find(
      { $or: [{ name: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } }] },
      '_id'
    ).lean();
    ownerIds = matchingOwners.map(o => o._id);
  }

  const filter = {};
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      ...(ownerIds.length ? [{ owner: { $in: ownerIds } }] : []),
    ];
  }
  if (status === 'active')   filter.isActive = true;
  if (status === 'inactive') filter.isActive = false;
  if (type !== 'all')        filter.type     = type;

  const total = await Property.countDocuments(filter);
  const props = await Property.find(filter)
    .sort(sortQuery)
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('owner', 'name email')
    .lean();

  if (props.length === 0) {
    return res.json({ success: true, properties: [], total, page, pages: Math.ceil(total / limit) });
  }

  const propertyIds = props.map(p => p._id);

  const [tenantCounts, bedCounts] = await Promise.all([
    Tenant.aggregate([
      { $match: { property: { $in: propertyIds } } },
      { $group: { _id: '$property', count: { $sum: 1 } } },
    ]),
    Bed.aggregate([
      {
        $lookup: {
          from:         'rooms',
          localField:   'room',
          foreignField: '_id',
          as:           'roomDoc',
        },
      },
      { $unwind: '$roomDoc' },
      { $match: { 'roomDoc.property': { $in: propertyIds }, isActive: true } },
      { $group: { _id: '$roomDoc.property', count: { $sum: 1 } } },
    ]),
  ]);

  const tenantMap = Object.fromEntries(tenantCounts.map(t => [t._id.toString(), t.count]));
  const bedMap    = Object.fromEntries(bedCounts.map(b => [b._id.toString(), b.count]));

  const properties = props.map(p => ({
    ...p,
    tenantCount: tenantMap[p._id.toString()] ?? 0,
    bedCount:    bedMap[p._id.toString()]    ?? 0,
  }));

  res.json({ success: true, properties, total, page, pages: Math.ceil(total / limit) });
});

// PATCH /api/superadmin/owners/:id/plan
const VALID_PLANS = ['standard', 'pro', 'elite', 'enterprise'];

const updateOwnerPlan = asyncHandler(async (req, res) => {
  const { plan } = req.body;
  if (!VALID_PLANS.includes(plan)) {
    return res.status(400).json({ success: false, message: 'Invalid plan. Must be one of: standard, pro, elite, enterprise' });
  }

  const user = await User.findByIdAndUpdate(req.params.id, { plan }, { new: true });
  if (!user) return res.status(404).json({ success: false, message: 'Owner not found' });

  res.json({ success: true, data: user });
});

// ── Plans ─────────────────────────────────────────────────────────────────────

const PLAN_ORDER = ['standard', 'pro', 'elite', 'enterprise'];

const seedPlans = async () => {
  const count = await PlanConfig.countDocuments();
  if (count > 0) return;
  await PlanConfig.insertMany(
    PLAN_ORDER.map(key => ({
      key,
      name:        PLANS[key].name,
      price:       PLANS[key].price,
      description: '',
    }))
  );
};

// GET /api/superadmin/plans
const getPlans = asyncHandler(async (req, res) => {
  await seedPlans();

  const [configs, ownerStats] = await Promise.all([
    PlanConfig.find().lean(),
    User.aggregate([{ $group: { _id: '$plan', count: { $sum: 1 } } }]),
  ]);

  const countMap = Object.fromEntries(ownerStats.map(o => [o._id, o.count]));
  const configMap = Object.fromEntries(configs.map(c => [c.key, c]));

  const plans = PLAN_ORDER.map(key => {
    const cfg   = configMap[key] ?? { key, name: PLANS[key].name, price: PLANS[key].price, description: '' };
    const count = countMap[key] ?? 0;
    const maxP  = PLANS[key].maxProperties;
    return {
      ...cfg,
      maxProperties:   maxP === Infinity ? -1 : maxP,
      ownerCount:      count,
      annualRevenue:   count * cfg.price,
    };
  });

  res.json({ success: true, plans });
});

// PATCH /api/superadmin/plans/:key
const updatePlan = asyncHandler(async (req, res) => {
  await seedPlans();

  if (!PLAN_ORDER.includes(req.params.key)) {
    return res.status(400).json({ success: false, message: 'Invalid plan key' });
  }

  const { name, price, description } = req.body;
  const update = {};
  if (name        !== undefined) update.name        = String(name).trim();
  if (price       !== undefined) update.price       = Math.max(0, Number(price));
  if (description !== undefined) update.description = String(description).trim();

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ success: false, message: 'Nothing to update' });
  }

  const plan = await PlanConfig.findOneAndUpdate(
    { key: req.params.key },
    update,
    { new: true, upsert: true }
  );

  res.json({ success: true, data: plan });
});

module.exports = {
  login,
  getMe,
  getPlatformStats,
  getOwners,
  getOwner,
  toggleOwnerStatus,
  deleteOwner,
  getAllProperties,
  updateOwnerPlan,
  getPlans,
  updatePlan,
};
