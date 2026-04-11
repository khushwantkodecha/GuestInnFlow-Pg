const express = require('express');
const { getTenants, getTenant, createTenant, updateTenant, vacateTenant } = require('../controllers/tenantController');
const { getTenantRentHistory } = require('../controllers/rentController');
const { protect } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

router.use(protect);

router.route('/').get(getTenants).post(createTenant);
router.route('/:id').get(getTenant).put(updateTenant).delete(vacateTenant);

// Rent history for a specific tenant
router.get('/:tenantId/rents', getTenantRentHistory);

module.exports = router;
