const express = require('express');
const {
  addExpense,
  getExpenses,
  deleteExpense,
  approveExpense,
  rejectExpense,
  toggleRecurring,
  getAnalytics,
} = require('../controllers/expenseController');
const { protect } = require('../middleware/auth');

// Mounted at /api/properties/:propertyId/expenses
const router = express.Router({ mergeParams: true });

router.use(protect);

router.get('/analytics',           getAnalytics);
router.route('/').get(getExpenses).post(addExpense);
router.delete('/:id',              deleteExpense);
router.patch('/:id/approve',       approveExpense);
router.patch('/:id/reject',        rejectExpense);
router.patch('/:id/toggle-recurring', toggleRecurring);

module.exports = router;
