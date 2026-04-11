const express = require('express');
const { getIncomeReport, getPendingRentReport, getExpenseReport } = require('../controllers/reportController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/income', getIncomeReport);
router.get('/pending-rent', getPendingRentReport);
router.get('/expenses', getExpenseReport);

module.exports = router;
