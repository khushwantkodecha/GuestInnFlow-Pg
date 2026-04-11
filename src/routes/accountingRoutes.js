const express = require('express');
const { getOverview, getCashFlow, getChartData } = require('../controllers/accountingController');
const { protect } = require('../middleware/auth');

// Mounted at /api/properties/:propertyId/accounting
const router = express.Router({ mergeParams: true });

router.use(protect);

router.get('/overview',  getOverview);
router.get('/cashflow',  getCashFlow);
router.get('/chart',     getChartData);

module.exports = router;
