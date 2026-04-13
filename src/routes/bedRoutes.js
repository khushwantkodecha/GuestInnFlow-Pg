const express = require('express');
const {
  getBeds, getBed, createBed, createExtraBed, updateBed, deleteBed,
  assignBed, vacateCheck, vacateBed, reserveBed, cancelReservation, blockBed, unblockBed,
  changeBed, getRoomAnalytics, bulkBlockBeds, bulkUnblockBeds, bulkVacateBeds, rentPreview,
} = require('../controllers/bedController');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { assignBedSchema, reserveBedSchema, extraBedSchema, bulkBedSchema } = require('../validation/bedSchemas');

const router = express.Router({ mergeParams: true });
router.use(protect);

// ── IMPORTANT: /extra and /bulk/* must be registered BEFORE /:id to avoid route clash ──
router.post('/extra', validate(extraBedSchema), createExtraBed);

// ── Bulk operations ──────────────────────────────────────────────────────────
router.patch('/bulk/block',   validate(bulkBedSchema), bulkBlockBeds);
router.patch('/bulk/unblock', validate(bulkBedSchema), bulkUnblockBeds);
router.patch('/bulk/vacate',  validate(bulkBedSchema), bulkVacateBeds);

router.route('/').get(getBeds).post(createBed);
router.route('/:id').get(getBed).put(updateBed).delete(deleteBed);

router.patch('/:id/assign',      validate(assignBedSchema),  assignBed);
router.patch('/:id/change-room', changeBed);
router.get(  '/:id/vacate-check', vacateCheck);
router.get(  '/:id/rent-preview', rentPreview);
router.patch('/:id/vacate',    vacateBed);
router.patch('/:id/checkout',  vacateBed);           // backward compat
router.patch('/:id/reserve',   validate(reserveBedSchema), reserveBed);
router.patch('/:id/unreserve', cancelReservation);
router.patch('/:id/block',     blockBed);
router.patch('/:id/unblock',   unblockBed);

module.exports = router;
