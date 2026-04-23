/**
 * One-time seed script — creates the initial superadmin account.
 *
 * Usage:
 *   node scripts/createSuperAdmin.js
 *
 * Override defaults with env vars:
 *   SA_NAME="Your Name" SA_EMAIL="you@example.com" SA_PASSWORD="secret" node scripts/createSuperAdmin.js
 */

require('dotenv').config();
const mongoose   = require('mongoose');
const SuperAdmin = require('../src/models/SuperAdmin');

const NAME     = process.env.SA_NAME     || 'Superadmin';
const EMAIL    = process.env.SA_EMAIL    || 'admin@dormaxis.com';
const PASSWORD = process.env.SA_PASSWORD || 'DormAxis@2025';

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  const existing = await SuperAdmin.findOne({ email: EMAIL });
  if (existing) {
    console.log(`Superadmin already exists: ${EMAIL}`);
    process.exit(0);
  }

  await SuperAdmin.create({ name: NAME, email: EMAIL, password: PASSWORD });

  console.log('─────────────────────────────────────────');
  console.log('Superadmin created successfully!');
  console.log(`  Email:    ${EMAIL}`);
  console.log(`  Password: ${PASSWORD}`);
  console.log('  ⚠️  Change the password after first login.');
  console.log('─────────────────────────────────────────');
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
