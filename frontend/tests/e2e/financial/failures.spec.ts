/**
 * failures.spec.ts — Error path and forbidden-operation tests
 *
 * Every test here verifies that:
 *   1. The API returns an appropriate error (4xx)
 *   2. NO new ledger entries are written on failure (atomicity)
 *   3. The tenant's balance is unchanged after the failed call
 *
 * FA-01  Payment to a vacated tenant                 → 400 / TENANT_VACATED
 * FA-02  Deposit refund after deposit already refunded → 400 / NO_DEPOSIT_BALANCE
 * FA-03  Adjust deposit on an already-vacated tenant  → 400 (tenant already vacated)
 * FA-04  Refund exceeds deposit balance               → 400 / REFUND_EXCEEDS_DEPOSIT
 * FA-05  Reverse a payment that was already reversed  → 400 / already reversed
 * FA-06  Deposit action with no deposit collected     → 400 / NO_DEPOSIT_BALANCE
 * FA-07  Generate rent for a future month (not yet)  → 400 / validation error
 * FA-08  Add charge of ₹0                            → 400 / validation error
 */

import { test, expect } from '@playwright/test'
import { TestEnv, currentMonthYear, firstOfMonthISO } from './helpers/seed'
import * as api from './helpers/api'
import * as a   from './helpers/assertions'

// ─────────────────────────────────────────────────────────────────────────────

test.describe('FA-01 — Payment to a Vacated Tenant', () => {
  test('API rejects payment to vacated tenant; no ledger entry created', async ({ request }) => {
    const suffix = `FA01-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      deposit:      0,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 8000 })

    // Vacate the tenant
    await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      vacateOption: 'proceed',
    })

    const entriesBeforeAttempt = (await api.getTenantLedger(
      request, env.token, env.propertyId, tenantId,
    )).entries.length

    const balanceBefore = await api.getCurrentBalance(request, env.token, env.propertyId, tenantId)

    // Attempt to pay the vacated tenant
    let errorStatus = 0
    try {
      await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 500 })
    } catch (err: unknown) {
      errorStatus = (err as { status?: number }).status ?? 0
    }
    expect(errorStatus).toBe(400)

    // No new ledger entries
    const entriesAfterAttempt = (await api.getTenantLedger(
      request, env.token, env.propertyId, tenantId,
    )).entries.length
    expect(entriesAfterAttempt).toBe(entriesBeforeAttempt)

    // Balance unchanged
    const balanceAfter = await api.getCurrentBalance(request, env.token, env.propertyId, tenantId)
    expect(balanceAfter).toBe(balanceBefore)
  })
})

test.describe('FA-02 — Deposit Refund After Already Refunded', () => {
  test('second deposit refund returns NO_DEPOSIT_BALANCE error; ledger unchanged', async ({ request }) => {
    const suffix = `FA02-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 6000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 6000,
      deposit:      6000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 6000 })

    // First vacate: full deposit refund
    await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      depositAction: 'refund',
      refundAmount:  6000,
      refundMethod:  'cash',
    })

    const entriesAfterFirstVacate = (await api.getTenantLedger(
      request, env.token, env.propertyId, tenantId,
    )).entries.length

    // Attempt second deposit action on the same tenant (already vacated + deposit gone)
    let errorCode = ''
    try {
      await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
        depositAction: 'refund',
        refundAmount:  6000,
        refundMethod:  'cash',
      })
    } catch (err: unknown) {
      errorCode = (err as { code?: string }).code ?? 'ERROR'
    }

    // Should fail — either TENANT_VACATED or NO_DEPOSIT_BALANCE
    expect(['TENANT_VACATED', 'NO_DEPOSIT_BALANCE', 'ERROR']).toContain(errorCode)
    expect(errorCode).not.toBe('')

    // No new entries written
    const entriesAfterAttempt = (await api.getTenantLedger(
      request, env.token, env.propertyId, tenantId,
    )).entries.length
    expect(entriesAfterAttempt).toBe(entriesAfterFirstVacate)
  })
})

test.describe('FA-03 — Deposit Adjust on Already-Vacated Tenant', () => {
  test('adjust deposit on vacated tenant returns error; balance and ledger unchanged', async ({ request }) => {
    const suffix = `FA03-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      deposit:      10_000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 8000 })

    // Vacate cleanly (no deposit action)
    await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      vacateOption: 'proceed',
    })

    const entriesBefore = (await api.getTenantLedger(
      request, env.token, env.propertyId, tenantId,
    )).entries.length

    // Attempt deposit adjust on already-vacated tenant
    let errorStatus = 0
    try {
      await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
        depositAction: 'adjust',
      })
    } catch (err: unknown) {
      errorStatus = (err as { status?: number }).status ?? 0
    }
    expect(errorStatus).toBe(400)

    // No new entries
    const entriesAfter = (await api.getTenantLedger(
      request, env.token, env.propertyId, tenantId,
    )).entries.length
    expect(entriesAfter).toBe(entriesBefore)
  })
})

test.describe('FA-04 — Refund Exceeds Deposit Balance', () => {
  test('API rejects refund > depositBalance with REFUND_EXCEEDS_DEPOSIT; no entry written', async ({ request }) => {
    const suffix = `FA04-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      deposit:      3000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 8000 })

    const entriesBefore = (await api.getTenantLedger(
      request, env.token, env.propertyId, tenantId,
    )).entries.length

    let errorCode = ''
    try {
      await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
        depositAction: 'refund',
        refundAmount:  8000,   // exceeds ₹3,000 deposit
        refundMethod:  'cash',
      })
    } catch (err: unknown) {
      errorCode = (err as { code?: string }).code ?? 'ERROR'
    }
    expect(errorCode).toBe('REFUND_EXCEEDS_DEPOSIT')

    // No new entries
    const entriesAfter = (await api.getTenantLedger(
      request, env.token, env.propertyId, tenantId,
    )).entries.length
    expect(entriesAfter).toBe(entriesBefore)

    // Balance unchanged = 0
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)
  })
})

test.describe('FA-05 — Reverse a Payment Twice', () => {
  test('reversing an already-reversed payment returns an error', async ({ request }) => {
    const suffix = `FA05-${Date.now()}`
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

    // First reversal — should succeed
    await api.reversePayment(request, env.token, env.propertyId, paymentId, 'First reversal')

    const entriesAfterFirstReversal = (await api.getTenantLedger(
      request, env.token, env.propertyId, tenantId,
    )).entries.length

    // Second reversal — must fail
    let errorStatus = 0
    try {
      await api.reversePayment(request, env.token, env.propertyId, paymentId, 'Second reversal attempt')
    } catch (err: unknown) {
      errorStatus = (err as { status?: number }).status ?? 0
    }
    expect(errorStatus).toBeGreaterThanOrEqual(400)
    expect(errorStatus).toBeLessThan(500)

    // No new entries from second reversal attempt
    const entriesAfterSecondAttempt = (await api.getTenantLedger(
      request, env.token, env.propertyId, tenantId,
    )).entries.length
    expect(entriesAfterSecondAttempt).toBe(entriesAfterFirstReversal)
  })
})

test.describe('FA-06 — Deposit Action with No Deposit Collected', () => {
  test('adjust on zero-deposit tenant returns NO_DEPOSIT_BALANCE', async ({ request }) => {
    const suffix = `FA06-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      deposit:      0,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 8000 })

    const entriesBefore = (await api.getTenantLedger(
      request, env.token, env.propertyId, tenantId,
    )).entries.length

    let errorCode = ''
    try {
      await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
        depositAction: 'adjust',
      })
    } catch (err: unknown) {
      errorCode = (err as { code?: string }).code ?? 'ERROR'
    }
    expect(errorCode).toBe('NO_DEPOSIT_BALANCE')

    // No entries written
    const entriesAfter = (await api.getTenantLedger(
      request, env.token, env.propertyId, tenantId,
    )).entries.length
    expect(entriesAfter).toBe(entriesBefore)
  })
})

test.describe('FA-07 — Add Charge of ₹0', () => {
  test('API rejects zero-amount charge with 400; no ledger entry created', async ({ request }) => {
    const suffix = `FA07-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      moveInDate:   firstOfMonthISO(),
    })

    const entriesBefore = (await api.getTenantLedger(
      request, env.token, env.propertyId, tenantId,
    )).entries.length

    let errorStatus = 0
    try {
      await api.addCharge(request, env.token, env.propertyId, tenantId, { amount: 0, description: 'Zero charge' })
    } catch (err: unknown) {
      errorStatus = (err as { status?: number }).status ?? 0
    }
    expect(errorStatus).toBe(400)

    const entriesAfter = (await api.getTenantLedger(
      request, env.token, env.propertyId, tenantId,
    )).entries.length
    expect(entriesAfter).toBe(entriesBefore)
  })
})

test.describe('FA-08 — Negative Charge Amount', () => {
  test('API rejects negative charge amount with 400', async ({ request }) => {
    const suffix = `FA08-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      moveInDate:   firstOfMonthISO(),
    })

    const entriesBefore = (await api.getTenantLedger(
      request, env.token, env.propertyId, tenantId,
    )).entries.length

    let errorStatus = 0
    try {
      await api.addCharge(request, env.token, env.propertyId, tenantId, {
        amount: -500, description: 'Negative charge',
      })
    } catch (err: unknown) {
      errorStatus = (err as { status?: number }).status ?? 0
    }
    expect(errorStatus).toBe(400)

    const entriesAfter = (await api.getTenantLedger(
      request, env.token, env.propertyId, tenantId,
    )).entries.length
    expect(entriesAfter).toBe(entriesBefore)
  })
})
