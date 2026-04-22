/**
 * fixPendingDepositLedger.js
 *
 * One-time migration: removes deposit_collected ledger entries that were
 * incorrectly created for tenants whose deposit is still in "pending" state.
 *
 * Root cause: assignBed previously defaulted depositCollected to true when the
 * field was absent, writing a deposit_collected ledger entry even when the
 * operator chose "Not collected yet (pending)".
 *
 * Run:   node scripts/fixPendingDepositLedger.js
 * Dry-run (no writes):  DRY_RUN=1 node scripts/fixPendingDepositLedger.js
 *
 * Safe to re-run — only deletes entries for tenants with depositPaid=false.
 */

require('dotenv').config();
const mongoose    = require('mongoose');
const Tenant      = require('../src/models/Tenant');
const LedgerEntry = require('../src/models/LedgerEntry');
const connectDB   = require('../src/config/db');

const DRY_RUN = process.env.DRY_RUN === '1';

async function run() {
  await connectDB();
  console.log(`[fixPendingDepositLedger] mode=${DRY_RUN ? 'DRY_RUN' : 'LIVE'}`);

  // Find all tenants whose deposit has NOT been collected
  const pendingTenants = await Tenant
    .find({ depositPaid: { $ne: true }, depositAmount: { $gt: 0 } })
    .select('_id name depositStatus depositPaid')
    .lean();

  console.log(`[fixPendingDepositLedger] Found ${pendingTenants.length} tenant(s) with pending/uncollected deposit`);

  if (pendingTenants.length === 0) {
    console.log('[fixPendingDepositLedger] Nothing to fix.');
    await mongoose.disconnect();
    return;
  }

  const tenantIds = pendingTenants.map((t) => t._id);

  // Find incorrect deposit_collected entries for these tenants
  const badEntries = await LedgerEntry
    .find({ tenant: { $in: tenantIds }, referenceType: 'deposit_collected' })
    .select('_id tenant amount description createdAt')
    .lean();

  console.log(`[fixPendingDepositLedger] Found ${badEntries.length} incorrect deposit_collected ledger entry(ies) to remove`);

  if (badEntries.length === 0) {
    console.log('[fixPendingDepositLedger] No ledger entries to remove. All clean.');
    await mongoose.disconnect();
    return;
  }

  // Log each affected entry
  for (const entry of badEntries) {
    const tenant = pendingTenants.find((t) => String(t._id) === String(entry.tenant));
    console.log(
      `  - LedgerEntry ${entry._id}  tenant="${tenant?.name ?? entry.tenant}"` +
      `  amount=${entry.amount}  created=${entry.createdAt?.toISOString?.() ?? '?'}`
    );
  }

  if (DRY_RUN) {
    console.log('[fixPendingDepositLedger] DRY_RUN=1 — no changes written.');
  } else {
    const badIds = badEntries.map((e) => e._id);
    const result = await LedgerEntry.deleteMany({ _id: { $in: badIds } });
    console.log(`[fixPendingDepositLedger] Deleted ${result.deletedCount} ledger entry(ies).`);
  }

  await mongoose.disconnect();
  console.log('[fixPendingDepositLedger] Done.');
}

run().catch((err) => {
  console.error('[fixPendingDepositLedger] Fatal:', err);
  process.exit(1);
});
