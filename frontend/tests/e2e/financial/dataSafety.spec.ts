/**
 * dataSafety.spec.ts — Data integrity and financial safety invariants
 *
 * These tests verify properties that MUST hold across the entire system,
 * not just at a single operation boundary.
 *
 * DS-01  depositBalance is never negative (after any sequence of operations)
 * DS-02  deposit_refunded entries appear at most once per deposit lifecycle
 * DS-03  No orphan ledger entries (every entry tied to a known tenant)
 * DS-04  Deposit status is consistent with depositBalance
 * DS-05  Payment reversal does not leave ledger with phantom credits
 * DS-06  Advance balance cannot be made negative through charges
 * DS-07  Tenant balance is correct after a full deposit adjust + vacate chain
 * DS-08  Total payments received = total credits in ledger (payment_received entries)
 */

import { test, expect } from '@playwright/test'
import { TestEnv, currentMonthYear, firstOfMonthISO } from './helpers/seed'
import * as api from './helpers/api'
import * as a   from './helpers/assertions'

// ─────────────────────────────────────────────────────────────────────────────

test.describe('DS-01 — Deposit Balance Never Negative', () => {
  test('partial refund does not push depositBalance below 0', async ({ request }) => {
    const suffix = `DS01-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      deposit:      5000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 8000 })

    // Attempt a partial refund that would succeed
    await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      depositAction: 'refund',
      refundAmount:  3000,
      refundMethod:  'cash',
    })

    const tenant = await api.getTenantById(request, env.token, env.propertyId, tenantId)
    expect(tenant['depositBalance']).toBeGreaterThanOrEqual(0)
    expect(tenant['depositBalance']).toBe(2000) // ₹5,000 - ₹3,000

    // Attempt to over-refund — should be blocked
    let errorCode = ''
    try {
      // Tenant is already vacated so this should fail, but if it didn't, the
      // over-refund validation would catch it
      await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
        depositAction: 'refund',
        refundAmount:  5000,   // more than remaining ₹2,000
        refundMethod:  'cash',
      })
    } catch (err: unknown) {
      errorCode = (err as { code?: string }).code ?? 'ERROR'
    }
    expect(errorCode).not.toBe('')  // must be blocked

    // depositBalance is still >= 0 (2000)
    const tenantAfter = await api.getTenantById(request, env.token, env.propertyId, tenantId)
    expect(tenantAfter['depositBalance']).toBeGreaterThanOrEqual(0)
  })
})

test.describe('DS-02 — deposit_refunded Appears At Most Once', () => {
  test('only one deposit_refunded entry per complete refund', async ({ request }) => {
    const suffix = `DS02-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 6000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 6000,
      deposit:      8000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 6000 })

    // Full deposit refund
    await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      depositAction: 'refund',
      refundAmount:  8000,
      refundMethod:  'upi',
    })

    const refundEntries = await a.getLedgerEntriesByType(
      request, env.token, env.propertyId, tenantId, 'deposit_refunded',
    )
    // Exactly one refund entry
    expect(refundEntries.length).toBe(1)
    expect(refundEntries[0].amount).toBe(8000)

    // depositBalance = 0, status = 'refunded'
    const tenant = await api.getTenantById(request, env.token, env.propertyId, tenantId)
    expect(tenant['depositBalance']).toBe(0)
    expect(tenant['depositStatus']).toBe('refunded')
  })
})

test.describe('DS-03 — Deposit Status Consistent with depositBalance', () => {
  test.describe('status=held → depositBalance > 0', () => {
    test('after partial adjustment, status is held and balance > 0', async ({ request }) => {
      const suffix = `DS03a-${Date.now()}`
      const env    = await TestEnv.create(request, suffix, 8000)
      const { month, year } = currentMonthYear()

      const { tenantId } = await env.createAssignedTenant({
        rentOverride: 8000,
        deposit:      20_000,
        moveInDate:   firstOfMonthISO(),
      })
      await api.generateRent(request, env.token, env.propertyId, month, year)

      const result = await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
        depositAction: 'adjust',   // clears ₹8,000 dues; ₹12,000 surplus held
      })

      expect(result.depositStatus).toBe('held')
      expect(result.depositBalance).toBeGreaterThan(0)
      expect(result.depositBalance).toBe(12_000)
    })
  })

  test.describe('status=refunded → depositBalance = 0', () => {
    test('after full refund, status is refunded and balance = 0', async ({ request }) => {
      const suffix = `DS03b-${Date.now()}`
      const env    = await TestEnv.create(request, suffix, 6000)
      const { month, year } = currentMonthYear()

      const { tenantId } = await env.createAssignedTenant({
        rentOverride: 6000,
        deposit:      6000,
        moveInDate:   firstOfMonthISO(),
      })
      await api.generateRent(request, env.token, env.propertyId, month, year)
      await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 6000 })

      const result = await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
        depositAction: 'refund',
        refundAmount:  6000,
        refundMethod:  'cash',
      })

      expect(result.depositStatus).toBe('refunded')
      expect(result.depositBalance).toBe(0)
    })
  })

  test.describe('status=forfeited → depositBalance = 0', () => {
    test('after forfeit, status is forfeited and balance = 0', async ({ request }) => {
      const suffix = `DS03c-${Date.now()}`
      const env    = await TestEnv.create(request, suffix, 5000)
      const { month, year } = currentMonthYear()

      const { tenantId } = await env.createAssignedTenant({
        rentOverride: 5000,
        deposit:      5000,
        moveInDate:   firstOfMonthISO(),
      })
      await api.generateRent(request, env.token, env.propertyId, month, year)
      await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 5000 })

      const result = await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
        depositAction: 'forfeit',
      })

      expect(result.depositStatus).toBe('forfeited')
      expect(result.depositBalance).toBe(0)
    })
  })
})

test.describe('DS-04 — Payment Reversal Leaves No Phantom Credits', () => {
  test('after reversal, sum of credits equals sum of non-reversed payment amounts', async ({ request }) => {
    const suffix = `DS04-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)

    // Three payments
    const p1 = await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 3000 })
    const p2 = await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 2000 })
    const p3 = await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 3000 })

    // Reverse payment 2
    await api.reversePayment(request, env.token, env.propertyId, p2.paymentId)

    const ledger = await api.getTenantLedger(request, env.token, env.propertyId, tenantId)

    // Sum all payment_received credits
    const totalCredit = ledger.entries
      .filter(e => e.referenceType === 'payment_received' && e.type === 'credit')
      .reduce((s, e) => s + e.amount, 0)

    // Sum all payment_reversal debits
    const totalReversed = ledger.entries
      .filter(e => e.referenceType === 'payment_reversal' && e.type === 'debit')
      .reduce((s, e) => s + e.amount, 0)

    // Net credits = p1 + p2 + p3 - reversed(p2) = 3000 + 2000 + 3000 - 2000 = 6000
    const netCredit = totalCredit - totalReversed
    expect(netCredit).toBe(6000)  // p1(3000) + p3(3000)

    // balance = 8000 - 6000 = 2000
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 2000)

    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
  })
})

test.describe('DS-05 — Charges Cannot Drain Advance Below Zero (Balance Tracking)', () => {
  test('adding charges to a negative-balance tenant increases balance correctly', async ({ request }) => {
    const suffix = `DS05-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 5000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 5000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 8000 })
    // Balance = -3000 (advance credit)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, -3000)

    // Add charges that consume the advance
    await api.addCharge(request, env.token, env.propertyId, tenantId, { amount: 1000, description: 'Laundry' })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, -2000) // advance partially consumed

    await api.addCharge(request, env.token, env.propertyId, tenantId, { amount: 1500, description: 'Electricity' })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, -500)

    await api.addCharge(request, env.token, env.propertyId, tenantId, { amount: 1000, description: 'WiFi' })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 500)  // advance exhausted, now owes

    // Invariant holds throughout
    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
  })
})

test.describe('DS-06 — Total Payment Amounts = Total payment_received Credits', () => {
  test('sum of payment amounts matches sum of credit entries in ledger', async ({ request }) => {
    const suffix = `DS06-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 12_000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 12_000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)

    const payments = [4000, 3500, 2500, 2000]  // sum = 12,000
    for (const amount of payments) {
      await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount })
    }

    const ledger = await api.getTenantLedger(request, env.token, env.propertyId, tenantId)

    const totalCreditInLedger = ledger.entries
      .filter(e => e.referenceType === 'payment_received')
      .reduce((s, e) => s + e.amount, 0)

    expect(totalCreditInLedger).toBe(12_000)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)
    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
  })
})

test.describe('DS-07 — No Orphan Ledger Entries', () => {
  test('every ledger entry has a valid, known referenceType', async ({ request }) => {
    const suffix = `DS07-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      deposit:      5000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.addCharge(request, env.token, env.propertyId, tenantId, { amount: 300 })
    const { paymentId } = await api.recordPayment(request, env.token, env.propertyId, {
      tenantId, amount: 5000,
    })
    await api.reversePayment(request, env.token, env.propertyId, paymentId)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 8300 })

    const ledger = await api.getTenantLedger(request, env.token, env.propertyId, tenantId)

    for (const entry of ledger.entries) {
      expect(
        a.KNOWN_REFERENCE_TYPES.has(entry.referenceType),
        `Orphan entry found: referenceType="${entry.referenceType}" id=${entry._id}`,
      ).toBe(true)
    }

    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
  })
})

test.describe('DS-08 — depositBalance Cannot Go Negative Through Adjust', () => {
  test('deposit adjust is capped at depositBalance; never creates negative deposit', async ({ request }) => {
    const suffix = `DS08-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 15_000)
    const { month, year } = currentMonthYear()

    // Deposit ₹5,000 but rent ₹15,000 → adjust can only cover ₹5,000
    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 15_000,
      deposit:      5_000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 15_000)

    // Adjust: deposit covers ₹5,000 of the ₹15,000 dues
    const result = await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      depositAction: 'adjust',
    })

    // depositBalance exhausted but never negative
    expect(result.depositBalance).toBe(0)
    expect(result.depositBalance).toBeGreaterThanOrEqual(0)
    expect(result.depositStatus).toBe('adjusted')

    // ₹10,000 still outstanding as bad debt
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 10_000)

    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
  })
})
