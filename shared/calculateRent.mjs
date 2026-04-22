/**
 * calculateRent — Shared Rent Engine  [ESM edition for Vite/frontend]
 *
 * This file is the ESM mirror of calculateRent.js (CJS).
 *   Backend  → require('../../shared/calculateRent')     [uses .js]
 *   Frontend → import from '@shared/calculateRent'       [alias → this file]
 *
 * ⚠️  KEEP IN SYNC WITH calculateRent.js (the CJS source).
 *      All logic changes must be applied to BOTH files — only module syntax differs.
 *      This file exists solely because Vite cannot transform CJS outside node_modules.
 */

/** Safety floor — prevents absurdly low splits in large dorms */
export const MIN_RENT = 500;

function result(finalRent, source, meta = {}) {
  return { finalRent, source, meta };
}

/**
 * @param {Object} params
 * @param {Object} params.room            - { baseRent }
 * @param {Object} params.bed             - { isExtra, isChargeable, extraCharge, rentOverride }
 * @param {number} params.normalOccupied  - Not used for per_bed; kept for API compatibility.
 * @param {Object} [params.options]
 */
export function calculateRent({ room, bed, normalOccupied, options = {} }) {
  // ── 1. Rent Override (Highest Priority) ────────────────────────────────────
  if (bed.rentOverride != null) {
    return result(bed.rentOverride, 'override');
  }

  // ── 2. Extra Bed Logic ─────────────────────────────────────────────────────
  if (bed.isExtra) {
    if (!bed.isChargeable) {
      return result(0, 'extra_free');
    }
    if (bed.extraCharge > 0) {
      return result(bed.extraCharge, 'extra_custom');
    }
    return result(room.baseRent, 'extra_fallback');
  }

  // ── 3. Per Bed ─────────────────────────────────────────────────────────────
  let rent = room.baseRent;
  if (rent > 0 && rent < MIN_RENT) rent = MIN_RENT;
  return result(rent, 'per_bed');
}
