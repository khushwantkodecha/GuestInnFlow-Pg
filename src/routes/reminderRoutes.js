const express = require('express');
const {
  getLogs, getStats, getSettings, updateSettings, triggerDailyRun, sendToTenant,
} = require('../controllers/reminderController');
const { protect } = require('../middleware/auth');

// Mounted at /api/properties/:propertyId/reminders
const router = express.Router({ mergeParams: true });

router.use(protect);

router.get('/stats',    getStats);
router.get('/settings', getSettings);
router.put('/settings', updateSettings);
router.post('/trigger', triggerDailyRun);
router.post('/send',    sendToTenant);
router.get('/',         getLogs);

module.exports = router;
