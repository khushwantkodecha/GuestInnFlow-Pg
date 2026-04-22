/**
 * systemInvariant.spec.ts — Core ledger invariant tests
 *
 * The central invariant of the financial engine is:
 *   Σ(balance-affecting debits) − Σ(balance-affecting credits) === currentBalance
 *
 * This must hold at every point in time, after every operation.
 * Deposit audit entries (deposit_collected, deposit_adjusted, etc.) are excluded
 * from the sum because they record the deposit lifecycle without moving the rent
 * balance.
 *
 * SI-01  Invariant holds after rent generation
 * SI-02  Invariant holds after full payment
 * SI-03  Invariant holds after partial payment
 * SI-04  Invariant holds after overpayment (negative balance)
 * SI-05  Invariant holds after manual charge
 * SI-06  Invariant holds after payment reversal
 * SI-07  Invariant holds after deposit adjustment at vacate
 * SI-08  Invariant holds after multi-month rent generation
 * SI-09  No entry has a negative amount
 * SI-10  No unknown referenceType exists in the ledger
 */

import { test, expect } from '@playwright/test'
import { TestEnv, currentMonthYear, firstOfMonthISO } from './helpers/seed'
import * as api from './helpers/api'
import * as a   from './helpers/assertions'

// ─────────────────────────────────────────────────────────────────────────────

test.describe('SI-01 — Invariant After Rent Generation', () => {
  test('sum of ledger entries equals currentBalance after generateRent', async ({ request }) => {
    const suffix = `SI01-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 9000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 9000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)

    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 9000)
  })
})

test.describe('SI-02 — Invariant After Full Payment', () => {
  test('invariant holds after exact payment clears all dues', async ({ request }) => {
    const suffix = `SI02-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 7500)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 7500,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 7500 })

    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)
  })
})

test.describe('SI-03 — Invariant After Partial Payment', () => {
  test('invariant holds with remaining dues', async ({ request }) => {
    const suffix = `SI03-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 3000 })

    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 5000)
  })
})

test.describe('SI-04 — Invariant After Overpayment (Negative Balance)', () => {
  test('invariant holds when balance goes negative (advance credit)', async ({ request }) => {
    const suffix = `SI04-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 10_000 })

    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, -2000)
  })
})

test.describe('SI-05 — Invariant After Manual Charge', () => {
  test('invariant holds after adding multiple charges', async ({ request }) => {
    const suffix = `SI05-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 8000 })

    // Add 3 charges
    await api.addCharge(request, env.token, env.propertyId, tenantId, { amount: 300, description: 'Water' })
    await api.addCharge(request, env.token, env.propertyId, tenantId, { amount: 250, description: 'Electricity' })
    await api.addCharge(request, env.token, env.propertyId, tenantId, { amount: 150, description: 'WiFi' })

    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 700)
  })
})

test.describe('SI-06 — Invariant After Payment Reversal', () => {
  test('invariant holds after reversing a payment', async ({ request }) => {
    const suffix = `SI06-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    const { paymentId } = await api.recordPayment(request, env.token, env.propertyId, {
      tenantId, amount: 8000,
    })
    await api.reversePayment(request, env.token, env.propertyId, paymentId, 'SI-06 test')

    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 8000)
  })
})

test.describe('SI-07 — Invariant After Deposit Adjustment at Vacate', () => {
  test('deposit audit entries do not corrupt the invariant', async ({ request }) => {
    const suffix = `SI07-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      deposit:      20_000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)

    // Invariant after deposit_collected audit entry
    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)

    await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      depositAction: 'adjust_and_refund',
      refundMethod:  'cash',
    })

    // Invariant after deposit_adjusted + deposit_refunded audit entries
    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)
  })
})

test.describe('SI-08 — Invariant Across Multiple Months', () => {
  test('invariant holds after generating rent for two months with payments', async ({ request }) => {
    const suffix = `SI08-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 6000)
    const now    = new Date()
    const month  = now.getMonth() + 1
    const year   = now.getFullYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 6000,
      moveInDate:   `${year}-${String(month).padStart(2, '0')}-01`,
    })

    // Month 1: generate + partial pay
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 4000 })

    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)

    // Month 2: generate + full pay (pays off month1 arrears + month2)
    const nextMonth = month === 12 ? 1 : month + 1
    const nextYear  = month === 12 ? year + 1 : year
    await api.generateRent(request, env.token, env.propertyId, nextMonth, nextYear)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 8000 })

    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
  })
})

test.describe('SI-09 — No Entry Has a Negative Amount', () => {
  test('all ledger entry amounts are >= 0 after a complex sequence', async ({ request }) => {
    const suffix = `SI09-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      deposit:      10_000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.addCharge(request, env.token, env.propertyId, tenantId, { amount: 500, description: 'Water' })
    const { paymentId } = await api.recordPayment(request, env.token, env.propertyId, {
      tenantId, amount: 4000,
    })
    await api.reversePayment(request, env.token, env.propertyId, paymentId)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 8500 })

    const ledger = await api.getTenantLedger(request, env.token, env.propertyId, tenantId)
    for (const entry of ledger.entries) {
      if (entry.referenceType !== 'billing_start_corrected') {
        expect(entry.amount, `Entry ${entry.referenceType} has negative amount`).toBeGreaterThanOrEqual(0)
      }
    }

    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
  })
})

test.describe('SI-10 — No Unknown referenceType in Ledger', () => {
  test('every ledger entry has a recognized referenceType', async ({ request }) => {
    const suffix = `SI10-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      deposit:      5000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.addCharge(request, env.token, env.propertyId, tenantId, { amount: 200 })
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 8200 })

    const ledger = await api.getTenantLedger(request, env.token, env.propertyId, tenantId)
    for (const entry of ledger.entries) {
      expect(
        a.KNOWN_REFERENCE_TYPES.has(entry.referenceType),
        `Unknown referenceType "${entry.referenceType}" found in ledger (entry id: ${entry._id})`,
      ).toBe(true)
    }
  })
})
