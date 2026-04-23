/**
 * fixIncompleteTenants.js
 *
 * One-time migration: marks tenants with no bed as 'incomplete' and removes
 * any RentPayment records that were incorrectly generated for them.
 *
 * Root cause: before the incomplete-status system was introduced, tenants were
 * created with status='active' even when no bed was assigned. This allowed rent
 * to be generated for bed-less tenants.
 *
 * What this script does:
 *   1. Find all tenants where bed is null and status is 'active' or 'notice'
 *   2. Set their status to 'incomplete'
 *   3. Delete any RentPayment records for those tenants (they are invalid)
 *   4. Delete any LedgerEntry records of type 'rent_generated' for those tenants
 *   5. Reset ledgerBalance to 0 for those tenants
 *
 * Run:        node scripts/fixIncompleteTenants.js
 * Dry-run:    DRY_RUN=1 node scripts/fixIncompleteTenants.js
 *
 * Safe to re-run — uses explicit queries, not blind deletes.
 */

require('dotenv').config();
const mongoose     = require('mongoose');
const Tenant       = require('../src/models/Tenant');
const RentPayment  = require('../src/models/RentPayment');
const LedgerEntry  = require('../src/models/LedgerEntry');

const DRY_RUN = process.env.DRY_RUN === '1';

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected. DRY_RUN=${DRY_RUN}\n`);

  // 1. Find affected tenants
  const affected = await Tenant.find(
    { bed: null, status: { $in: ['active', 'notice'] } },
    '_id name phone property status'
  ).lean();

  if (!affected.length) {
    console.log('No affected tenants found. System is clean.');
    process.exit(0);
  }

  console.log(`Found ${affected.length} tenant(s) with no bed and active/notice status:`);
  affected.forEach(t => console.log(`  ${t._id}  ${t.name}  (${t.status})`));
  console.log('');

  const tenantIds = affected.map(t => t._id);

  // 2. Count rent records to be removed
  const rentCount = await RentPayment.countDocuments({ tenant: { $in: tenantIds } });
  const ledgerCount = await LedgerEntry.countDocuments({
    tenant: { $in: tenantIds },
    referenceType: 'rent_generated',
  });

  console.log(`RentPayment records to delete:  ${rentCount}`);
  console.log(`LedgerEntry (rent) to delete:   ${ledgerCount}`);
  console.log('');

  if (DRY_RUN) {
    console.log('DRY RUN — no writes performed.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // 3. Delete rent payment records
  const rpResult = await RentPayment.deleteMany({ tenant: { $in: tenantIds } });
  console.log(`Deleted ${rpResult.deletedCount} RentPayment records.`);

  // 4. Delete rent_generated ledger entries
  const leResult = await LedgerEntry.deleteMany({
    tenant: { $in: tenantIds },
    referenceType: 'rent_generated',
  });
  console.log(`Deleted ${leResult.deletedCount} LedgerEntry records.`);

  // 5. Mark tenants as incomplete and reset ledger balance
  const tResult = await Tenant.updateMany(
    { _id: { $in: tenantIds } },
    { $set: { status: 'incomplete', ledgerBalance: 0 } }
  );
  console.log(`Updated ${tResult.modifiedCount} tenant(s) → status: 'incomplete', ledgerBalance: 0.`);

  console.log('\nMigration complete.');
  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
