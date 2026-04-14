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


const fmt = (n) => `Rs.${(n ?? 0).toLocaleString('en-IN')}`;

// Exported so the reconciliation scheduler and rentService can reuse it
// without duplicating the logic.
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
 * Called after allocatePayment (or reversePayment) updates a RentPayment.
 * Finds the linked Invoice and updates paidAmount, balance, status.
 *
 * Void invoices are never updated — they are intentionally closed.
 *
 * Note: totalAmount is NOT used to override invoice.totalAmount — the invoice
 * may carry additionalCharges that exceed the bare RentPayment.amount.
 * Only paidAmount (from the RentPayment) is authoritative here; balance and
 * status are re-derived from the invoice's own totalAmount.
 *
 * @param {string} rentRecordId   — RentPayment._id
 * @param {number} newPaidAmount  — cumulative paidAmount on the RentPayment
 * @param {number} totalAmount    — RentPayment.amount (used only when no invoice
 *                                  exists to check against additionalCharges)
 */
const syncInvoiceWithPayment = async (rentRecordId, newPaidAmount, _totalAmount) => {
  const invoice = await Invoice.findOne({ rentRecord: rentRecordId });
  if (!invoice) return;

  // Never modify a voided invoice — it is intentionally closed.
  if (invoice.status === 'void') return;

  invoice.paidAmount = newPaidAmount;
  // Use invoice.totalAmount (not the raw RentPayment.amount) so additionalCharges
  // from manual charges are included in the balance calculation.
  invoice.balance    = Math.max(0, invoice.totalAmount - newPaidAmount);
  invoice.status     = deriveStatus(newPaidAmount, invoice.totalAmount);
  await invoice.save();
};

// ─── Void ─────────────────────────────────────────────────────────────────────

/**
 * voidInvoice
 *
 * Marks an invoice as void. Void invoices:
 *  - Are excluded from payment sync (syncInvoiceWithPayment is a no-op on them).
 *  - Cannot be voided again.
 *  - Cannot be voided if already paid (paid invoices are financial records).
 *
 * Voiding does NOT reverse the linked RentPayment or write any LedgerEntry.
 * It is a display/reporting action only — use payment reversal to undo money.
 *
 * @param {string} propertyId
 * @param {string} invoiceId
 * @returns {Invoice}
 */
const voidInvoice = async (propertyId, invoiceId) => {
  const invoice = await Invoice.findOne({ _id: invoiceId, property: propertyId });
  if (!invoice) {
    throw Object.assign(new Error('Invoice not found'), { statusCode: 404 });
  }
  if (invoice.status === 'paid') {
    throw Object.assign(
      new Error('Cannot void a paid invoice. Use payment reversal to undo the payment first.'),
      { statusCode: 409 }
    );
  }
  if (invoice.status === 'void') {
    throw Object.assign(new Error('Invoice is already void'), { statusCode: 409 });
  }

  invoice.status = 'void';
  await invoice.save();
  return invoice;
};

// ─── Charge Attachment ────────────────────────────────────────────────────────

/**
 * attachChargeToInvoice
 *
 * Links a manual charge to the most relevant open invoice for the tenant,
 * and adds the charge amount to invoice.additionalCharges.
 *
 * Selection order:
 *  1. Invoice for the same billing period (month/year matching chargeDate).
 *  2. Most recently issued open invoice for the tenant (fallback).
 *  3. If no open invoice exists, returns null — the charge is recorded in the
 *     ledger but not reflected on any invoice.
 *
 * Invoice fields updated:
 *  - additionalCharges += chargeAmount
 *  - totalAmount = rentAmount + additionalCharges - discount
 *  - balance = max(0, totalAmount - paidAmount)
 *  - status re-derived
 *
 * @param {string} tenantId
 * @param {string} propertyId
 * @param {number} chargeAmount
 * @param {string|null} chargeDate — ISO date string; used to find matching period
 * @returns {ObjectId|null} — invoice._id if attached, null otherwise
 */
const attachChargeToInvoice = async (tenantId, propertyId, chargeAmount, chargeDate) => {
  const refDate = chargeDate ? new Date(chargeDate) : new Date();
  const month   = refDate.getMonth() + 1;
  const year    = refDate.getFullYear();

  // Prefer invoice for the same billing period
  let invoice = await Invoice.findOne({
    tenant:   tenantId,
    property: propertyId,
    month,
    year,
    status:   { $in: ['unpaid', 'partial'] },
  });

  // Fall back to most recently issued open invoice
  if (!invoice) {
    invoice = await Invoice.findOne({
      tenant:   tenantId,
      property: propertyId,
      status:   { $in: ['unpaid', 'partial'] },
    }).sort({ issuedAt: -1 });
  }

  if (!invoice) return null; // no open invoice to attach to

  invoice.additionalCharges  = (invoice.additionalCharges ?? 0) + chargeAmount;
  invoice.totalAmount        = invoice.rentAmount + invoice.additionalCharges - (invoice.discount ?? 0);
  invoice.balance            = Math.max(0, invoice.totalAmount - invoice.paidAmount);
  invoice.status             = deriveStatus(invoice.paidAmount, invoice.totalAmount);
  await invoice.save();

  return invoice._id;
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

  // Attach error handler BEFORE piping — if layout code throws after the stream
  // has started, we can't send a JSON response (headers already sent), but we
  // can log the error and terminate the stream cleanly so the client isn't left
  // hanging with a partial download.
  doc.on('error', (err) => {
    console.error(JSON.stringify({
      level: 'error', ts: new Date().toISOString(),
      event: 'pdf.generation.stream_error',
      invoiceId: invoice._id?.toString(),
      error: err.message,
    }));
    if (!res.writableEnded) res.end();
  });

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

// ─── Vacate Sync ──────────────────────────────────────────────────────────────

/**
 * syncTenantInvoicesOnVacate
 *
 * Called post-commit after a tenant vacates. Re-syncs every invoice for the
 * tenant against its linked RentPayment record's current paidAmount so that
 * all invoices reflect the final settlement state (paid / partial / unpaid).
 *
 * This is best-effort — a failure here does not roll back the vacate.
 *
 * @param {string|ObjectId} tenantId
 */
const syncTenantInvoicesOnVacate = async (tenantId) => {
  // Lazy-require to avoid circular dependency (invoiceService ← rentService ← invoiceService)
  const RentPayment = require('../models/RentPayment');
  const records = await RentPayment.find({ tenant: tenantId }).lean();
  for (const record of records) {
    try {
      await syncInvoiceWithPayment(record._id, record.paidAmount ?? 0, record.amount);
    } catch (_) { /* non-fatal per record */ }
  }
};

module.exports = {
  deriveStatus,
  generateInvoices,
  syncInvoiceWithPayment,
  syncTenantInvoicesOnVacate,
  voidInvoice,
  attachChargeToInvoice,
  generateInvoicePdf,
  getShareMessage,
};
