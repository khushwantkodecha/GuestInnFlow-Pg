/**
 * fixRoomTransferBilling.js
 *
 * One-time fix for tenants whose current-month RentPayment.amount was not
 * updated after a room transfer. Brings RentPayment, LedgerEntry, and
 * tenant.ledgerBalance into sync with tenant.rentAmount.
 *
 * Run:  node scripts/fixRoomTransferBilling.js
 *
 * Safe to re-run — skips records that are already in sync.
 */

require('dotenv').config();
const mongoose    = require('mongoose');
const Tenant      = require('../src/models/Tenant');
const RentPayment = require('../src/models/RentPayment');
const LedgerEntry = require('../src/models/LedgerEntry');

const connectDB = require('../src/config/db');

const now      = new Date();
const curMonth = now.getMonth() + 1;
const curYear  = now.getFullYear();

async function run() {
  await connectDB();
  console.log(`\nScanning current billing cycle: ${curMonth}/${curYear}\n`);

  // Find all active tenants that have a rent amount set
  const tenants = await Tenant.find({
    status:     { $in: ['active', 'notice'] },
    rentAmount: { $gt: 0 },
  }).select('_id name rentAmount ledgerBalance property').lean();

  let fixed = 0;
  let skipped = 0;

  for (const tenant of tenants) {
    const record = await RentPayment.findOne({
      tenant: tenant._id,
      month:  curMonth,
      year:   curYear,
      status: { $in: ['pending', 'partial', 'overdue'] },
    });

    if (!record) {
      skipped++;
      continue;
    }

    // Fix 1: RentPayment.amount out of sync with current rentAmount
    if (record.amount !== tenant.rentAmount) {
      const oldAmount = record.amount;
      record.amount   = tenant.rentAmount;
      await record.save();
      console.log(`  [RentPayment] ${tenant.name}: ₹${oldAmount} → ₹${tenant.rentAmount}`);
    }

    // Fix 2: LedgerEntry balance out of sync with actual open records
    // Compute what the balance SHOULD be (sum of all open record balances)
    const allOpen = await RentPayment.find({
      tenant: tenant._id,
      status: { $in: ['pending', 'partial', 'overdue'] },
    }).select('amount paidAmount').lean();

    const expectedBalance = allOpen.reduce((s, r) => s + (r.amount - (r.paidAmount ?? 0)), 0);

    const latestEntry = await LedgerEntry.findOne({ tenant: tenant._id })
      .sort({ createdAt: -1 }).lean();
    const ledgerBalance = latestEntry?.balanceAfter ?? 0;

    if (ledgerBalance === expectedBalance) {
      skipped++;
      continue;
    }

    const delta = expectedBalance - ledgerBalance;

    await LedgerEntry.create({
      tenant:        tenant._id,
      property:      tenant.property,
      type:          delta > 0 ? 'debit' : 'credit',
      amount:        Math.abs(delta),
      balanceAfter:  expectedBalance,
      referenceType: 'adjustment',
      referenceId:   tenant._id,
      description:   `Rent corrected after room transfer (₹${ledgerBalance} → ₹${expectedBalance})`,
    });

    await Tenant.updateOne({ _id: tenant._id }, { ledgerBalance: expectedBalance });

    console.log(
      `✅ Fixed: ${tenant.name} | LedgerEntry balance ₹${ledgerBalance} → ₹${expectedBalance}`
    );
    fixed++;
  }

  console.log(`\nDone. Fixed: ${fixed}  Already in sync / skipped: ${skipped}\n`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Script failed:', err.message);
  process.exit(1);
});
