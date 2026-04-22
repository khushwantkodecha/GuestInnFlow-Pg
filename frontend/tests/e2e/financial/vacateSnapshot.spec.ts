/**
 * vacateSnapshot.spec.ts — Full ledger sequence validation after vacate
 *
 * Rather than spot-checking individual entries, these tests verify the EXACT
 * sequence of ledger entries in the correct order, each with correct amounts
 * and running balanceAfter values.  They also assert chain consistency so no
 * phantom entries can exist.
 *
 * VS-01  Full settlement: deposit + cash collection + surplus refund
 *        Sequence: deposit_collected → rent_generated → payment_received(cash) →
 *                  deposit_adjusted(audit) → deposit_refunded(audit)
 *        Final balance = 0, deposit = 0
 *
 * VS-02  Clean vacate (no dues, no deposit)
 *        Sequence: rent_generated → payment_received
 *        Final balance = 0, deposit = 0, no new entries after vacate
 *
 * VS-03  Vacate with advance credit refund
 *        Sequence: rent_generated → payment_received(overpay) → advance_refunded
 *        Final balance = 0
 *
 * VS-04  Bad-debt vacate (unpaid, no action)
 *        Sequence: rent_generated
 *        balance remains > 0 after vacate
 *
 * VS-05  Deposit-only adjust (no cash, no refund)
 *        deposit_collected → rent_generated → payment_received(deposit) → deposit_adjusted(audit)
 *        Final balance = 0, depositBalance > 0 (surplus held)
 */

import { test, expect } from '@playwright/test'
import { TestEnv, currentMonthYear, firstOfMonthISO } from './helpers/seed'
import * as api from './helpers/api'
import * as a   from './helpers/assertions'

// ─────────────────────────────────────────────────────────────────────────────

test.describe('VS-01 — Full Settlement Ledger Snapshot', () => {
  test('exact entry sequence + chain consistency + final balance = 0', async ({ request }) => {
    const suffix = `VS01-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 10_000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 10_000,
      deposit:      15_000,
      moveInDate:   firstOfMonthISO(),
    })

    await api.generateRent(request, env.token, env.propertyId, month, year)
    // Partially pay — leaves ₹3,000 outstanding
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 7000 })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 3000)

    // Vacate: use deposit to clear ₹3,000 dues, refund ₹12,000 surplus
    const result = await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      depositAction: 'adjust_and_refund',
      refundMethod:  'cash',
    })

    // ── Post-vacate balance = 0 ───────────────────────────────────────────────
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)
    expect(result.depositBalance).toBe(0)
    expect(result.depositStatus).toBe('refunded')

    // ── Exact entry sequence ──────────────────────────────────────────────────
    // Oldest-to-newest: deposit_collected, rent_generated, payment_received,
    //                   payment_received(deposit adjust), deposit_adjusted, deposit_refunded
    await a.assertLedgerSequence(request, env.token, env.propertyId, tenantId, [
      { type: 'debit',  referenceType: 'deposit_collected', amount: 15_000, balanceAfter: 0      },
      { type: 'debit',  referenceType: 'rent_generated',    amount: 10_000, balanceAfter: 10_000 },
      { type: 'credit', referenceType: 'payment_received',  amount: 7000,   balanceAfter: 3000   },
      { type: 'credit', referenceType: 'payment_received',  amount: 3000,   balanceAfter: 0      },
      { type: 'debit',  referenceType: 'deposit_adjusted',  amount: 3000                        },
      { type: 'debit',  referenceType: 'deposit_refunded',  amount: 12_000                      },
    ])

    // ── Full chain consistency — every balanceAfter is arithmetically correct ─
    await a.assertLedgerChainConsistency(request, env.token, env.propertyId, tenantId)
  })
})

test.describe('VS-02 — Clean Vacate Snapshot (No Dues, No Deposit)', () => {
  test('no new entries after vacate; chain consistent; balance = 0', async ({ request }) => {
    const suffix = `VS02-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      deposit:      0,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 8000 })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    const entriesBefore = (await api.getTenantLedger(
      request, env.token, env.propertyId, tenantId,
    )).entries.length

    // Clean vacate
    await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      vacateOption: 'proceed',
    })

    // No new entries written
    const entriesAfter = (await api.getTenantLedger(
      request, env.token, env.propertyId, tenantId,
    )).entries.length
    expect(entriesAfter).toBe(entriesBefore)

    // Final state
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    // Sequence
    await a.assertLedgerSequence(request, env.token, env.propertyId, tenantId, [
      { type: 'debit',  referenceType: 'rent_generated',   amount: 8000, balanceAfter: 8000 },
      { type: 'credit', referenceType: 'payment_received', amount: 8000, balanceAfter: 0    },
    ])

    await a.assertLedgerChainConsistency(request, env.token, env.propertyId, tenantId)
  })
})

test.describe('VS-03 — Advance Credit Refund Snapshot', () => {
  test('advance_refunded debit closes the negative balance; chain consistent', async ({ request }) => {
    const suffix = `VS03-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      deposit:      0,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    // Overpay by ₹3,000
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 11_000 })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, -3000)

    // Vacate with advance refund
    await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      advanceCreditRefund: true,
      advanceCreditMethod: 'cash',
    })

    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    // Sequence: rent_generated, payment_received (11k), advance_refunded (3k)
    await a.assertLedgerSequence(request, env.token, env.propertyId, tenantId, [
      { type: 'debit',  referenceType: 'rent_generated',   amount: 8000,   balanceAfter: 8000  },
      { type: 'credit', referenceType: 'payment_received', amount: 11_000, balanceAfter: -3000 },
      { type: 'debit',  referenceType: 'advance_refunded', amount: 3000,   balanceAfter: 0     },
    ])

    await a.assertLedgerChainConsistency(request, env.token, env.propertyId, tenantId)
  })
})

test.describe('VS-04 — Bad-Debt Vacate Snapshot', () => {
  test('balance remains after vacate with no action; chain consistent', async ({ request }) => {
    const suffix = `VS04-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      deposit:      0,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    // No payment — ₹8,000 outstanding

    const balanceBefore = await api.getCurrentBalance(request, env.token, env.propertyId, tenantId)
    const entriesBefore = (await api.getTenantLedger(
      request, env.token, env.propertyId, tenantId,
    )).entries.length

    await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      vacateOption: 'proceed',
    })

    // Balance preserved as bad debt
    const balanceAfter = await api.getCurrentBalance(request, env.token, env.propertyId, tenantId)
    expect(balanceAfter).toBe(balanceBefore)
    expect(balanceAfter).toBe(8000)

    // No new entries
    const entriesAfter = (await api.getTenantLedger(
      request, env.token, env.propertyId, tenantId,
    )).entries.length
    expect(entriesAfter).toBe(entriesBefore)

    // Tenant is vacated
    const tenant = await api.getTenantById(request, env.token, env.propertyId, tenantId)
    expect(tenant['status']).toBe('vacated')

    await a.assertLedgerChainConsistency(request, env.token, env.propertyId, tenantId)
  })
})

test.describe('VS-05 — Deposit-Only Adjust (No Cash, Surplus Held) Snapshot', () => {
  test('deposit covers dues; surplus remains held; chain consistent', async ({ request }) => {
    const suffix = `VS05-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      deposit:      20_000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 8000)

    const result = await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      depositAction: 'adjust',
    })

    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)
    expect(result.depositBalance).toBe(12_000)  // ₹20,000 − ₹8,000
    expect(result.depositStatus).toBe('held')

    // Sequence (audit-only entries don't change the running rent balance)
    await a.assertLedgerSequence(request, env.token, env.propertyId, tenantId, [
      { type: 'debit',  referenceType: 'deposit_collected', amount: 20_000, balanceAfter: 0      },
      { type: 'debit',  referenceType: 'rent_generated',    amount: 8000,   balanceAfter: 8000   },
      { type: 'credit', referenceType: 'payment_received',  amount: 8000,   balanceAfter: 0      },
      { type: 'debit',  referenceType: 'deposit_adjusted',  amount: 8000                        },
    ])

    await a.assertLedgerChainConsistency(request, env.token, env.propertyId, tenantId)
  })
})
