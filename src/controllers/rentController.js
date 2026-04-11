const Property = require('../models/Property');
const RentPayment = require('../models/RentPayment');
const rentService = require('../services/rentService');
const asyncHandler = require('../utils/asyncHandler');

// Verify property belongs to the logged-in user
const verifyOwnership = async (propertyId, userId) => {
  return Property.findOne({ _id: propertyId, owner: userId, isActive: true });
};

// ─── Generate ────────────────────────────────────────────────────────────────

// POST /api/properties/:propertyId/rents/generate
// Body: { month, year }  (defaults to current month/year if omitted)
const generateMonthlyRent = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const now = new Date();
  const month = parseInt(req.body.month) || now.getMonth() + 1;
  const year = parseInt(req.body.year) || now.getFullYear();

  if (month < 1 || month > 12) {
    return res.status(400).json({ success: false, message: 'month must be between 1 and 12' });
  }
  if (year < 2000 || year > 2100) {
    return res.status(400).json({ success: false, message: 'Invalid year' });
  }

  const { created, skipped } = await rentService.generateRentForProperty(
    req.params.propertyId,
    month,
    year
  );

  res.status(201).json({
    success: true,
    message: `Rent generated for ${month}/${year}`,
    data: { created: created.length, skipped: skipped.length, records: created, skipped },
  });
});

// ─── Read ─────────────────────────────────────────────────────────────────────

// GET /api/properties/:propertyId/rents
// Query: ?status=pending|paid|overdue  &month=  &year=  &tenantId=
const getAllRents = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  // Sync overdue before returning any listing
  await rentService.syncOverdueRents(req.params.propertyId);

  const filter = { property: req.params.propertyId };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.month) filter.month = parseInt(req.query.month);
  if (req.query.year) filter.year = parseInt(req.query.year);
  if (req.query.tenantId) filter.tenant = req.query.tenantId;

  const rents = await RentPayment.find(filter)
    .populate({
      path: 'tenant',
      select: 'name phone rentAmount dueDate',
      populate: { path: 'bed', select: 'bedNumber room', populate: { path: 'room', select: 'roomNumber floor' } },
    })
    .sort({ dueDate: 1 });

  res.json({ success: true, count: rents.length, data: rents });
});

// GET /api/properties/:propertyId/rents/pending
const getPendingRents = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const rents = await rentService.getPendingRents(req.params.propertyId);
  res.json({ success: true, count: rents.length, data: rents });
});

// GET /api/properties/:propertyId/rents/overdue
const getOverdueRents = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const rents = await rentService.getOverdueRents(req.params.propertyId);
  res.json({ success: true, count: rents.length, data: rents });
});

// GET /api/properties/:propertyId/tenants/:tenantId/rents
const getTenantRentHistory = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  await rentService.syncOverdueRents(req.params.propertyId);

  const rents = await RentPayment.find({
    property: req.params.propertyId,
    tenant: req.params.tenantId,
  }).sort({ year: -1, month: -1 });

  res.json({ success: true, count: rents.length, data: rents });
});

// ─── Pay ──────────────────────────────────────────────────────────────────────

// PATCH /api/properties/:propertyId/rents/:id/pay
// Body: { paymentDate?, paymentMethod?, notes? }
const markRentAsPaid = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  // Confirm this rent belongs to this property
  const existing = await RentPayment.findOne({
    _id: req.params.id,
    property: req.params.propertyId,
  });
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Rent record not found' });
  }

  const { record, error } = await rentService.markAsPaid(req.params.id, req.body);
  if (error) {
    return res.status(400).json({ success: false, message: error });
  }

  res.json({ success: true, message: 'Rent marked as paid', data: record });
});

module.exports = {
  generateMonthlyRent,
  getAllRents,
  getPendingRents,
  getOverdueRents,
  getTenantRentHistory,
  markRentAsPaid,
};
