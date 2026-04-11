const express = require('express');
const { getOwnerDashboard, getPropertyDashboard } = require('../controllers/dashboardController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/', getOwnerDashboard);
router.get('/property/:propertyId', getPropertyDashboard);

module.exports = router;
