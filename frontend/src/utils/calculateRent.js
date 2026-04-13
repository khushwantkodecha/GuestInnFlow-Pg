/**
 * Shared Rent Engine — frontend entry point
 *
 * This file re-exports the shared engine from /shared/calculateRent.js.
 * There is NO logic here. The single source of truth is the shared module.
 *
 * @shared  →  /shared/calculateRent.js  (alias configured in vite.config.js)
 *
 * ⚠️  DO NOT add any logic to this file.
 *      All changes must go to /shared/calculateRent.js so backend and frontend
 *      remain guaranteed to run identical calculations.
 */
// @shared/calculateRent uses CommonJS (module.exports).
// Vite exposes CJS module.exports properties as named ESM exports — we
// re-export them directly instead of using a default import.
export { calculateRent, MIN_RENT } from '@shared/calculateRent'
