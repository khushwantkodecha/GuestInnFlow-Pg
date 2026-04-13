const Property    = require('../models/Property');
const Invoice     = require('../models/Invoice');
const Tenant      = require('../models/Tenant');
const Room        = require('../models/Room');
const Bed         = require('../models/Bed');
const asyncHandler = require('../utils/asyncHandler');
const invoiceService = require('../services/invoiceService');

const verifyOwnership = async (propertyId, userId) =>
  Property.findOne({ _id: propertyId, owner: userId, isActive: true });

// ─── List ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/properties/:propertyId/invoices
 * Query: ?status=  &month=  &year=  &tenantId=
 */
const getInvoices = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });

  const filter = { property: req.params.propertyId };
  if (req.query.status)   filter.status = req.query.status;
  if (req.query.month)    filter.month  = parseInt(req.query.month);
  if (req.query.year)     filter.year   = parseInt(req.query.year);
  if (req.query.tenantId) filter.tenant = req.query.tenantId;

  const invoices = await Invoice.find(filter)
    .populate('tenant', 'name phone')
    .populate('room',   'roomNumber floor')
    .populate('bed',    'bedNumber')
    .sort({ issuedAt: -1 });

  res.json({ success: true, count: invoices.length, data: invoices });
});

// ─── Single ───────────────────────────────────────────────────────────────────

/**
 * GET /api/properties/:propertyId/invoices/:id
 */
const getInvoice = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });

  const invoice = await Invoice.findOne({
    _id:      req.params.id,
    property: req.params.propertyId,
  })
    .populate('tenant', 'name phone email')
    .populate('room',   'roomNumber floor')
    .populate('bed',    'bedNumber');

  if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

  res.json({ success: true, data: invoice });
});

// ─── PDF Download ─────────────────────────────────────────────────────────────

/**
 * GET /api/properties/:propertyId/invoices/:id/pdf
 * Streams a PDF invoice directly to the client.
 */
const downloadInvoicePdf = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });

  const invoice = await Invoice.findOne({
    _id:      req.params.id,
    property: req.params.propertyId,
  });
  if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

  // Populate all details needed for the PDF
  const [tenant, room, bed] = await Promise.all([
    Tenant.findById(invoice.tenant).select('name phone email').lean(),
    invoice.room ? Room.findById(invoice.room).select('roomNumber floor').lean() : null,
    invoice.bed  ? Bed.findById(invoice.bed).select('bedNumber').lean()          : null,
  ]);

  invoiceService.generateInvoicePdf(invoice, property, tenant ?? {}, room, bed, res);
});

// ─── Share Message ────────────────────────────────────────────────────────────

/**
 * GET /api/properties/:propertyId/invoices/:id/share
 * Returns a WhatsApp-ready message string for the invoice.
 */
const getInvoiceShareMessage = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });

  const invoice = await Invoice.findOne({
    _id:      req.params.id,
    property: req.params.propertyId,
  });
  if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

  const tenant = await Tenant.findById(invoice.tenant).select('name phone').lean();

  const message = invoiceService.getShareMessage(invoice, tenant ?? {}, property);
  const phone   = (tenant?.phone ?? '').replace(/[^\d]/g, '');
  const waUrl   = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
    : null;

  const emailSubject = `Rent Invoice ${invoice.invoiceNumber} – ${property.name}`;
  const emailUrl     = tenant?.email
    ? `mailto:${tenant.email}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(message)}`
    : null;

  res.json({ success: true, data: { message, waUrl, emailUrl, phone: tenant?.phone ?? null } });
});

// ─── Manual generate ─────────────────────────────────────────────────────────

/**
 * POST /api/properties/:propertyId/invoices/generate
 * Body: { month, year }
 * Generates invoices for any RentPayments in that cycle that lack one.
 */
const generateInvoicesManual = asyncHandler(async (req, res) => {
  const property = await verifyOwnership(req.params.propertyId, req.user._id);
  if (!property) return res.status(404).json({ success: false, message: 'Property not found' });

  const now   = new Date();
  const month = parseInt(req.body.month) || now.getMonth() + 1;
  const year  = parseInt(req.body.year)  || now.getFullYear();

  const RentPayment = require('../models/RentPayment');
  const records = await RentPayment.find({
    property: req.params.propertyId,
    month,
    year,
  });

  const created = await invoiceService.generateInvoices(req.params.propertyId, records);

  res.status(201).json({
    success: true,
    message: `${created.length} invoice${created.length !== 1 ? 's' : ''} generated`,
    data:    { created: created.length },
  });
});

module.exports = {
  getInvoices,
  getInvoice,
  downloadInvoicePdf,
  getInvoiceShareMessage,
  generateInvoicesManual,
};
