'use strict';

/**
 * calculateRent — Shared Rent Engine (Single Source of Truth)
 *
 * This is the ONLY implementation of rent calculation logic in the system.
 * Both backend (Node/Express) and frontend (Vite/React) consume this file
 * directly — there are no copies or mirrors.
 *
 * ─── Consumers ────────────────────────────────────────────────────────────────
 *  Backend  →  require('../../shared/calculateRent')
 *  Frontend →  import from '@shared/calculateRent'   (alias in vite.config.js)
 *
 * ─── Rule ─────────────────────────────────────────────────────────────────────
 *  ⚠️  NEVER modify this file without verifying both consumers.
 *      All rent logic MUST live here and ONLY here.
 *
 * @param {Object} params
 * @param {Object} params.room            - { baseRent: number, rentType: 'per_bed'|'per_room' }
 * @param {Object} params.bed             - { isExtra: boolean, isChargeable: boolean,
 *                                            extraCharge: number, rentOverride: number|null }
 * @param {number} params.normalOccupied  - Count of normal (non-extra) occupied beds.
 *                                          Must NEVER include extra beds.
 *                                          For per_room: include the incoming tenant (+1 pre-applied).
 * @param {Object} [params.options]       - Reserved for future flags (e.g. { dryRun: true })
 *
 * @returns {{
 *   finalRent: number,
 *   source:    'override' | 'extra_free' | 'extra_custom' | 'extra_fallback' | 'per_bed' | 'per_room_split',
 *   meta:      Object    — { divisor: number } for per_room_split, {} otherwise
 * }}
 */

/** Safety floor — prevents absurdly low splits in large dorms */
const MIN_RENT = 500;

/**
 * Internal factory for a typed result object.
 * @param {number} finalRent
 * @param {string} source
 * @param {Object} [meta={}]
 */
function result(finalRent, source, meta = {}) {
  return { finalRent, source, meta };
}

function calculateRent({ room, bed, normalOccupied, options = {} }) {
  // ── 1. Rent Override (Highest Priority) ────────────────────────────────────
  // A per-bed override wins over all other logic, including extra-bed rules.
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
    // Fallback: charge room's base rent (no MIN_RENT floor for extra beds)
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

module.exports = { calculateRent, MIN_RENT };
