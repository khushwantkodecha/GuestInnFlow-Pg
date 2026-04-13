const express = require('express');
const {
  generateMonthlyRent,
  getAllRents,
  getPendingRents,
  getOverdueRents,
  getTenantRentHistory,
  recordPayment,
  getTenantLedger,
  addManualCharge,
  markRentAsPaid,
} = require('../controllers/rentController');
const { protect } = require('../middleware/auth');

// Mounted at /api/properties/:propertyId/rents
const router = express.Router({ mergeParams: true });

router.use(protect);

// Named filters — must come before /:id to avoid route shadowing
router.get('/pending', getPendingRents);
router.get('/overdue', getOverdueRents);

// Tenant-scoped: rent history + ledger + manual charge
router.get( '/tenants/:tenantId/rents',  getTenantRentHistory);
router.get( '/tenants/:tenantId/ledger', getTenantLedger);
router.post('/tenants/:tenantId/charge', addManualCharge);

// Payments (full financial tracking — preferred over PATCH /:id/pay)
router.post('/payments', recordPayment);

// Rent record CRUD
router.route('/').get(getAllRents);
router.post('/generate', generateMonthlyRent);

// Legacy pay endpoint — kept for backward compat
router.patch('/:id/pay', markRentAsPaid);

module.exports = router;
