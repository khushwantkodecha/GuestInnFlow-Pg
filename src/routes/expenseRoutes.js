const express = require('express');
const {
  addExpense,
  getExpenses,
  editExpense,
  deleteExpense,
  approveExpense,
  rejectExpense,
  toggleRecurring,
  generateMissed,
  getAnalytics,
} = require('../controllers/expenseController');
const { protect } = require('../middleware/auth');

// Mounted at /api/properties/:propertyId/expenses
const router = express.Router({ mergeParams: true });

router.use(protect);

router.get('/analytics',                getAnalytics);
router.route('/').get(getExpenses).post(addExpense);

// Specific sub-resource routes before generic /:id to avoid ambiguity
router.patch('/:id/approve',            approveExpense);
router.patch('/:id/reject',             rejectExpense);
router.patch('/:id/toggle-recurring',   toggleRecurring);
router.post('/:id/generate-missed',     generateMissed);

// Generic expense mutations
router.patch('/:id',                    editExpense);
router.delete('/:id',                   deleteExpense);

module.exports = router;
