/**
 * charges.spec.ts — Manual charge tests
 *
 * TC-C01  Add single charge
 * TC-C02  Multiple charges stack correctly
 * TC-C03  Payment covers rent then charges (oldest-first allocation)
 * TC-C04  Charge added after payment — not retroactively settled
 *
 * Strategy:
 *  - Rent and charge setup via API
 *  - TC-C01: add charge via UI ("Add Charge" button in ledger drawer)
 *  - TC-C02/C03/C04: add charges via API, verify via API + UI
 */

import { test, expect } from '@playwright/test'
import { TestEnv, currentMonthYear, firstOfMonthISO } from './helpers/seed'
import * as api from './helpers/api'
import * as a   from './helpers/assertions'

// ─────────────────────────────────────────────────────────────────────────────

test.describe('TC-C01 — Add Single Charge via UI', () => {
  test('adds a ₹500 electricity charge and updates ledger balance to ₹500', async ({ page, request }) => {
    const suffix = `C01-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    // Setup: tenant with rent fully paid (balance = 0)
    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.recordPayment(request, env.token, env.propertyId, {
      tenantId, amount: 8000, method: 'cash',
    })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    const tenantName = (await api.getTenantById(request, env.token, env.propertyId, tenantId))['name'] as string

    // ── UI: open ledger drawer, click Add Charge ──────────────────────────────
    await a.injectAuth(page, env.token, env.propertyId)
    await a.gotoRentPage(page)

    // Click the ChevronRight (View ledger) button for this tenant's row
    const row = page.locator('tr').filter({ hasText: tenantName })
    await row.locator('button[title="View ledger"]').click()
    await expect(page.locator('text=Payment Ledger')).toBeVisible({ timeout: 8_000 })

    // Click Add Charge button
    await page.locator('button:has-text("Add Charge")').click()
    await expect(page.locator('text=Add Charge').nth(1)).toBeVisible({ timeout: 5_000 })

    // Fill in charge details
    await page.locator('input[placeholder="e.g. 500"]').fill('500')
    await page.locator('input[placeholder*="Electricity"]').fill('Electricity bill')

    // Submit
    await page.locator('button[type="submit"]:has-text("Add Charge")').click()
    await expect(page.locator('text=Add Charge').nth(1)).toBeHidden({ timeout: 8_000 })

    // ── API: verify ledger shows ₹500 debit, balance = ₹500 ──────────────────
    await a.assertLastLedgerEntry(request, env.token, env.propertyId, tenantId, {
      type:   'debit',
      amount: 500,
      balanceAfter: 500,
    })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 500)
  })
})

test.describe('TC-C02 — Multiple Charges Stack', () => {
  test('three charges accumulate correctly in the ledger', async ({ request }) => {
    const suffix = `C02-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)

    const { tenantId } = await env.createAssignedTenant({ rentOverride: 8000 })
    // No rent generated — start from clean balance of 0

    await api.addCharge(request, env.token, env.propertyId, tenantId, { amount: 500,  description: 'Electricity' })
    await api.addCharge(request, env.token, env.propertyId, tenantId, { amount: 200,  description: 'Water' })
    await api.addCharge(request, env.token, env.propertyId, tenantId, { amount: 1000, description: 'Laundry' })

    // ── API: balance = ₹1,700 ─────────────────────────────────────────────────
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 1700)

    // ── API: ledger has 3 debit entries ───────────────────────────────────────
    const ledger = await api.getTenantLedger(request, env.token, env.propertyId, tenantId)
    // Filter out any deposit_collected entry from assignment
    const chargeEntries = ledger.entries.filter(e => e.type === 'debit' && e.referenceType !== 'deposit_collected' && e.referenceType !== 'rent_generated')
    expect(chargeEntries.length).toBe(3)

    // Running balance check (entries are newest-first)
    // Entry 0 = laundry, balance 1700
    // Entry 1 = water,   balance  700
    // Entry 2 = elec,    balance  500
    expect(chargeEntries[0].amount).toBe(1000)
    expect(chargeEntries[0].balanceAfter).toBe(1700)
    expect(chargeEntries[1].amount).toBe(200)
    expect(chargeEntries[1].balanceAfter).toBe(700)
    expect(chargeEntries[2].amount).toBe(500)
    expect(chargeEntries[2].balanceAfter).toBe(500)
  })
})

test.describe('TC-C03 — Payment Covers Rent Then Charges (Oldest-First)', () => {
  test('one payment clears rent first, then charges, reaching zero balance', async ({ request }) => {
    const suffix = `C03-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 6000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 6000,
      moveInDate:   firstOfMonthISO(),
    })

    // Setup: ₹6,000 rent + ₹500 + ₹200 charges = ₹6,700 total
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.addCharge(request, env.token, env.propertyId, tenantId, { amount: 500, description: 'Electricity' })
    await api.addCharge(request, env.token, env.propertyId, tenantId, { amount: 200, description: 'Water' })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 6700)

    // ── API: pay ₹6,700 — should clear everything ────────────────────────────
    const { advanceApplied } = await api.recordPayment(request, env.token, env.propertyId, {
      tenantId,
      amount: 6700,
      method: 'cash',
    })

    // No advance (exact payment)
    expect(advanceApplied).toBe(0)

    // ── API: balance = 0 ──────────────────────────────────────────────────────
    await a.assertLastLedgerEntry(request, env.token, env.propertyId, tenantId, {
      type:          'credit',
      referenceType: 'payment_received',
      amount:        6700,
      balanceAfter:  0,
    })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    // ── API: rent record is paid ──────────────────────────────────────────────
    await a.assertRentRecord(request, env.token, env.propertyId, tenantId, month, year, {
      status:     'paid',
      paidAmount: 6000,
    })
  })
})

test.describe('TC-C04 — Charge Added After Payment Does Not Auto-Apply', () => {
  test('charge added after full payment reopens balance without touching past payment', async ({ request }) => {
    const suffix = `C04-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      moveInDate:   firstOfMonthISO(),
    })

    // Setup: generate rent and fully pay it
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 8000, method: 'cash' })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    // ── Add a new charge AFTER the payment ────────────────────────────────────
    await api.addCharge(request, env.token, env.propertyId, tenantId, {
      amount:      300,
      description: 'Damage repair',
    })

    // ── API: new balance = ₹300 (prior payment NOT auto-applied) ─────────────
    await a.assertLastLedgerEntry(request, env.token, env.propertyId, tenantId, {
      type:         'debit',
      amount:       300,
      balanceAfter: 300,
    })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 300)

    // Rent record remains paid
    await a.assertRentRecord(request, env.token, env.propertyId, tenantId, month, year, {
      status: 'paid',
    })
  })
})
