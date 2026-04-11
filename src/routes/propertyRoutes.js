const express = require('express');
const {
  getProperties,
  getAllProperties,
  getAllPropertyStats,
  getProperty,
  getPropertyStats,
  getPropertyAnalytics,
  createProperty,
  updateProperty,
  deleteProperty,
  permanentDeleteProperty,
  reactivateProperty,
} = require('../controllers/propertyController');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { createPropertySchema, updatePropertySchema } = require('../validation/propertySchemas');

const router = express.Router({ mergeParams: true });

router.use(protect);

// Collection routes — must be before /:id
router.route('/').get(getProperties).post(validate(createPropertySchema), createProperty);
router.get('/all',        getAllProperties);
router.get('/stats/all',  getAllPropertyStats);   // batch stats for all properties

// Single-property routes — static segments before /:id
router.get('/:id/stats',      getPropertyStats);
router.get('/:id/analytics',  getPropertyAnalytics);
router.delete('/:id/permanent', permanentDeleteProperty);
router.route('/:id').get(getProperty).put(validate(updatePropertySchema), updateProperty).delete(deleteProperty);
router.patch('/:id/reactivate', reactivateProperty);

module.exports = router;
