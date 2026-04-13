/**
 * numberingUtils.js
 *
 * Bed label generator used by roomController and bedController.
 *
 * Styles:
 *   alphabet → A, B, C, …, Z, AA, AB, … (Excel-style, unlimited)
 *   numeric  → 1, 2, 3, …
 *
 * Extra beds always use X1, X2 — handled directly in bedController.
 */

/**
 * Generates a bed label for a given 0-based index.
 *
 * @param {'alphabet'|'numeric'} style
 * @param {number} index  0-based position
 * @returns {string}
 */
const generateBedLabel = (style, index) => {
  if (style === 'numeric') return String(index + 1);

  // Default: alphabet  (Excel-column algorithm — A, B, …, Z, AA, AB, …)
  let label = '';
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
};

module.exports = { generateBedLabel };
