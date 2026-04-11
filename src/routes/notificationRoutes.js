const express = require('express');
const { sendRentReminder, sendBulkRentReminders } = require('../controllers/notificationController');
const { protect } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

router.use(protect);

router.post('/rent-reminder', sendRentReminder);
router.post('/rent-reminder/bulk', sendBulkRentReminders);

module.exports = router;
