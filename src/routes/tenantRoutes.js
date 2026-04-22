const express = require('express');
const {
  searchTenants, getTenants, getTenant, createTenant, updateTenant, vacateTenant,
  getTenantAdvance, applyTenantAdvance, refundTenantAdvance,
  adjustDeposit, refundDeposit,
  fixBillingStart,
  getTenantProfile,
  vacateWithPayment,
} = require('../controllers/tenantController');
const { getTenantRentHistory } = require('../controllers/rentController');
const { mergeTenants } = require('../controllers/mergeTenantController');
const { protect } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

router.use(protect);

// Must come before /:id to avoid Express treating literal strings as id params
router.get('/search', searchTenants);
router.post('/merge', mergeTenants);

router.route('/').get(getTenants).post(createTenant);
router.route('/:id').get(getTenant).put(updateTenant).delete(vacateTenant);

// Rent history for a specific tenant
router.get('/:tenantId/rents', getTenantRentHistory);

// Reservation advance
router.get( '/:tenantId/advance',        getTenantAdvance);
router.post('/:tenantId/advance/apply',  applyTenantAdvance);
router.post('/:tenantId/advance/refund', refundTenantAdvance);

// Security deposit
router.post('/:tenantId/deposit/adjust', adjustDeposit);
router.post('/:tenantId/deposit/refund', refundDeposit);

// Billing start correction (admin escape hatch for immutable billingStartDate)
router.patch('/:id/fix-billing-start', fixBillingStart);

// Aggregated profile endpoint (replaces 4 separate calls)
router.get('/:id/profile', getTenantProfile);

// Atomic vacate + optional payment
router.post('/:id/vacate-with-payment', vacateWithPayment);

module.exports = router;
