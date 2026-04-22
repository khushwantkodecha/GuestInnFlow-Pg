/**
 * vacate.spec.ts — Vacate flow tests
 *
 * TC-V01  Clean vacate (no dues, no deposit)
 * TC-V02  Vacate with outstanding dues + cash collection
 * TC-V03  Vacate with advance credit refund
 * TC-V04  Full settlement (dues + deposit adjust + surplus refund)
 * TC-V05  Vacate with unpaid balance, no action (bad debt)
 *
 * Vacate steps (from vacateService.js):
 *   Step 1: Deposit adjustment (if depositAction = 'adjust' or 'adjust_and_refund')
 *   Step 2: Cash collection   (if vacateOption = 'collect')
 *   Step 3: Advance refund    (if advanceCreditRefund = true and balance < 0)
 *   Step 4: Mark bed vacant
 *   Step 5: Mark tenant vacated
 *   Step 7: Deposit audit entries
 */

import { test, expect } from '@playwright/test'
import { TestEnv, currentMonthYear, firstOfMonthISO } from './helpers/seed'
import * as api from './helpers/api'
import * as a   from './helpers/assertions'

// ─────────────────────────────────────────────────────────────────────────────

test.describe('TC-V01 — Clean Vacate (No Dues, No Deposit)', () => {
  test('vacating a tenant with zero balance and no deposit creates no new ledger entries', async ({ request }) => {
    const suffix = `V01-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      deposit:      0,
      moveInDate:   firstOfMonthISO(),
    })

    // Pay all rent so balance = 0
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 8000 })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    const entriesBeforeVacate = (await api.getTenantLedger(request, env.token, env.propertyId, tenantId)).entries.length

    // ── Vacate with no financial actions ─────────────────────────────────────
    await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      vacateOption: 'proceed',
    })

    // ── No new ledger entries ─────────────────────────────────────────────────
    const entriesAfterVacate = (await api.getTenantLedger(request, env.token, env.propertyId, tenantId)).entries.length
    expect(entriesAfterVacate).toBe(entriesBeforeVacate)

    // ── Tenant is vacated ─────────────────────────────────────────────────────
    const tenant = await api.getTenantById(request, env.token, env.propertyId, tenantId)
    expect(tenant['status']).toBe('vacated')
  })
})

test.describe('TC-V02 — Vacate with Outstanding Dues + Cash Collection', () => {
  test('collecting cash at vacate clears dues and closes the account', async ({ request }) => {
    const suffix = `V02-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      deposit:      0,
      moveInDate:   firstOfMonthISO(),
    })

    await api.generateRent(request, env.token, env.propertyId, month, year)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 8000)

    // ── Vacate collecting ₹8,000 cash ─────────────────────────────────────────
    await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      vacateOption:  'collect',
      paymentAmount: 8000,
      paymentMethod: 'cash',
    })

    // ── Balance = 0 ───────────────────────────────────────────────────────────
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    await a.assertLastLedgerEntry(request, env.token, env.propertyId, tenantId, {
      type:          'credit',
      referenceType: 'payment_received',
      amount:        8000,
      balanceAfter:  0,
    })

    // ── Tenant is vacated ─────────────────────────────────────────────────────
    const tenant = await api.getTenantById(request, env.token, env.propertyId, tenantId)
    expect(tenant['status']).toBe('vacated')
    expect(tenant['checkOutDate']).not.toBeNull()
  })
})

test.describe('TC-V03 — Vacate with Advance Credit Refund', () => {
  test('advance_refunded debit zeros out negative balance at vacate', async ({ request }) => {
    const suffix = `V03-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      deposit:      0,
      moveInDate:   firstOfMonthISO(),
    })

    // Create advance credit: pay ₹10,000 against ₹8,000 rent → balance = −₹2,000
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 10_000 })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, -2000)

    // ── Vacate with advance credit refund ─────────────────────────────────────
    await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      advanceCreditRefund:  true,
      advanceCreditMethod:  'cash',
    })

    // ── Ledger: advance_refunded debit, balance = 0 ────────────────────────────
    await a.assertLastLedgerEntry(request, env.token, env.propertyId, tenantId, {
      type:          'debit',
      referenceType: 'advance_refunded',
      amount:        2000,
      balanceAfter:  0,
    })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)
  })
})

test.describe('TC-V04 — Full Vacate Settlement (Dues + Deposit Adjust + Surplus Refund)', () => {
  test('deposit covers partial dues; surplus refunded; balance = 0', async ({ request }) => {
    const suffix = `V04-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 10_000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 10_000,
      deposit:      10_000,
      moveInDate:   firstOfMonthISO(),
    })

    // Generate rent but only partially pay it → ₹3,000 outstanding
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 7000 })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 3000)

    // ── Vacate: adjust deposit to clear ₹3,000 dues + refund ₹7,000 surplus ──
    const result = await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      depositAction: 'adjust_and_refund',
      refundMethod:  'cash',
    })

    // ── Balance = 0 ───────────────────────────────────────────────────────────
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    // ── Deposit fully consumed ────────────────────────────────────────────────
    expect(result.depositBalance).toBe(0)
    expect(result.depositStatus).toBe('refunded')

    // ── Verify the 3 expected settlement entries ──────────────────────────────
    const ledger = await api.getTenantLedger(request, env.token, env.propertyId, tenantId)

    const payEntry    = ledger.entries.find(e => e.referenceType === 'payment_received' && e.balanceAfter === 0)
    const adjEntry    = ledger.entries.find(e => e.referenceType === 'deposit_adjusted')
    const refundEntry = ledger.entries.find(e => e.referenceType === 'deposit_refunded')

    expect(payEntry?.amount).toBe(3000)    // deposit covers ₹3,000 dues
    expect(adjEntry?.amount).toBe(3000)    // audit: ₹3,000 applied
    expect(refundEntry?.amount).toBe(7000) // audit: ₹7,000 surplus refunded
  })
})

test.describe('TC-V05 — Vacate with Unpaid Balance, No Action (Bad Debt)', () => {
  test('vacate without payment leaves the balance unchanged in the ledger', async ({ request }) => {
    const suffix = `V05-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      deposit:      0,
      moveInDate:   firstOfMonthISO(),
    })

    // Generate 3 months of rent → ₹24,000 outstanding (simulate overdue)
    const now = new Date()
    const m   = now.getMonth() + 1
    const y   = now.getFullYear()
    await api.generateRent(request, env.token, env.propertyId, m, y)
    // Balance = ₹8,000 (just current month for simplicity)

    const balanceBefore = (await api.getTenantLedger(request, env.token, env.propertyId, tenantId)).currentBalance

    // ── Vacate with no financial action (proceed) ─────────────────────────────
    await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      vacateOption: 'proceed',
    })

    // ── Balance unchanged (bad debt) ──────────────────────────────────────────
    const balanceAfter = (await api.getTenantLedger(request, env.token, env.propertyId, tenantId)).currentBalance
    expect(balanceAfter).toBe(balanceBefore)
    expect(balanceAfter).toBeGreaterThan(0)

    // ── Tenant is vacated ─────────────────────────────────────────────────────
    const tenant = await api.getTenantById(request, env.token, env.propertyId, tenantId)
    expect(tenant['status']).toBe('vacated')
  })
})
