/**
 * calculateRent — Shared Rent Engine  [ESM edition for Vite/frontend]
 *
 * This file is the ESM mirror of calculateRent.js (CJS).
 *   Backend  → require('../../shared/calculateRent')     [uses .js]
 *   Frontend → import from '@shared/calculateRent'       [alias → this file]
 *
 * ⚠️  KEEP IN SYNC WITH calculateRent.js.
 *      All logic changes must be applied to BOTH files.
 */

/** Safety floor — prevents absurdly low splits in large dorms */
export const MIN_RENT = 500;

function result(finalRent, source, meta = {}) {
  return { finalRent, source, meta };
}

/**
 * @param {Object} params
 * @param {Object} params.room            - { baseRent, rentType: 'per_bed'|'per_room' }
 * @param {Object} params.bed             - { isExtra, isChargeable, extraCharge, rentOverride }
 * @param {number} params.normalOccupied
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
  if (room.rentType === 'per_bed') {
    let rent = room.baseRent;
    if (rent > 0 && rent < MIN_RENT) rent = MIN_RENT;
    return result(rent, 'per_bed');
  }

  // ── 4. Per Room (Split) ────────────────────────────────────────────────────
  if (room.rentType === 'per_room') {
    const divisor = Math.max(normalOccupied, 1);
    let rent      = Math.floor(room.baseRent / divisor);
    if (rent > 0 && rent < MIN_RENT) rent = MIN_RENT;
    return result(rent, 'per_room_split', { divisor });
  }

  // ── Fallback (unknown rentType) ────────────────────────────────────────────
  let rent = room.baseRent;
  if (rent > 0 && rent < MIN_RENT) rent = MIN_RENT;
  return result(rent, 'per_bed');
}
