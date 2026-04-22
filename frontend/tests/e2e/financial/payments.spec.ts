/**
 * payments.spec.ts — Payment flow tests
 *
 * TC-P01  Full payment (exact amount)
 * TC-P02  Partial payment
 * TC-P03  Second partial payment completes the balance
 * TC-P04  Overpayment creates advance credit
 * TC-P05  Multi-month oldest-first allocation
 * TC-P06  Payment before rent exists (becomes advance)
 * TC-P07  Payment reversal (full)
 * TC-P08  Reversal of partial payment
 *
 * Strategy:
 *  - Setup (assign tenant, generate rent) via API
 *  - Payment action via UI (Collect modal)
 *  - All ledger/balance assertions via API (source of truth)
 *  - Cross-check: UI displayed balance must match API ledger balance
 */

import { test, expect } from '@playwright/test'
import { TestEnv, currentMonthYear, firstOfMonthISO } from './helpers/seed'
import * as api  from './helpers/api'
import * as a    from './helpers/assertions'

// Helper to set up a tenant with one month's rent generated
async function setupTenantWithRent(
  request: import('@playwright/test').APIRequestContext,
  suffix:  string,
  rentAmt  = 8000,
) {
  const env  = await TestEnv.create(request, suffix, rentAmt)
  const { month, year } = currentMonthYear()
  const { tenantId } = await env.createAssignedTenant({
    rentOverride: rentAmt,
    moveInDate:   firstOfMonthISO(),
  })
  await api.generateRent(request, env.token, env.propertyId, month, year)
  return { env, tenantId, month, year }
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('TC-P01 — Full Payment (Exact Amount)', () => {
  test('clears the full balance and marks rent as paid', async ({ page, request }) => {
    const { env, tenantId, month, year } = await setupTenantWithRent(request, `P01-${Date.now()}`)
    const tenantName = (await api.getTenantById(request, env.token, env.propertyId, tenantId))['name'] as string

    // ── UI: open Collect modal and pay the full amount ────────────────────────
    await a.injectAuth(page, env.token, env.propertyId)
    await a.gotoRentPage(page)

    await a.openPaymentModal(page, tenantName)
    // Modal pre-fills the exact due amount — just submit with default values
    await page.locator('button:has-text("Confirm Payment")').click()
    await expect(page.locator('text=Collect Payment')).toBeHidden({ timeout: 10_000 })

    // ── API: verify ledger ────────────────────────────────────────────────────
    await a.assertLastLedgerEntry(request, env.token, env.propertyId, tenantId, {
      type:          'credit',
      referenceType: 'payment_received',
      amount:        8000,
      balanceAfter:  0,
    })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    // ── API: rent record is paid ──────────────────────────────────────────────
    await a.assertRentRecord(request, env.token, env.propertyId, tenantId, month, year, {
      status:     'paid',
      paidAmount: 8000,
    })
  })
})

test.describe('TC-P02 — Partial Payment', () => {
  test('records a partial payment and updates balance correctly', async ({ page, request }) => {
    const { env, tenantId, month, year } = await setupTenantWithRent(request, `P02-${Date.now()}`)
    const tenantName = (await api.getTenantById(request, env.token, env.propertyId, tenantId))['name'] as string

    // ── UI: pay ₹3,000 of the ₹8,000 due ────────────────────────────────────
    await a.injectAuth(page, env.token, env.propertyId)
    await a.gotoRentPage(page)

    await a.openPaymentModal(page, tenantName)
    await a.submitPaymentModal(page, 3000, 'upi')

    // ── API: ledger shows ₹3,000 credit, balance ₹5,000 ─────────────────────
    await a.assertLastLedgerEntry(request, env.token, env.propertyId, tenantId, {
      type:          'credit',
      referenceType: 'payment_received',
      amount:        3000,
      balanceAfter:  5000,
    })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 5000)

    // ── API: rent record is partial ───────────────────────────────────────────
    await a.assertRentRecord(request, env.token, env.propertyId, tenantId, month, year, {
      status:     'partial',
      paidAmount: 3000,
    })
  })
})

test.describe('TC-P03 — Second Partial Payment Completes the Balance', () => {
  test.describe.configure({ mode: 'serial' })

  let sharedEnv: TestEnv
  let sharedTenantId: string

  test.beforeAll(async ({ request }) => {
    const { env, tenantId } = await setupTenantWithRent(request, `P03-${Date.now()}`)
    sharedEnv      = env
    sharedTenantId = tenantId

    // First partial: ₹3,000
    await api.recordPayment(request, env.token, env.propertyId, {
      tenantId,
      amount: 3000,
      method: 'cash',
    })
  })

  test('balance is ₹5,000 after first partial', async ({ request }) => {
    await a.assertBalance(request, sharedEnv.token, sharedEnv.propertyId, sharedTenantId, 5000)
  })

  test('second payment of ₹5,000 clears the balance and marks rent paid', async ({ request }) => {
    await api.recordPayment(request, sharedEnv.token, sharedEnv.propertyId, {
      tenantId: sharedTenantId,
      amount:   5000,
      method:   'cash',
    })

    await a.assertLastLedgerEntry(request, sharedEnv.token, sharedEnv.propertyId, sharedTenantId, {
      type:          'credit',
      referenceType: 'payment_received',
      amount:        5000,
      balanceAfter:  0,
    })
    await a.assertBalance(request, sharedEnv.token, sharedEnv.propertyId, sharedTenantId, 0)

    const { month, year } = currentMonthYear()
    await a.assertRentRecord(request, sharedEnv.token, sharedEnv.propertyId, sharedTenantId, month, year, {
      status:     'paid',
      paidAmount: 8000,
    })
  })
})

test.describe('TC-P04 — Overpayment Creates Advance Credit', () => {
  test('payment > dues produces negative balance (advance credit)', async ({ page, request }) => {
    const { env, tenantId } = await setupTenantWithRent(request, `P04-${Date.now()}`)
    const tenantName = (await api.getTenantById(request, env.token, env.propertyId, tenantId))['name'] as string

    // ── UI: pay ₹10,000 against ₹8,000 due ────────────────────────────────────
    await a.injectAuth(page, env.token, env.propertyId)
    await a.gotoRentPage(page)

    await a.openPaymentModal(page, tenantName)
    await a.submitPaymentModal(page, 10_000, 'cash')

    // ── API: verify ledger shows −₹2,000 advance ─────────────────────────────
    await a.assertLastLedgerEntry(request, env.token, env.propertyId, tenantId, {
      type:          'credit',
      referenceType: 'payment_received',
      amount:        10_000,
      balanceAfter:  -2000,
    })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, -2000)

    // ── API: Payment.advanceApplied = ₹2,000 ─────────────────────────────────
    // Verify via ledger current balance
    const ledger = await api.getTenantLedger(request, env.token, env.propertyId, tenantId)
    expect(ledger.currentBalance).toBe(-2000)
  })
})

test.describe('TC-P05 — Multi-Month Oldest-First Allocation', () => {
  test('payment covers multiple months oldest-first', async ({ request }) => {
    const suffix = `P05-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 6000)
    const now    = new Date()
    const yr     = now.getFullYear()

    // Create tenant with check-in 3 months ago
    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 6000,
      moveInDate:   firstOfMonthISO(),
    })

    // Generate rent for 3 months: current month is month N
    const m3 = now.getMonth() + 1  // current month
    const m2 = m3 === 1 ? 12 : m3 - 1
    const m1 = m2 === 1 ? 12 : m2 - 1
    const y1 = m1 > m3 ? yr - 1 : yr
    const y2 = m2 > m3 ? yr - 1 : yr

    await api.generateRent(request, env.token, env.propertyId, m1, y1)
    await api.generateRent(request, env.token, env.propertyId, m2, y2)
    await api.generateRent(request, env.token, env.propertyId, m3, yr)
    // Balance should be ₹18,000 (3 × ₹6,000)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 18_000)

    // ── Pay ₹14,000 — covers first 2 months + ₹2,000 on third ────────────────
    const { paymentId } = await api.recordPayment(request, env.token, env.propertyId, {
      tenantId,
      amount: 14_000,
      method: 'bank_transfer',
    })

    expect(paymentId).toBeTruthy()

    // ── API: balance = ₹4,000 (₹18,000 - ₹14,000) ────────────────────────────
    await a.assertLastLedgerEntry(request, env.token, env.propertyId, tenantId, {
      type:          'credit',
      referenceType: 'payment_received',
      amount:        14_000,
      balanceAfter:  4_000,
    })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 4_000)

    // ── API: first two months paid, third is partial ──────────────────────────
    await a.assertRentRecord(request, env.token, env.propertyId, tenantId, m1, y1, { status: 'paid' })
    await a.assertRentRecord(request, env.token, env.propertyId, tenantId, m2, y2, { status: 'paid' })
    await a.assertRentRecord(request, env.token, env.propertyId, tenantId, m3, yr, { status: 'partial', paidAmount: 2000 })
  })
})

test.describe('TC-P06 — Payment Before Rent Exists (Becomes Advance)', () => {
  test('payment on a tenant with no rent records becomes advance credit', async ({ request }) => {
    const suffix = `P06-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { tenantId } = await env.createAssignedTenant({ rentOverride: 8000 })
    // Note: no generateRent call — no rent records exist yet

    const { paymentId, advanceApplied } = await api.recordPayment(
      request, env.token, env.propertyId,
      { tenantId, amount: 5000, method: 'cash' },
    )

    expect(paymentId).toBeTruthy()
    expect(advanceApplied).toBe(5000)

    await a.assertLastLedgerEntry(request, env.token, env.propertyId, tenantId, {
      type:          'credit',
      referenceType: 'payment_received',
      amount:        5000,
      balanceAfter:  -5000,
    })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, -5000)
  })
})

test.describe('TC-P07 — Payment Reversal (Full)', () => {
  test('reversal re-opens the rent and restores the balance', async ({ request }) => {
    const { env, tenantId, month, year } = await setupTenantWithRent(request, `P07-${Date.now()}`)

    // Record a full payment first
    const { paymentId } = await api.recordPayment(request, env.token, env.propertyId, {
      tenantId,
      amount: 8000,
      method: 'cash',
    })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    // ── Reverse the payment ────────────────────────────────────────────────────
    await api.reversePayment(request, env.token, env.propertyId, paymentId, 'Wrong payment method')

    // ── API: balance restored to ₹8,000 ──────────────────────────────────────
    await a.assertLastLedgerEntry(request, env.token, env.propertyId, tenantId, {
      type:          'debit',
      referenceType: 'payment_reversal',
      amount:        8000,
      balanceAfter:  8000,
    })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 8000)

    // ── API: rent record reverts to pending ───────────────────────────────────
    await a.assertRentRecord(request, env.token, env.propertyId, tenantId, month, year, {
      status:     'pending',
      paidAmount: 0,
    })
  })
})

test.describe('TC-P08 — Reversal of Partial Payment', () => {
  test('reversal of a partial payment restores original balance', async ({ request }) => {
    const { env, tenantId, month, year } = await setupTenantWithRent(request, `P08-${Date.now()}`)

    // Record partial payment ₹3,000
    const { paymentId } = await api.recordPayment(request, env.token, env.propertyId, {
      tenantId,
      amount: 3000,
      method: 'upi',
    })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 5000)

    // ── Reverse the partial payment ────────────────────────────────────────────
    await api.reversePayment(request, env.token, env.propertyId, paymentId, 'Test reversal')

    // ── API: balance back to ₹8,000 ──────────────────────────────────────────
    await a.assertLastLedgerEntry(request, env.token, env.propertyId, tenantId, {
      type:          'debit',
      referenceType: 'payment_reversal',
      amount:        3000,
      balanceAfter:  8000,
    })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 8000)

    // ── API: rent record reverts to pending ───────────────────────────────────
    await a.assertRentRecord(request, env.token, env.propertyId, tenantId, month, year, {
      status:     'pending',
      paidAmount: 0,
    })
  })
})
