const express = require('express');
const router  = express.Router();
const { protectSuperAdmin } = require('../middleware/superAdminAuth');
const {
  login,
  getMe,
  getPlatformStats,
  getOwners,
  getOwner,
  toggleOwnerStatus,
  deleteOwner,
  getAllProperties,
  updateOwnerPlan,
  getPlans,
  updatePlan,
} = require('../controllers/superAdminController');

// ── Public ────────────────────────────────────────────────────────────────────
router.post('/login', login);

// ── Protected — all routes below require superadmin token ─────────────────────
router.use(protectSuperAdmin);

router.get('/me', getMe);

// Stats
router.get('/stats', getPlatformStats);

// Owners
router.get('/owners',              getOwners);
router.get('/owners/:id',          getOwner);
router.patch('/owners/:id/status', toggleOwnerStatus);
router.patch('/owners/:id/plan',   updateOwnerPlan);
router.delete('/owners/:id',       deleteOwner);

// Properties
router.get('/properties', getAllProperties);

// Plans
router.get('/plans',          getPlans);
router.patch('/plans/:key',   updatePlan);

module.exports = router;
