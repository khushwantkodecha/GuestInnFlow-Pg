const express = require('express');
const { getPropertyDashboard, getRecentActivity } = require('../controllers/dashboardController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/property/:propertyId', getPropertyDashboard);
router.get('/property/:propertyId/recent-activity', getRecentActivity);

module.exports = router;
