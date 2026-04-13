/**
 * POST /api/properties/:propertyId/tenants/merge
 *
 * Merges a source tenant record into a master tenant record.
 *
 * Rules:
 *  - Both must exist and belong to the same property owned by the caller.
 *  - Cannot merge a record into itself.
 *  - If BOTH are active → error (ambiguous bed ownership).
 *  - If BOTH have an active bed → error (cannot decide which bed to keep).
 *  - Profile fields are copied from source → master only when master's field is empty.
 *  - All RentPayment records are re-owned to master.
 *    If master already has a payment for the same (month, year) cycle, the
 *    source record is deleted to avoid the unique-index violation.
 *  - rentHistory entries from source are appended to master.
 *  - source.status → 'merged', source.mergedInto → master._id.
 *  - Entire operation runs in a transaction (with no-replica-set fallback).
 */

const crypto      = require('crypto');
const Property    = require('../models/Property');
const Tenant      = require('../models/Tenant');
const Bed         = require('../models/Bed');
const RentPayment = require('../models/RentPayment');
const asyncHandler = require('../utils/asyncHandler');
const { runWithRetry } = require('../utils/runWithRetry');

// ── Logger ────────────────────────────────────────────────────────────────────
const logger = {
  info:  (e, m = {}) => console.log(JSON.stringify({ level: 'info',  ts: new Date().toISOString(), event: e, ...m })),
  warn:  (e, m = {}) => console.warn(JSON.stringify({ level: 'warn', ts: new Date().toISOString(), event: e, ...m })),
  error: (e, m = {}) => console.error(JSON.stringify({ level: 'error', ts: new Date().toISOString(), event: e, ...m })),
};

// ── Field merge helper ────────────────────────────────────────────────────────
// For scalar fields: copy source → master only when master is empty/falsy.
// For sub-documents (emergencyContact, documents, verification): merge each
// sub-field individually so partial master data is not wiped.
const mergeFields = (master, source) => {
  // Scalar profile fields
  const SCALAR_FIELDS = ['email', 'aadharNumber', 'address', 'agreementType', 'agreementFileUrl'];
  for (const f of SCALAR_FIELDS) {
    if (!master[f] && source[f]) master[f] = source[f];
  }

  // emergencyContact — merge sub-fields
  if (source.emergencyContact) {
    if (!master.emergencyContact) master.emergencyContact = {};
    for (const sub of ['name', 'phone', 'relation']) {
      if (!master.emergencyContact[sub] && source.emergencyContact[sub]) {
        master.emergencyContact[sub] = source.emergencyContact[sub];
      }
    }
  }

  // documents — merge sub-fields
  if (source.documents) {
    if (!master.documents) master.documents = {};
    for (const sub of ['idProofUrl', 'photoUrl']) {
      if (!master.documents[sub] && source.documents[sub]) {
        master.documents[sub] = source.documents[sub];
      }
    }
  }

  // verification — merge sub-fields (take the more verified state)
  if (source.verification) {
    if (!master.verification) master.verification = {};
    // policeStatus: prefer 'verified' > 'submitted' > 'pending'
    const rank = { pending: 0, submitted: 1, verified: 2 };
    const srcRank = rank[source.verification.policeStatus] ?? 0;
    const mstRank = rank[master.verification.policeStatus] ?? 0;
    if (srcRank > mstRank) master.verification.policeStatus = source.verification.policeStatus;
    if (source.verification.idVerified)               master.verification.idVerified = true;
    if (source.verification.emergencyContactVerified) master.verification.emergencyContactVerified = true;
  }

  // idProofUploaded
  if (source.idProofUploaded && !master.idProofUploaded) {
    master.idProofUploaded = true;
  }

  // Financial fields — take whichever is greater (favour the tenant with more history)
  if ((source.depositAmount ?? 0) > (master.depositAmount ?? 0)) {
    master.depositAmount = source.depositAmount;
  }
  if (source.depositPaid)     master.depositPaid = true;
  if (source.depositReturned) master.depositReturned = true;
  if (!master.dueDate && source.dueDate) master.dueDate = source.dueDate;

  // Use the earlier check-in date
  if (source.checkInDate && (!master.checkInDate || source.checkInDate < master.checkInDate)) {
    master.checkInDate = source.checkInDate;
  }
};

// ── Controller ────────────────────────────────────────────────────────────────
const mergeTenants = asyncHandler(async (req, res) => {
  const { propertyId } = req.params;
  const { masterTenantId, sourceTenantId } = req.body;

  // ── Basic presence checks ──────────────────────────────────────────────────
  if (!masterTenantId || !sourceTenantId) {
    return res.status(400).json({
      success: false,
      message: 'masterTenantId and sourceTenantId are required',
      code: 'MISSING_FIELDS',
    });
  }
  if (String(masterTenantId) === String(sourceTenantId)) {
    return res.status(400).json({
      success: false,
      message: 'Cannot merge a tenant into itself',
      code: 'SAME_TENANT',
    });
  }

  // ── Property ownership ─────────────────────────────────────────────────────
  const property = await Property.findOne({ _id: propertyId, owner: req.user._id });
  if (!property) {
    return res.status(404).json({ success: false, message: 'Property not found' });
  }

  // ── Load both tenants ──────────────────────────────────────────────────────
  const [master, source] = await Promise.all([
    Tenant.findOne({ _id: masterTenantId, property: propertyId }),
    Tenant.findOne({ _id: sourceTenantId, property: propertyId }),
  ]);

  if (!master) return res.status(404).json({ success: false, message: 'Master tenant not found', code: 'MASTER_NOT_FOUND' });
  if (!source) return res.status(404).json({ success: false, message: 'Source tenant not found', code: 'SOURCE_NOT_FOUND' });

  // Guard: source already merged
  if (source.status === 'merged') {
    return res.status(409).json({
      success: false,
      message: 'Source tenant has already been merged into another record',
      code: 'ALREADY_MERGED',
    });
  }

  // Guard: both active
  const masterActive = master.status === 'active' || master.status === 'notice';
  const sourceActive = source.status === 'active' || source.status === 'notice';
  if (masterActive && sourceActive) {
    return res.status(409).json({
      success: false,
      message: 'Both tenants are active. Vacate one before merging.',
      code: 'BOTH_ACTIVE',
    });
  }

  // Guard: both have an active bed (should be caught by above, but explicit)
  if (master.bed && source.bed) {
    return res.status(409).json({
      success: false,
      message: 'Both tenants have an active bed assignment. Vacate one before merging.',
      code: 'BOTH_HAVE_BED',
    });
  }

  const traceId = crypto.randomUUID();

  logger.info('tenant.merge.start', {
    traceId,
    masterTenantId,
    sourceTenantId,
    masterStatus: master.status,
    sourceStatus: source.status,
    userId: req.user._id,
  });

  // ── Pre-fetch rent payments outside the transaction ────────────────────────
  // We need to know which (month, year) cycles master already has to avoid
  // unique-index conflicts when re-owning source payments.
  const [masterPayments, sourcePayments] = await Promise.all([
    RentPayment.find({ tenant: master._id }).select('month year').lean(),
    RentPayment.find({ tenant: source._id }).select('_id month year').lean(),
  ]);

  const masterCycleSet = new Set(masterPayments.map(p => `${p.year}-${p.month}`));

  const paymentsToTransfer = [];
  const paymentsToDelete   = [];

  for (const p of sourcePayments) {
    if (masterCycleSet.has(`${p.year}-${p.month}`)) {
      // Master already has this billing cycle — drop the source duplicate
      paymentsToDelete.push(p._id);
    } else {
      paymentsToTransfer.push(p._id);
    }
  }

  // ── Atomic merge transaction ───────────────────────────────────────────────
  await runWithRetry(async (session) => {
    const opts = session ? { session } : {};

    // 1. Field merge
    mergeFields(master, source);

    // 2. Bed transfer: if master has no bed but source does, hand it to master
    if (!master.bed && source.bed) {
      master.bed = source.bed;
      await Bed.findByIdAndUpdate(source.bed, { tenant: master._id }, opts);
    }

    // 3. Append source rent history to master
    if (source.rentHistory?.length) {
      master.rentHistory = [
        ...(master.rentHistory ?? []),
        ...source.rentHistory.map(h => ({ ...h.toObject(), reason: `merged_from_${sourceTenantId}` })),
      ];
    }

    // 4. Merge note
    const mergeNote = `[Merged from: ${source.name} (${source.phone}) on ${new Date().toISOString().split('T')[0]}]`;
    master.vacateNotes = master.vacateNotes
      ? `${master.vacateNotes}\n${mergeNote}`
      : mergeNote;

    // 5. Save master
    await master.save(opts);

    // 6. Re-own rent payments
    if (paymentsToTransfer.length > 0) {
      await RentPayment.updateMany(
        { _id: { $in: paymentsToTransfer } },
        { $set: { tenant: master._id } },
        opts
      );
    }
    if (paymentsToDelete.length > 0) {
      await RentPayment.deleteMany({ _id: { $in: paymentsToDelete } }, opts);
    }

    // 7. Soft-delete source
    source.status     = 'merged';
    source.mergedInto = master._id;
    source.bed        = null;
    await source.save(opts);
  });

  logger.info('tenant.merge.complete', {
    traceId,
    masterTenantId: master._id,
    sourceTenantId: source._id,
    paymentsTransferred: paymentsToTransfer.length,
    paymentsDropped:     paymentsToDelete.length,
    userId: req.user._id,
  });

  res.json({
    success: true,
    message: `Tenant "${source.name}" merged into "${master.name}" successfully`,
    data: {
      masterTenantId: master._id,
      sourceTenantId: source._id,
      paymentsTransferred: paymentsToTransfer.length,
      paymentsDropped:     paymentsToDelete.length,
    },
  });
});

module.exports = { mergeTenants };
