const Tenant = require('../models/Tenant');
const Bed = require('../models/Bed');
const Property = require('../models/Property');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/properties/:propertyId/tenants
const getTenants = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.propertyId, owner: req.user._id });
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const { status } = req.query;
  const filter = { property: req.params.propertyId };
  if (status) filter.status = status;

  const tenants = await Tenant.find(filter).populate('bed', 'bedNumber room');
  res.json({ success: true, count: tenants.length, data: tenants });
});

// GET /api/properties/:propertyId/tenants/:id
const getTenant = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.propertyId, owner: req.user._id });
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const tenant = await Tenant.findOne({ _id: req.params.id, property: req.params.propertyId }).populate('bed', 'bedNumber room');
  if (!tenant) {
    return res.status(404).json({ success: false, message: 'Tenant not found' });
  }
  res.json({ success: true, data: tenant });
});

// POST /api/properties/:propertyId/tenants
const createTenant = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.propertyId, owner: req.user._id });
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const { bedId, ...tenantData } = req.body;

  // Validate and assign bed if provided
  if (bedId) {
    const bed = await Bed.findById(bedId);
    if (!bed || !bed.isActive) {
      return res.status(404).json({ success: false, message: 'Bed not found' });
    }
    if (bed.status !== 'vacant') {
      return res.status(409).json({ success: false, message: `Bed is ${bed.status}. Only vacant beds can be assigned.` });
    }
    tenantData.bed = bedId;
  }

  const tenant = await Tenant.create({ ...tenantData, property: req.params.propertyId });

  // Mark bed as occupied
  if (bedId) {
    await Bed.findByIdAndUpdate(bedId, { status: 'occupied', tenant: tenant._id });
  }

  res.status(201).json({ success: true, data: tenant });
});

// PUT /api/properties/:propertyId/tenants/:id
const updateTenant = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.propertyId, owner: req.user._id });
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  // ── Immutability guard: prevent overwriting locked billing fields ──────────
  // rentAmount and billingSnapshot are set ONLY during bed assignment.
  // They must never be modified through the generic update endpoint.
  const updateBody = { ...req.body };
  delete updateBody.rentAmount;
  delete updateBody.billingSnapshot;

  const tenant = await Tenant.findOneAndUpdate(
    { _id: req.params.id, property: req.params.propertyId },
    updateBody,
    { new: true, runValidators: true }
  );
  if (!tenant) {
    return res.status(404).json({ success: false, message: 'Tenant not found' });
  }
  res.json({ success: true, data: tenant });
});

// DELETE /api/properties/:propertyId/tenants/:id  — marks as vacated and frees the bed
const vacateTenant = asyncHandler(async (req, res) => {
  const property = await Property.findOne({ _id: req.params.propertyId, owner: req.user._id });
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  const tenant = await Tenant.findOne({ _id: req.params.id, property: req.params.propertyId });
  if (!tenant) {
    return res.status(404).json({ success: false, message: 'Tenant not found' });
  }
  if (tenant.status === 'vacated') {
    return res.status(400).json({ success: false, message: 'Tenant is already vacated' });
  }

  const bedRef = tenant.bed;

  tenant.status = 'vacated';
  tenant.checkOutDate = req.body.checkOutDate ? new Date(req.body.checkOutDate) : new Date();
  tenant.bed = null;
  await tenant.save();

  // Free the bed
  if (bedRef) {
    await Bed.findByIdAndUpdate(bedRef, { status: 'vacant', tenant: null });
  }

  res.json({ success: true, message: 'Tenant vacated', data: tenant });
});

module.exports = { getTenants, getTenant, createTenant, updateTenant, vacateTenant };
