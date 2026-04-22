/**
 * assertions.ts — Custom financial assertion helpers
 *
 * Wraps API + Playwright expect() into reusable, expressive assertions that
 * describe WHAT the financial invariant is, not HOW to check it.
 */

import { expect, type APIRequestContext, type Page } from '@playwright/test'
import * as api from './api'

// ─── API Assertions ───────────────────────────────────────────────────────────

/**
 * Asserts the tenant's current ledger balance matches the expected value.
 *
 * The balance convention is: positive = owes money, negative = advance credit.
 */
export async function assertBalance(
  request:         APIRequestContext,
  token:           string,
  propertyId:      string,
  tenantId:        string,
  expectedBalance: number,
): Promise<void> {
  const balance = await api.getCurrentBalance(request, token, propertyId, tenantId)
  expect(balance, `Ledger balance should be ${expectedBalance}`).toBe(expectedBalance)
}

/**
 * Asserts the most-recent ledger entry matches all provided fields.
 * Pass only the fields you want to verify — undefined fields are skipped.
 */
export async function assertLastLedgerEntry(
  request:    APIRequestContext,
  token:      string,
  propertyId: string,
  tenantId:   string,
  expected: {
    type?:          'debit' | 'credit'
    referenceType?: string
    amount?:        number
    balanceAfter?:  number
  },
): Promise<void> {
  const entry = await api.getLastLedgerEntry(request, token, propertyId, tenantId)
  expect(entry, 'Expected at least one ledger entry').not.toBeNull()
  if (!entry) return

  if (expected.type !== undefined)
    expect(entry.type,          `entry.type`).toBe(expected.type)
  if (expected.referenceType !== undefined)
    expect(entry.referenceType, `entry.referenceType`).toBe(expected.referenceType)
  if (expected.amount !== undefined)
    expect(entry.amount,        `entry.amount`).toBe(expected.amount)
  if (expected.balanceAfter !== undefined)
    expect(entry.balanceAfter,  `entry.balanceAfter`).toBe(expected.balanceAfter)
}

/**
 * Asserts the total number of ledger entries for a tenant.
 */
export async function assertLedgerCount(
  request:       APIRequestContext,
  token:         string,
  propertyId:    string,
  tenantId:      string,
  expectedCount: number,
): Promise<void> {
  const ledger = await api.getTenantLedger(request, token, propertyId, tenantId)
  expect(ledger.entries.length, `Expected ${expectedCount} ledger entries`).toBe(expectedCount)
}

/**
 * Returns all entries matching the given referenceType (newest first).
 */
export async function getLedgerEntriesByType(
  request:       APIRequestContext,
  token:         string,
  propertyId:    string,
  tenantId:      string,
  referenceType: string,
): Promise<api.LedgerEntry[]> {
  const ledger = await api.getTenantLedger(request, token, propertyId, tenantId)
  return ledger.entries.filter(e => e.referenceType === referenceType)
}

/**
 * Asserts the rent record for a specific month has the expected status and amounts.
 */
export async function assertRentRecord(
  request:    APIRequestContext,
  token:      string,
  propertyId: string,
  tenantId:   string,
  month:      number,
  year:       number,
  expected: {
    status?:     string
    amount?:     number
    paidAmount?: number
  },
): Promise<void> {
  const rents = await api.getTenantRents(request, token, propertyId, tenantId)
  const rent  = rents.find(r => r.month === month && r.year === year)

  expect(rent, `Expected rent record for ${month}/${year}`).toBeDefined()
  if (!rent) return

  if (expected.status !== undefined)
    expect(rent.status,     `rent.status`).toBe(expected.status)
  if (expected.amount !== undefined)
    expect(rent.amount,     `rent.amount`).toBe(expected.amount)
  if (expected.paidAmount !== undefined)
    expect(rent.paidAmount, `rent.paidAmount`).toBe(expected.paidAmount)
}

// ─── UI Assertions ────────────────────────────────────────────────────────────

/**
 * Injects auth and property selection into localStorage before page load.
 * Call this inside page.addInitScript() or before page.goto().
 */
export async function injectAuth(
  page:       Page,
  token:      string,
  propertyId: string,
): Promise<void> {
  await page.addInitScript(
    ({ t, pid }) => {
      localStorage.setItem('token', t)
      localStorage.setItem('selectedPropertyId', pid)
    },
    { t: token, pid: propertyId },
  )
}

/**
 * Navigates to the Rent page and waits for it to fully load.
 * Returns after the rent table or empty-state is visible.
 */
export async function gotoRentPage(page: Page): Promise<void> {
  await page.goto('/rent')
  // Wait for either the table header or empty state to confirm the page rendered
  await page.waitForSelector(
    'text=Rent Collection, text=No rent records, button:has-text("Generate")',
    { timeout: 15_000 },
  ).catch(() => {/* page may already be visible */})
  // More reliable: wait for the heading
  await expect(page.locator('h2:has-text("Rent Collection")')).toBeVisible({ timeout: 15_000 })
}

/**
 * Navigates to the Tenants page and waits for it to load.
 */
export async function gotoTenantsPage(page: Page): Promise<void> {
  await page.goto('/tenants')
  await expect(page.getByRole('heading', { name: 'Tenants', exact: false })).toBeVisible({ timeout: 15_000 })
}

/**
 * Clicks the "Collect" button in the rent table for the row matching
 * the given tenant name. Waits for the payment modal to open.
 */
export async function openPaymentModal(page: Page, tenantName: string): Promise<void> {
  // Find the row that contains the tenant name, then click its Collect button
  const row = page.locator('tr').filter({ hasText: tenantName })
  await row.locator('button:has-text("Collect")').click()
  await expect(page.locator('text=Collect Payment')).toBeVisible({ timeout: 8_000 })
}

/**
 * Fills and submits the payment modal.
 *
 * @param amount - amount to enter (leaves the pre-filled value if undefined)
 * @param method - 'cash' | 'upi' | 'bank_transfer' | 'cheque' (default: cash)
 */
export async function submitPaymentModal(
  page:    Page,
  amount?: number,
  method   = 'cash',
): Promise<void> {
  // Clear and set amount if provided
  if (amount !== undefined) {
    const amtInput = page.locator('input[type="number"][min="1"]').first()
    await amtInput.clear()
    await amtInput.fill(String(amount))
  }

  // Select payment method (buttons: 'cash', 'upi', 'bank transfer', 'cheque')
  const methodLabel = method.replace('_', ' ')
  await page.locator(`button:has-text("${methodLabel}")`).click()

  // Submit — button text varies: "Confirm Payment" / "Record Partial" / "Record + Advance"
  const submitBtn = page.locator('button[type="submit"].btn-primary')
  await submitBtn.click()

  // Wait for modal to close (success)
  await expect(page.locator('text=Collect Payment')).toBeHidden({ timeout: 10_000 })
}

/**
 * Asserts that the rent row for a tenant shows the expected status badge.
 * statusText examples: 'Paid', 'Pending', 'Partial', 'Overdue'
 */
export async function assertRentRowStatus(
  page:       Page,
  tenantName: string,
  statusText: string,
): Promise<void> {
  const row = page.locator('tr').filter({ hasText: tenantName })
  await expect(row).toBeVisible({ timeout: 8_000 })
  await expect(row).toContainText(statusText)
}

// ─── UI Balance Helpers ───────────────────────────────────────────────────────

/**
 * Opens the TenantLedger drawer for the named tenant (via the "View ledger"
 * button in the rent table), reads the displayed balance, and returns it as a
 * signed number matching the API convention:
 *   positive = outstanding dues
 *   negative = advance credit
 *   0        = fully settled
 *
 * Assumes the page is already on /rent.
 * Closes the drawer before returning so subsequent calls work correctly.
 */
export async function readUIBalance(
  page:       Page,
  tenantName: string,
): Promise<number> {
  // Open ledger drawer
  const row = page.locator('tr').filter({ hasText: tenantName })
  await row.locator('button[title="View ledger"]').click()

  // Wait for the balance block — identified by the amount paragraph's classes
  const amountEl = page.locator('p.text-lg.font-bold.tabular-nums').first()
  await expect(amountEl).toBeVisible({ timeout: 8_000 })

  // Determine sign from the label text
  const advanceLabelVisible     = await page.locator('text=Advance Credit').isVisible()
  const outstandingLabelVisible = await page.locator('text=Outstanding Balance').isVisible()
  const settledLabelVisible     = await page.locator('text=Fully Settled').isVisible()

  let multiplier = 1
  if (advanceLabelVisible)     multiplier = -1
  else if (settledLabelVisible) multiplier = 0  // we'll force to 0 below

  // Parse the formatted amount (e.g. "₹8,000" → 8000)
  const rawText = await amountEl.textContent() ?? '0'
  const digits  = rawText.replace(/[₹,\s]/g, '')
  const absVal  = parseFloat(digits) || 0

  // Fully Settled always = 0, regardless of displayed amount
  const balance = settledLabelVisible ? 0 : multiplier * absVal

  // Close the drawer — look for a close button or press Escape
  const closeBtn = page.locator('button[aria-label="Close"], button[title="Close"]').first()
  if (await closeBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await closeBtn.click()
  } else {
    await page.keyboard.press('Escape')
  }

  // Wait for drawer to disappear
  await expect(amountEl).toBeHidden({ timeout: 5_000 }).catch(() => {/* drawer may persist */})

  return balance
}

/**
 * Cross-validates that the balance displayed in the UI matches the API balance.
 *
 * Convenience wrapper over readUIBalance + assertBalance that fails with a
 * clear message if they diverge.
 */
export async function assertUIMatchesAPIBalance(
  page:       Page,
  request:    APIRequestContext,
  token:      string,
  propertyId: string,
  tenantId:   string,
  tenantName: string,
): Promise<void> {
  const [apiBalance, uiBalance] = await Promise.all([
    api.getCurrentBalance(request, token, propertyId, tenantId),
    readUIBalance(page, tenantName),
  ])
  expect(
    uiBalance,
    `UI balance (${uiBalance}) should match API balance (${apiBalance}) for tenant "${tenantName}"`,
  ).toBe(apiBalance)
}

// ─── Ledger Invariant Helpers ────────────────────────────────────────────────

/**
 * Deposit entries are written to the ledger as audit markers.
 * They have a non-zero `amount` field but DO NOT change the running rent
 * balance (balanceAfter stays the same before and after these entries).
 *
 * deposit_collected  — recorded when tenant checks in (audit only)
 * deposit_adjusted   — recorded when deposit is applied against dues (audit)
 * deposit_refunded   — recorded when deposit is returned to tenant (audit)
 * deposit_forfeited  — recorded when deposit is forfeited at vacate (audit)
 */
export const AUDIT_ONLY_TYPES = new Set([
  'deposit_collected',
  'deposit_adjusted',
  'deposit_refunded',
  'deposit_forfeited',
])

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Asserts the full ledger entry sequence matches the provided expected entries
 * in order from oldest to newest.  Each entry only checks the fields provided
 * (undefined = skip).  Useful for vacate snapshot validation.
 */
export async function assertLedgerSequence(
  request:    APIRequestContext,
  token:      string,
  propertyId: string,
  tenantId:   string,
  expected: Array<{
    type?:          'debit' | 'credit'
    referenceType?: string
    amount?:        number
    balanceAfter?:  number
  }>,
): Promise<void> {
  const ledger  = await api.getTenantLedger(request, token, propertyId, tenantId)
  // API returns newest-first; reverse to oldest-first for sequence assertion
  const entries = [...ledger.entries].reverse()

  expect(
    entries.length,
    `Expected ${expected.length} ledger entries but got ${entries.length}`,
  ).toBeGreaterThanOrEqual(expected.length)

  // Match expected entries from the tail of the sequence (most-recent operations)
  const tail = entries.slice(entries.length - expected.length)

  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i]
    const got = tail[i]

    if (exp.type          !== undefined) expect(got.type,          `entry[${i}].type`).toBe(exp.type)
    if (exp.referenceType !== undefined) expect(got.referenceType, `entry[${i}].referenceType`).toBe(exp.referenceType)
    if (exp.amount        !== undefined) expect(got.amount,        `entry[${i}].amount`).toBe(exp.amount)
    if (exp.balanceAfter  !== undefined) expect(got.balanceAfter,  `entry[${i}].balanceAfter`).toBe(exp.balanceAfter)
  }
}

/**
 * Asserts that the running balanceAfter chain in the ledger is internally
 * consistent: each entry's balanceAfter correctly reflects the preceding
 * balance ± the entry's amount.
 *
 * Deposit audit entries (AUDIT_ONLY_TYPES) do NOT change the rent balance;
 * they carry the current balance unchanged in their balanceAfter field.
 */
export async function assertLedgerChainConsistency(
  request:    APIRequestContext,
  token:      string,
  propertyId: string,
  tenantId:   string,
): Promise<void> {
  const ledger  = await api.getTenantLedger(request, token, propertyId, tenantId)
  const entries = [...ledger.entries].reverse() // oldest-first

  let runningBalance = 0
  for (const entry of entries) {
    // Audit-only entries don't move the rent balance — skip the arithmetic
    if (!AUDIT_ONLY_TYPES.has(entry.referenceType)) {
      if (entry.type === 'debit') {
        runningBalance += entry.amount
      } else {
        runningBalance -= entry.amount
      }
    }
    expect(
      entry.balanceAfter,
      `Ledger chain broken at ${entry.referenceType} (id=${entry._id}): ` +
      `expected balanceAfter=${runningBalance}, got ${entry.balanceAfter}`,
    ).toBe(runningBalance)
  }
}

/**
 * Core system invariant:
 *   Σ(balance-affecting debits) − Σ(balance-affecting credits) === currentBalance
 *
 * Additionally verifies chain consistency and that no entry has a negative amount.
 * Call this after any sequence of financial operations to assert the entire
 * ledger is self-consistent.
 */
export async function assertSystemInvariant(
  request:    APIRequestContext,
  token:      string,
  propertyId: string,
  tenantId:   string,
): Promise<void> {
  const ledger  = await api.getTenantLedger(request, token, propertyId, tenantId)
  const entries = [...ledger.entries].reverse() // oldest-first

  // 1. Sum invariant — only balance-affecting entries count
  const computed = entries
    .filter(e => !AUDIT_ONLY_TYPES.has(e.referenceType))
    .reduce((sum, e) => sum + (e.type === 'debit' ? e.amount : -e.amount), 0)

  expect(
    computed,
    `System invariant violated: Σ(ledger entries) = ${computed} ≠ API currentBalance = ${ledger.currentBalance}`,
  ).toBe(ledger.currentBalance)

  // 2. Every entry amount is non-negative
  for (const entry of entries) {
    if (entry.referenceType !== 'billing_start_corrected') {
      expect(
        entry.amount,
        `Entry ${entry.referenceType} (id=${entry._id}) has negative amount ${entry.amount}`,
      ).toBeGreaterThanOrEqual(0)
    }
  }

  // 3. Chain consistency (reuses the same entries, no extra API call needed)
  let runningBalance = 0
  for (const entry of entries) {
    if (!AUDIT_ONLY_TYPES.has(entry.referenceType)) {
      runningBalance += entry.type === 'debit' ? entry.amount : -entry.amount
    }
    expect(
      entry.balanceAfter,
      `Chain broken at ${entry.referenceType}: expected ${runningBalance}, got ${entry.balanceAfter}`,
    ).toBe(runningBalance)
  }
}

/**
 * Known valid referenceType values from the canonical LedgerEntry enum.
 * Used by data-safety tests to verify no phantom/orphan entries exist.
 */
export const KNOWN_REFERENCE_TYPES = new Set([
  // Active
  'rent_generated', 'payment_received', 'payment_reversal', 'manual_charge',
  'advance_applied', 'advance_refunded',
  'deposit_collected', 'deposit_adjusted', 'deposit_refunded', 'deposit_forfeited',
  'reservation_paid', 'reservation_adjusted', 'reservation_refunded', 'reservation_forfeited',
  'billing_start_corrected',
  // Legacy aliases (kept for backwards-compat)
  'rent_charge', 'rent_payment', 'deposit_payment', 'deposit_refund', 'advance_credit',
])
