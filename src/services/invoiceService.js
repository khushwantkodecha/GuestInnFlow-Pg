/**
 * invoiceService.js
 *
 * Business logic for the Invoice system:
 *   - generateInvoices       → create Invoice docs from RentPayment records
 *   - syncInvoiceWithPayment → update paidAmount/balance/status after a payment
 *   - generateInvoicePdf     → stream a pdfkit PDF to the Express response
 *   - getShareMessage        → WhatsApp-ready text for an invoice
 */

const PDFDocument   = require('pdfkit');
const Invoice       = require('../models/Invoice');
const InvoiceCounter = require('../models/InvoiceCounter');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const fmt = (n) => `Rs.${(n ?? 0).toLocaleString('en-IN')}`;

const deriveStatus = (paidAmount, totalAmount) => {
  if (paidAmount >= totalAmount) return 'paid';
  if (paidAmount > 0)            return 'partial';
  return 'unpaid';
};

/**
 * Atomically increment and return the next sequence number for this
 * property + year combination.  Returns a formatted string: INV-YYYY-NNN.
 */
const getNextInvoiceNumber = async (propertyId, year) => {
  const counter = await InvoiceCounter.findOneAndUpdate(
    { property: propertyId, year },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const seq = String(counter.seq).padStart(3, '0');
  return `INV-${year}-${seq}`;
};

// ─── Generate ─────────────────────────────────────────────────────────────────

/**
 * generateInvoices
 *
 * Creates one Invoice per RentPayment record.
 * Idempotent — skips records that already have an invoice.
 *
 * @param {string}        propertyId
 * @param {RentPayment[]} rentRecords  — populated or lean docs
 * @returns {Invoice[]}               — newly created invoices
 */
const generateInvoices = async (propertyId, rentRecords) => {
  const created = [];

  for (const record of rentRecords) {
    // Skip if already generated
    const existing = await Invoice.findOne({ rentRecord: record._id });
    if (existing) continue;

    const invoiceNumber = await getNextInvoiceNumber(propertyId, record.year);

    const paidAmount = record.paidAmount ?? 0;
    const balance    = Math.max(0, record.amount - paidAmount);

    const invoice = await Invoice.create({
      tenant:            record.tenant,
      property:          propertyId,
      room:              record.room  ?? null,
      bed:               record.bed   ?? null,
      rentRecord:        record._id,
      invoiceNumber,
      periodStart:       record.periodStart ?? null,
      periodEnd:         record.periodEnd   ?? null,
      month:             record.month,
      year:              record.year,
      rentAmount:        record.amount,
      additionalCharges: 0,
      discount:          0,
      totalAmount:       record.amount,
      paidAmount,
      balance,
      status:            deriveStatus(paidAmount, record.amount),
      dueDate:           record.dueDate,
      issuedAt:          new Date(),
    });

    created.push(invoice);
  }

  return created;
};

// ─── Payment Sync ─────────────────────────────────────────────────────────────

/**
 * syncInvoiceWithPayment
 *
 * Called after allocatePayment updates a RentPayment.
 * Finds the linked Invoice and updates paidAmount, balance, status.
 *
 * @param {string} rentRecordId   — RentPayment._id
 * @param {number} newPaidAmount  — cumulative paidAmount on the RentPayment
 * @param {number} totalAmount    — RentPayment.amount (never changes)
 */
const syncInvoiceWithPayment = async (rentRecordId, newPaidAmount, totalAmount) => {
  const invoice = await Invoice.findOne({ rentRecord: rentRecordId });
  if (!invoice) return;

  invoice.paidAmount = newPaidAmount;
  invoice.balance    = Math.max(0, totalAmount - newPaidAmount);
  invoice.status     = deriveStatus(newPaidAmount, totalAmount);
  await invoice.save();
};

// ─── PDF ──────────────────────────────────────────────────────────────────────

/**
 * generateInvoicePdf
 *
 * Streams a PDF invoice to the Express `res` object.
 *
 * @param {Invoice}  invoice  — fully populated Invoice document
 * @param {Property} property — populated property doc
 * @param {Tenant}   tenant   — populated tenant doc
 * @param {Room}     room     — populated room doc (or null)
 * @param {Bed}      bed      — populated bed doc (or null)
 * @param {object}   res      — Express response
 */
const generateInvoicePdf = (invoice, property, tenant, room, bed, res) => {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${invoice.invoiceNumber}.pdf"`
  );
  doc.pipe(res);

  // ── Dimensions ────────────────────────────────────────────────────────────
  const W  = doc.page.width;   // 595
  const ML = 45;               // left margin
  const MR = W - 45;           // right margin
  const CW = MR - ML;          // content width = 505

  // ── Palette ───────────────────────────────────────────────────────────────
  const TEAL   = '#45a793';
  const DARK   = '#1e293b';
  const MID    = '#475569';
  const LIGHT  = '#94a3b8';
  const BG     = '#f8fafc';
  const WHITE  = '#ffffff';

  const STATUS_COLOR = { paid: '#16a34a', partial: '#d97706', unpaid: '#dc2626' };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const hrule = (y, color = '#e2e8f0', thick = 0.5) => {
    doc.moveTo(ML, y).lineTo(MR, y).lineWidth(thick).strokeColor(color).stroke();
  };

  const fdate = (d) => d
    ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

  let y = 0;

  // ── Header band (teal) ───────────────────────────────────────────────────
  doc.rect(0, 0, W, 90).fill(TEAL);

  doc.fillColor(WHITE)
     .font('Helvetica-Bold')
     .fontSize(20)
     .text('GuestInnFlow', ML, 22);

  doc.font('Helvetica')
     .fontSize(9)
     .fillColor('rgba(255,255,255,0.75)')
     .text('PG Management System', ML, 45);

  // Property name (right-aligned in header)
  doc.font('Helvetica-Bold')
     .fontSize(11)
     .fillColor(WHITE)
     .text(property.name ?? 'Property', ML, 22, { width: CW, align: 'right' });

  const addr = [
    property.address?.street,
    property.address?.city,
    property.address?.state,
    property.address?.pincode,
  ].filter(Boolean).join(', ');

  if (addr) {
    doc.font('Helvetica')
       .fontSize(8)
       .fillColor('rgba(255,255,255,0.75)')
       .text(addr, ML, 38, { width: CW, align: 'right' });
  }

  y = 90;

  // ── Invoice info row ─────────────────────────────────────────────────────
  doc.rect(0, y, W, 65).fill(BG);
  y += 14;

  // Left: Invoice number + dates
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(16)
     .text(invoice.invoiceNumber, ML, y);
  y += 22;

  doc.fillColor(MID).font('Helvetica').fontSize(8.5)
     .text(`Issued: ${fdate(invoice.issuedAt)}`, ML, y)
     .text(`Due: ${fdate(invoice.dueDate)}`, ML + 140, y);
  y += 13;

  if (invoice.periodStart && invoice.periodEnd) {
    doc.fillColor(LIGHT).fontSize(8)
       .text(`Period: ${fdate(invoice.periodStart)} – ${fdate(invoice.periodEnd)}`, ML, y);
  }

  // Right: Status badge
  const statusLabel = invoice.status.toUpperCase();
  const statusColor = STATUS_COLOR[invoice.status] ?? '#64748b';
  const badgeW = 78, badgeH = 26, badgeX = MR - badgeW, badgeY = 104;
  doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 5)
     .fillAndStroke(statusColor + '1a', statusColor);
  doc.fillColor(statusColor).font('Helvetica-Bold').fontSize(10)
     .text(statusLabel, badgeX, badgeY + 7, { width: badgeW, align: 'center' });

  y = 155;
  hrule(y);
  y += 16;

  // ── Tenant + Room info (2-col) ────────────────────────────────────────────
  const col2 = ML + CW / 2 + 10;

  doc.fillColor(LIGHT).font('Helvetica-Bold').fontSize(7.5)
     .text('BILLED TO', ML, y)
     .text('ACCOMMODATION', col2, y);
  y += 14;

  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11)
     .text(tenant.name ?? '—', ML, y);
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11)
     .text(room ? `Room ${room.roomNumber}` : '—', col2, y);
  y += 16;

  doc.fillColor(MID).font('Helvetica').fontSize(9);
  if (tenant.phone) { doc.text(tenant.phone, ML, y); }
  if (bed)          { doc.text(`Bed ${bed.bedNumber}`, col2, y); }
  y += 13;
  if (tenant.email) { doc.fillColor(MID).fontSize(9).text(tenant.email, ML, y); }
  y += 13;

  y += 4;
  hrule(y);
  y += 16;

  // ── Charges table ─────────────────────────────────────────────────────────
  doc.fillColor(LIGHT).font('Helvetica-Bold').fontSize(7.5)
     .text('DESCRIPTION', ML, y)
     .text('AMOUNT', MR - 80, y, { width: 80, align: 'right' });
  y += 12;
  hrule(y, '#cbd5e1', 0.5);
  y += 10;

  const tableRow = (label, amount, bold = false) => {
    doc
      .fillColor(bold ? DARK : MID)
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(9.5)
      .text(label, ML, y);
    doc
      .fillColor(bold ? DARK : MID)
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(9.5)
      .text(fmt(amount), MR - 80, y, { width: 80, align: 'right' });
    y += 20;
  };

  tableRow('Monthly Rent', invoice.rentAmount);

  if (invoice.additionalCharges > 0) {
    tableRow('Additional Charges', invoice.additionalCharges);
  }
  if (invoice.discount > 0) {
    tableRow(`Discount`, -invoice.discount);
  }

  hrule(y - 4, '#cbd5e1', 0.5);
  tableRow('Total', invoice.totalAmount, true);

  y += 4;
  hrule(y);
  y += 16;

  // ── Payment summary ───────────────────────────────────────────────────────
  doc.fillColor(LIGHT).font('Helvetica-Bold').fontSize(7.5)
     .text('PAYMENT SUMMARY', ML, y);
  y += 14;

  const summaryRow = (label, value, valueColor = MID) => {
    doc.fillColor(MID).font('Helvetica').fontSize(9)
       .text(label, ML, y);
    doc.fillColor(valueColor).font('Helvetica-Bold').fontSize(9)
       .text(value, MR - 120, y, { width: 120, align: 'right' });
    y += 18;
  };

  const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const periodLabel = invoice.month
    ? `${MONTH_SHORT[(invoice.month ?? 1) - 1]} ${invoice.year}`
    : '';

  summaryRow(`Total for ${periodLabel}`, fmt(invoice.totalAmount));
  summaryRow('Amount Paid', fmt(invoice.paidAmount), '#16a34a');
  summaryRow(
    'Balance Due',
    fmt(invoice.balance),
    invoice.balance > 0 ? '#dc2626' : '#64748b'
  );

  y += 4;
  hrule(y);
  y += 20;

  // ── Notes / Terms ─────────────────────────────────────────────────────────
  if (invoice.balance > 0) {
    doc.fillColor(LIGHT).font('Helvetica').fontSize(8)
       .text(`Please pay the balance of ${fmt(invoice.balance)} by ${fdate(invoice.dueDate)}.`, ML, y, { width: CW });
    y += 14;
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  const footerY = doc.page.height - 50;
  doc.rect(0, footerY - 1, W, 51).fill(BG);
  hrule(footerY - 1, '#e2e8f0', 0.5);

  doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(9)
     .text('Thank you for staying with us!', ML, footerY + 10, { width: CW, align: 'center' });

  doc.fillColor(LIGHT).font('Helvetica').fontSize(7.5)
     .text(
       `Generated by GuestInnFlow · ${property.name ?? ''} · ${new Date().toLocaleDateString('en-IN')}`,
       ML, footerY + 26, { width: CW, align: 'center' }
     );

  doc.end();
};

// ─── Share Message ────────────────────────────────────────────────────────────

/**
 * getShareMessage
 *
 * Returns a WhatsApp-ready text message for the given invoice.
 *
 * @param {Invoice} invoice
 * @param {Tenant}  tenant
 * @param {Property} property
 * @returns {string}
 */
const getShareMessage = (invoice, tenant, property) => {
  const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const period = invoice.month
    ? `${MONTH_SHORT[(invoice.month ?? 1) - 1]} ${invoice.year}`
    : '';

  const statusLine =
    invoice.status === 'paid'
      ? 'Status: ✅ Fully Paid'
      : invoice.status === 'partial'
      ? `Status: 🔶 Partial — Balance: ${fmt(invoice.balance)}`
      : `Status: 🔴 Unpaid — Balance: ${fmt(invoice.balance)}`;

  const dueLine = invoice.balance > 0
    ? `\nDue Date: ${new Date(invoice.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : '';

  return [
    `Hi ${tenant.name},`,
    ``,
    `Your rent invoice for *${period}* from *${property.name}* is ready.`,
    ``,
    `Invoice No: ${invoice.invoiceNumber}`,
    `Rent Amount: ${fmt(invoice.totalAmount)}`,
    `Paid: ${fmt(invoice.paidAmount)}`,
    statusLine,
    dueLine,
    ``,
    `Please contact us for any queries.`,
    ``,
    `— ${property.name} Management`,
  ].filter((l) => l !== undefined).join('\n');
};

module.exports = {
  generateInvoices,
  syncInvoiceWithPayment,
  generateInvoicePdf,
  getShareMessage,
};
