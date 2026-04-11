const express = require('express');
const {
  generateMonthlyRent,
  getAllRents,
  getPendingRents,
  getOverdueRents,
  getTenantRentHistory,
  markRentAsPaid,
} = require('../controllers/rentController');
const { protect } = require('../middleware/auth');

// Mounted at /api/properties/:propertyId/rents
const router = express.Router({ mergeParams: true });

router.use(protect);

// Named filters — must come before /:id to avoid route shadowing
router.get('/pending', getPendingRents);
router.get('/overdue', getOverdueRents);

router.route('/').get(getAllRents);
router.post('/generate', generateMonthlyRent);
router.patch('/:id/pay', markRentAsPaid);

module.exports = router;
