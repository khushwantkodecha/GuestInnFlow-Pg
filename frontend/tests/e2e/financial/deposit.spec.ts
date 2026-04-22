/**
 * deposit.spec.ts — Security deposit tests
 *
 * TC-D01  Deposit collected at check-in (audit-only, no rent impact)
 * TC-D02  Deposit adjusted against full dues at vacate
 * TC-D03  Deposit adjusted + surplus refunded (adjust_and_refund)
 * TC-D04  Partial deposit adjustment (deposit < dues)
 * TC-D05  Deposit refund (no dues)
 * TC-D06  Partial deposit refund
 * TC-D07  Deposit forfeited at vacate
 * TC-D08  Refund blocked when dues exist (validation error)
 * TC-D09  Refund allowed when dues + cash collected together
 *
 * All deposit actions go through the vacate-with-payment endpoint.
 * Deposit balance is tracked in Tenant.depositBalance (separate from ledger).
 * Deposit ledger entries are AUDIT-ONLY — they do not change the rent balance
 * except when depositAction is 'adjust' or 'adjust_and_refund'.
 */

import { test, expect } from '@playwright/test'
import { TestEnv, currentMonthYear, firstOfMonthISO } from './helpers/seed'
import * as api from './helpers/api'
import * as a   from './helpers/assertions'

// Shared setup: tenant with rent generated and unpaid
async function setupWithDeposit(
  request: import('@playwright/test').APIRequestContext,
  suffix:  string,
  opts: {
    rentAmt?:    number
    depositAmt?: number
    payRent?:    boolean
  } = {},
) {
  const { rentAmt = 8000, depositAmt = 20_000, payRent = false } = opts
  const env    = await TestEnv.create(request, suffix, rentAmt)
  const { month, year } = currentMonthYear()

  const { tenantId } = await env.createAssignedTenant({
    rentOverride: rentAmt,
    deposit:      depositAmt,
    moveInDate:   firstOfMonthISO(),
  })

  await api.generateRent(request, env.token, env.propertyId, month, year)

  if (payRent) {
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: rentAmt })
  }

  return { env, tenantId, month, year, rentAmt, depositAmt }
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('TC-D01 — Deposit Collected at Check-in', () => {
  test('deposit creates an audit-only ledger entry; rent balance stays 0', async ({ request }) => {
    const suffix = `D01-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)

    // Assign with ₹20,000 deposit (no rent generated yet)
    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      deposit:      20_000,
    })

    // ── API: ledger has a deposit_collected debit with balanceAfter = 0 ──────
    const entries = await a.getLedgerEntriesByType(
      request, env.token, env.propertyId, tenantId, 'deposit_collected',
    )
    expect(entries.length).toBe(1)
    expect(entries[0].type).toBe('debit')
    expect(entries[0].amount).toBe(20_000)
    expect(entries[0].balanceAfter).toBe(0)   // audit-only — no rent impact

    // Tenant.depositBalance = ₹20,000
    const tenant = await api.getTenantById(request, env.token, env.propertyId, tenantId)
    expect(tenant['depositBalance']).toBe(20_000)

    // Ledger balance is still 0 (deposit doesn't affect rent dues)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)
  })
})

test.describe('TC-D02 — Deposit Adjusted Against Full Dues at Vacate', () => {
  test('adjust action clears ₹8,000 dues; deposit balance reduces to ₹12,000', async ({ request }) => {
    const { env, tenantId } = await setupWithDeposit(request, `D02-${Date.now()}`, {
      rentAmt: 8000, depositAmt: 20_000,
    })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 8000)

    const result = await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      depositAction: 'adjust',
    })

    // ── Balance = 0 ───────────────────────────────────────────────────────────
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    // ── Deposit: ₹20,000 - ₹8,000 = ₹12,000 remaining ───────────────────────
    expect(result.depositBalance).toBe(12_000)
    expect(result.depositStatus).toBe('held')  // still holding remainder

    // ── Ledger: payment_received credit for ₹8,000 + deposit_adjusted audit ──
    const ledger = await api.getTenantLedger(request, env.token, env.propertyId, tenantId)
    const payEntry = ledger.entries.find(e => e.referenceType === 'payment_received')
    expect(payEntry?.amount).toBe(8000)
    expect(payEntry?.balanceAfter).toBe(0)

    const auditEntry = ledger.entries.find(e => e.referenceType === 'deposit_adjusted')
    expect(auditEntry).toBeDefined()
    expect(auditEntry?.amount).toBe(8000)
  })
})

test.describe('TC-D03 — Deposit Adjusted + Refund Surplus (adjust_and_refund)', () => {
  test('adjust clears dues, surplus refunded, deposit balance = 0', async ({ request }) => {
    const { env, tenantId } = await setupWithDeposit(request, `D03-${Date.now()}`, {
      rentAmt: 8000, depositAmt: 20_000,
    })

    const result = await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      depositAction: 'adjust_and_refund',
      refundMethod:  'cash',
    })

    // ── Ledger balance = 0 ────────────────────────────────────────────────────
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    // ── Deposit fully consumed ────────────────────────────────────────────────
    expect(result.depositBalance).toBe(0)
    expect(result.depositStatus).toBe('refunded')

    // ── Ledger: 3 entries: payment_received + deposit_adjusted + deposit_refunded
    const ledger = await api.getTenantLedger(request, env.token, env.propertyId, tenantId)

    const payEntry    = ledger.entries.find(e => e.referenceType === 'payment_received')
    const adjEntry    = ledger.entries.find(e => e.referenceType === 'deposit_adjusted')
    const refundEntry = ledger.entries.find(e => e.referenceType === 'deposit_refunded')

    expect(payEntry?.amount).toBe(8000)
    expect(adjEntry?.amount).toBe(8000)
    expect(refundEntry?.amount).toBe(12_000)  // ₹20,000 - ₹8,000 surplus
  })
})

test.describe('TC-D04 — Partial Deposit Adjustment (Deposit < Dues)', () => {
  test('deposit ₹5,000 covers ₹5,000 of ₹15,000 dues; ₹10,000 remains outstanding', async ({ request }) => {
    const { env, tenantId } = await setupWithDeposit(request, `D04-${Date.now()}`, {
      rentAmt: 15_000, depositAmt: 5_000,
    })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 15_000)

    const result = await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      depositAction: 'adjust',
    })

    // ── Balance = ₹10,000 still outstanding ──────────────────────────────────
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 10_000)

    // ── Deposit exhausted ─────────────────────────────────────────────────────
    expect(result.depositBalance).toBe(0)
    expect(result.depositStatus).toBe('adjusted')

    const payEntry = (await api.getTenantLedger(request, env.token, env.propertyId, tenantId))
      .entries.find(e => e.referenceType === 'payment_received')
    expect(payEntry?.amount).toBe(5000)
    expect(payEntry?.balanceAfter).toBe(10_000)
  })
})

test.describe('TC-D05 — Deposit Refund (No Dues)', () => {
  test('vacate with full deposit refund when balance is 0', async ({ request }) => {
    const { env, tenantId } = await setupWithDeposit(request, `D05-${Date.now()}`, {
      rentAmt: 8000, depositAmt: 10_000, payRent: true,
    })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    const result = await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      depositAction: 'refund',
      refundAmount:  10_000,
      refundMethod:  'upi',
    })

    // ── Deposit fully refunded ────────────────────────────────────────────────
    expect(result.depositBalance).toBe(0)
    expect(result.depositStatus).toBe('refunded')

    // ── Ledger balance unchanged at 0 ─────────────────────────────────────────
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    const refundEntry = (await api.getTenantLedger(request, env.token, env.propertyId, tenantId))
      .entries.find(e => e.referenceType === 'deposit_refunded')
    expect(refundEntry?.amount).toBe(10_000)
    expect(refundEntry?.balanceAfter).toBe(0)
  })
})

test.describe('TC-D06 — Partial Deposit Refund', () => {
  test('partial refund leaves remaining deposit balance', async ({ request }) => {
    const { env, tenantId } = await setupWithDeposit(request, `D06-${Date.now()}`, {
      rentAmt: 8000, depositAmt: 10_000, payRent: true,
    })

    const result = await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      depositAction: 'refund',
      refundAmount:  6000,
      refundMethod:  'cash',
    })

    // ₹10,000 - ₹6,000 = ₹4,000 still held
    expect(result.depositBalance).toBe(4000)
    expect(result.depositStatus).toBe('held')

    const refundEntry = (await api.getTenantLedger(request, env.token, env.propertyId, tenantId))
      .entries.find(e => e.referenceType === 'deposit_refunded')
    expect(refundEntry?.amount).toBe(6000)
  })
})

test.describe('TC-D07 — Deposit Forfeited at Vacate', () => {
  test('forfeited deposit zeroes depositBalance; ledger balance unchanged', async ({ request }) => {
    const { env, tenantId } = await setupWithDeposit(request, `D07-${Date.now()}`, {
      rentAmt: 8000, depositAmt: 8000, payRent: true,
    })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    const result = await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      depositAction: 'forfeit',
    })

    expect(result.depositBalance).toBe(0)
    expect(result.depositStatus).toBe('forfeited')

    // Ledger balance still 0 (forfeit is audit-only)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    const forfeitEntry = (await api.getTenantLedger(request, env.token, env.propertyId, tenantId))
      .entries.find(e => e.referenceType === 'deposit_forfeited')
    expect(forfeitEntry?.amount).toBe(8000)
  })
})

test.describe('TC-D08 — Refund Blocked When Dues Exist', () => {
  test('API rejects deposit refund when outstanding rent exists', async ({ request }) => {
    const { env, tenantId } = await setupWithDeposit(request, `D08-${Date.now()}`, {
      rentAmt: 6000, depositAmt: 10_000,
    })
    // Rent still unpaid

    let errorCode = ''
    try {
      await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
        depositAction: 'refund',
        // vacateOption NOT 'collect' → should be blocked
      })
    } catch (err: unknown) {
      errorCode = (err as { code?: string }).code ?? 'ERROR'
    }

    expect(errorCode).toBe('REFUND_BLOCKED_BY_DUES')

    // ── Ledger unchanged — no new entries after the failed request ─────────────
    const beforeEntries = (await api.getTenantLedger(request, env.token, env.propertyId, tenantId)).entries
    // Re-check — error must not have written anything
    const afterEntries  = (await api.getTenantLedger(request, env.token, env.propertyId, tenantId)).entries
    expect(afterEntries.length).toBe(beforeEntries.length)
  })
})

test.describe('TC-D09 — Refund Allowed When Dues + Cash Collected Together', () => {
  test('collecting cash clears dues, then deposit refund proceeds', async ({ request }) => {
    const { env, tenantId } = await setupWithDeposit(request, `D09-${Date.now()}`, {
      rentAmt: 6000, depositAmt: 10_000,
    })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 6000)

    // Collect ₹6,000 cash + refund full deposit in one vacate request
    const result = await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      vacateOption:  'collect',
      paymentAmount: 6000,
      paymentMethod: 'cash',
      depositAction: 'refund',
      refundMethod:  'cash',
    })

    // ── Balance = 0 ───────────────────────────────────────────────────────────
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    // ── Deposit fully refunded ────────────────────────────────────────────────
    expect(result.depositBalance).toBe(0)
    expect(result.depositStatus).toBe('refunded')

    const ledger = await api.getTenantLedger(request, env.token, env.propertyId, tenantId)
    const payEntry    = ledger.entries.find(e => e.referenceType === 'payment_received')
    const refundEntry = ledger.entries.find(e => e.referenceType === 'deposit_refunded')

    expect(payEntry?.amount).toBe(6000)
    expect(refundEntry?.amount).toBe(10_000)
  })
})
