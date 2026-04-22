/**
 * concurrency.spec.ts — Race condition and concurrent-operation tests
 *
 * CON-01  Two simultaneous full payments — balance should settle at 0, not go
 *         negative (one is applied, the other becomes advance)
 * CON-02  Simultaneous payment + charge — no corruption; balance = charge amount - payment
 * CON-03  Rapid repeated UI "Collect" button clicks — duplicate-submission guard
 *         ensures only one payment is recorded
 * CON-04  Two simultaneous generate-rent calls — idempotent; only one rent record created
 * CON-05  Simultaneous partial payments summing to full rent — both land, balance = 0
 */

import { test, expect } from '@playwright/test'
import { TestEnv, currentMonthYear, firstOfMonthISO } from './helpers/seed'
import * as api from './helpers/api'
import * as a   from './helpers/assertions'

// ─────────────────────────────────────────────────────────────────────────────

test.describe('CON-01 — Simultaneous Full Payments (Two Concurrent Requests)', () => {
  test('two concurrent ₹8,000 payments applied; balance = −₹8,000 (one becomes advance)', async ({ request }) => {
    const suffix = `CON01-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)

    // Fire both payments simultaneously
    const [r1, r2] = await Promise.all([
      api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 8000, method: 'cash' }),
      api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 8000, method: 'upi'  }),
    ])

    // Both succeeded — IDs must differ
    expect(r1.paymentId).not.toBe(r2.paymentId)

    // Total: ₹16,000 received against ₹8,000 rent → advance = −₹8,000
    const balance = await api.getCurrentBalance(request, env.token, env.propertyId, tenantId)
    expect(balance).toBe(-8000)

    // Ledger must have exactly 2 payment_received entries
    const payEntries = await a.getLedgerEntriesByType(
      request, env.token, env.propertyId, tenantId, 'payment_received',
    )
    expect(payEntries.length).toBe(2)

    // Chain consistency — no phantom entries
    await a.assertLedgerChainConsistency(request, env.token, env.propertyId, tenantId)
  })
})

test.describe('CON-02 — Simultaneous Charge and Payment', () => {
  test('concurrent addCharge + recordPayment do not corrupt the balance', async ({ request }) => {
    const suffix = `CON02-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)

    // Concurrently: add ₹500 charge AND pay ₹8,000
    await Promise.all([
      api.addCharge(request, env.token, env.propertyId, tenantId, {
        amount: 500, description: 'Water',
      }),
      api.recordPayment(request, env.token, env.propertyId, {
        tenantId, amount: 8000, method: 'cash',
      }),
    ])

    // Final balance = ₹8,000 rent + ₹500 charge − ₹8,000 paid = ₹500
    const balance = await api.getCurrentBalance(request, env.token, env.propertyId, tenantId)
    // Either order of DB writes: charge may have landed before or after payment
    // Invariant: balance = sum(debits) − sum(credits) regardless
    const debits  = 8000 + 500
    const credits = 8000
    expect(balance).toBe(debits - credits) // 500

    // Chain consistency
    await a.assertLedgerChainConsistency(request, env.token, env.propertyId, tenantId)
  })
})

test.describe('CON-03 — Rapid Repeated UI Button Clicks (Duplicate Submission Guard)', () => {
  test('clicking Collect button rapidly only records one payment', async ({ request, page }) => {
    const suffix = `CON03-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 5000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 5000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)

    await a.injectAuth(page, env.token, env.propertyId)
    await a.gotoRentPage(page)
    await page.reload()
    await expect(page.locator('h2:has-text("Rent Collection")')).toBeVisible({ timeout: 15_000 })

    // Find the Collect button for this tenant's row
    const rows = page.locator('tr')
    const rowCount = await rows.count()
    let collectBtn = null
    for (let i = 1; i < rowCount; i++) {
      const row = rows.nth(i)
      const nameText = await row.locator('td').first().textContent()
      if (nameText && nameText.includes(`Tenant ${suffix}`)) {
        collectBtn = row.locator('button:has-text("Collect")')
        break
      }
    }
    expect(collectBtn).not.toBeNull()
    await expect(collectBtn!).toBeVisible({ timeout: 5_000 })

    // Click Collect to open modal
    await collectBtn!.click()
    await expect(page.locator('text=Collect Payment')).toBeVisible({ timeout: 8_000 })

    // Fill amount and submit — but click the submit button rapidly (3× times)
    const amtInput = page.locator('input[type="number"][min="1"]').first()
    await amtInput.clear()
    await amtInput.fill('5000')

    // Select cash
    await page.locator('button:has-text("cash")').first().click()

    const submitBtn = page.locator('button[type="submit"]').first()
    // Rapid triple-click
    await submitBtn.click()
    await submitBtn.click().catch(() => {/* may be hidden by then */})
    await submitBtn.click().catch(() => {/* may be hidden by then */})

    // Wait for modal to close
    await expect(page.locator('text=Collect Payment')).toBeHidden({ timeout: 12_000 })

    // Only ONE payment_received entry should exist
    const payEntries = await a.getLedgerEntriesByType(
      request, env.token, env.propertyId, tenantId, 'payment_received',
    )
    expect(payEntries.length).toBe(1)
    expect(payEntries[0].amount).toBe(5000)

    // Balance = 0
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)
  })
})

test.describe('CON-04 — Simultaneous Generate Rent (Idempotency)', () => {
  test('two concurrent generate-rent calls produce exactly one rent record', async ({ request }) => {
    const suffix = `CON04-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      moveInDate:   firstOfMonthISO(),
    })

    // Both generate calls fire simultaneously
    const results = await Promise.allSettled([
      api.generateRent(request, env.token, env.propertyId, month, year),
      api.generateRent(request, env.token, env.propertyId, month, year),
    ])

    // At least one must succeed; the other may succeed (0 created) or fail
    const successes = results.filter(r => r.status === 'fulfilled')
    expect(successes.length).toBeGreaterThanOrEqual(1)

    // Exactly one rent record for this month
    const rents = await api.getTenantRents(request, env.token, env.propertyId, tenantId)
    const thisMonthRents = rents.filter(r => r.month === month && r.year === year)
    expect(thisMonthRents.length).toBe(1)

    // Ledger: exactly one rent_generated debit
    const rentEntries = await a.getLedgerEntriesByType(
      request, env.token, env.propertyId, tenantId, 'rent_generated',
    )
    expect(rentEntries.length).toBe(1)

    // Chain consistency
    await a.assertLedgerChainConsistency(request, env.token, env.propertyId, tenantId)
  })
})

test.describe('CON-05 — Simultaneous Partial Payments Summing to Full Rent', () => {
  test('₹3,000 + ₹5,000 simultaneously applied; final balance = 0', async ({ request }) => {
    const suffix = `CON05-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)

    // Fire ₹3,000 + ₹5,000 simultaneously
    const [p1, p2] = await Promise.all([
      api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 3000, method: 'cash' }),
      api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 5000, method: 'upi'  }),
    ])

    expect(p1.paymentId).not.toBe(p2.paymentId)

    // Final balance = ₹8,000 − ₹8,000 = 0
    const balance = await api.getCurrentBalance(request, env.token, env.propertyId, tenantId)
    expect(balance).toBe(0)

    // Two payment entries
    const payEntries = await a.getLedgerEntriesByType(
      request, env.token, env.propertyId, tenantId, 'payment_received',
    )
    expect(payEntries.length).toBe(2)
    const totalPaid = payEntries.reduce((s, e) => s + e.amount, 0)
    expect(totalPaid).toBe(8000)

    // Chain consistency
    await a.assertLedgerChainConsistency(request, env.token, env.propertyId, tenantId)
  })
})
