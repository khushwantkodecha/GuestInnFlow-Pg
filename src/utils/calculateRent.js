/**
 * @deprecated  Direct imports to this file still work but are discouraged.
 *
 * The authoritative implementation now lives in:
 *   /shared/calculateRent.js
 *
 * All backend modules should prefer:
 *   const { calculateRent, MIN_RENT } = require('../../shared/calculateRent')
 *
 * This shim exists solely for backward compatibility with any module that
 * already imports from this path and has not been updated yet.
 */
module.exports = require('../../shared/calculateRent');
