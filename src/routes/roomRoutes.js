const express = require('express');
const { getRooms, getRoom, createRoom, updateRoom, deleteRoom } = require('../controllers/roomController');
const { getRoomAnalytics, getRoomFinancials, getRoomActivity } = require('../controllers/bedController');
const { protect } = require('../middleware/auth');
const bedRouter = require('./bedRoutes');
const validate = require('../middleware/validate');
const { createRoomSchema, updateRoomSchema } = require('../validation/roomSchemas');

const router = express.Router({ mergeParams: true });

router.use(protect);

// Forward nested bed routes: /properties/:propertyId/rooms/:roomId/beds
router.use('/:roomId/beds', bedRouter);

router.route('/').get(getRooms).post(validate(createRoomSchema), createRoom);
router.route('/:id').get(getRoom).put(validate(updateRoomSchema), updateRoom).delete(deleteRoom);

// GET /api/properties/:propertyId/rooms/:id/analytics
router.get('/:id/analytics', getRoomAnalytics);

// GET /api/properties/:propertyId/rooms/:id/financials
router.get('/:id/financials', getRoomFinancials);

// GET /api/properties/:propertyId/rooms/:id/activity
router.get('/:id/activity', getRoomActivity);

module.exports = router;
