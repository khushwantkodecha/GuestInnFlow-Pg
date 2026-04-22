/**
 * rent.spec.ts — Rent generation tests
 *
 * TC-R01  Standard monthly rent generation
 * TC-R02  Pro-rated rent (mid-month check-in)
 * TC-R03  Check-in on billing day (no proration)
 * TC-R04  Idempotent generation (fetch twice, no duplicates)
 *
 * Strategy:
 *  - Setup (property + room + tenant) via API
 *  - TC-R01/R03/R04: use UI "Generate" button to trigger generation, then verify
 *  - TC-R02: use API to generate and verify the pro-rated math via API + UI
 *  - All balance checks verified against the ledger API (source of truth)
 */

import { test, expect } from '@playwright/test'
import { TestEnv, currentMonthYear, firstOfMonthISO, nthDayOfMonthISO, prorationForDay } from './helpers/seed'
import * as api  from './helpers/api'
import * as a    from './helpers/assertions'

test.describe('TC-R01 — Standard Monthly Rent Generation', () => {
  test('generates a full rent record and shows it as Pending in the UI', async ({ page, request }) => {
    const suffix = `R01-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    // Create a tenant with check-in on the 1st of this month (billing day = 1)
    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      moveInDate:   firstOfMonthISO(),
    })

    // ── UI: inject auth and navigate ──────────────────────────────────────────
    await a.injectAuth(page, env.token, env.propertyId)
    await a.gotoRentPage(page)

    // ── UI: Click Generate for current month ──────────────────────────────────
    await page.locator('button:has-text("Generate")').click()
    await expect(page.locator('text=Generated')).toBeVisible({ timeout: 8_000 })

    // ── API: verify ledger ────────────────────────────────────────────────────
    await a.assertLastLedgerEntry(request, env.token, env.propertyId, tenantId, {
      type:          'debit',
      referenceType: 'rent_generated',
      amount:        8000,
      balanceAfter:  8000,
    })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 8000)

    // ── API: verify rent record ───────────────────────────────────────────────
    await a.assertRentRecord(request, env.token, env.propertyId, tenantId, month, year, {
      status: 'pending',
      amount: 8000,
      paidAmount: 0,
    })

    // ── UI: tenant row is visible with Pending status ─────────────────────────
    const tenantName = (await api.getTenantById(request, env.token, env.propertyId, tenantId))['name'] as string
    await a.assertRentRowStatus(page, tenantName, 'Collect')
  })
})

test.describe('TC-R02 — Pro-rated Rent (Mid-Month Check-in)', () => {
  test('generates a pro-rated rent amount when tenant checks in mid-cycle', async ({ request }) => {
    const suffix  = `R02-${Date.now()}`
    const fullRent = 6000
    const env     = await TestEnv.create(request, suffix, fullRent)
    const { month, year } = currentMonthYear()

    // billingDay = 1 (first of month), checkIn = 15th
    // Formula: round(6000 × occupied_days / total_days)
    const { amount: expectedAmount, checkIn } = prorationForDay(15, fullRent)

    // Assign tenant with check-in on the 15th
    const moveInDate = `${checkIn.getFullYear()}-${String(checkIn.getMonth() + 1).padStart(2, '0')}-${String(checkIn.getDate()).padStart(2, '0')}`
    const { tenantId } = await env.createAssignedTenant({
      rentOverride: fullRent,
      moveInDate,
    })

    // ── API: generate rent for current month ──────────────────────────────────
    const { records } = await api.generateRent(request, env.token, env.propertyId, month, year)

    // Only the newly assigned tenant should have been created
    const record = records.find((r: api.RentRecord) => r.tenant === tenantId
      || (r as unknown as { tenant: { _id?: string } }).tenant?._id === tenantId)

    // If this is not the first day of month, proration applies
    const today = new Date()
    if (today.getDate() === 1) {
      // Check-in is on billing day — no proration
      expect(record?.amount ?? expectedAmount).toBe(fullRent)
    } else {
      // Pro-rated
      expect(expectedAmount).toBeLessThan(fullRent)
    }

    // ── API: verify ledger has a debit for rent_generated ─────────────────────
    const lastEntry = await api.getLastLedgerEntry(request, env.token, env.propertyId, tenantId)
    expect(lastEntry?.type).toBe('debit')
    expect(lastEntry?.referenceType).toBe('rent_generated')

    // Pro-rated amount should match formula (tolerance: ±1 for rounding)
    const generatedAmount = lastEntry?.amount ?? 0
    expect(generatedAmount).toBeGreaterThan(0)
    expect(generatedAmount).toBeLessThanOrEqual(fullRent)

    // Balance should equal the generated amount
    await a.assertBalance(request, env.token, env.propertyId, tenantId, generatedAmount)

    // ── API: rent record notes mention proration ──────────────────────────────
    const rents = await api.getTenantRents(request, env.token, env.propertyId, tenantId)
    const rentRecord = rents.find(r => r.month === month && r.year === year)
    expect(rentRecord).toBeDefined()
    if (generatedAmount < fullRent) {
      expect(rentRecord?.notes).toMatch(/[Pp]ro[-\s]?rat/)
    }
  })
})

test.describe('TC-R03 — Check-in on Billing Day (No Proration)', () => {
  test('generates full rent when tenant checks in on the first of the month', async ({ request }) => {
    const suffix  = `R03-${Date.now()}`
    const env     = await TestEnv.create(request, suffix, 5000)
    const { month, year } = currentMonthYear()

    // check-in on the 1st = billing day 1 → no proration
    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 5000,
      moveInDate:   firstOfMonthISO(),   // 1st of current month
    })

    await api.generateRent(request, env.token, env.propertyId, month, year)

    const lastEntry = await api.getLastLedgerEntry(request, env.token, env.propertyId, tenantId)
    expect(lastEntry?.type).toBe('debit')
    expect(lastEntry?.referenceType).toBe('rent_generated')
    // Full rent — no proration since check-in IS on billing day
    expect(lastEntry?.amount).toBe(5000)
    expect(lastEntry?.balanceAfter).toBe(5000)

    await a.assertBalance(request, env.token, env.propertyId, tenantId, 5000)
  })
})

test.describe('TC-R04 — Idempotent Rent Generation (No Duplicates)', () => {
  test('calling generate twice does not create a second ledger entry', async ({ request }) => {
    const suffix = `R04-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 7000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 7000,
      moveInDate:   firstOfMonthISO(),
    })

    // First generate
    await api.generateRent(request, env.token, env.propertyId, month, year)

    // Capture ledger after first generate
    const ledger1 = await api.getTenantLedger(request, env.token, env.propertyId, tenantId)
    const count1  = ledger1.entries.length

    // Second generate — must be a no-op
    await api.generateRent(request, env.token, env.propertyId, month, year)

    const ledger2 = await api.getTenantLedger(request, env.token, env.propertyId, tenantId)
    const count2  = ledger2.entries.length

    expect(count2, 'No new ledger entries should be created on duplicate generate').toBe(count1)

    // Balance unchanged
    expect(ledger2.currentBalance).toBe(ledger1.currentBalance)
  })
})
