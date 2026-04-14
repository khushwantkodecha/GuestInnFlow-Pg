const express = require('express');
const {
  getInvoices,
  getInvoice,
  downloadInvoicePdf,
  getInvoiceShareMessage,
  generateInvoicesManual,
  voidInvoiceHandler,
} = require('../controllers/invoiceController');
const { protect } = require('../middleware/auth');

// Mounted at /api/properties/:propertyId/invoices
const router = express.Router({ mergeParams: true });

router.use(protect);

// Generate invoices for a billing cycle (idempotent)
router.post('/generate', generateInvoicesManual);

// List + filter
router.get('/', getInvoices);

// Single invoice + actions
router.get( '/:id',        getInvoice);
router.get( '/:id/pdf',    downloadInvoicePdf);
router.get( '/:id/share',  getInvoiceShareMessage);
router.post('/:id/void',   voidInvoiceHandler);

module.exports = router;
