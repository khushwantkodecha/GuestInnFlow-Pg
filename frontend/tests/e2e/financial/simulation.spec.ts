/**
 * simulation.spec.ts — Full-lifecycle integration simulation
 *
 * These tests simulate real-world usage patterns across multiple operations
 * in a single test scenario.  They verify that the system remains consistent
 * end-to-end, not just at individual operation boundaries.
 *
 * SIM-01  Standard tenant lifecycle
 *         assign → generate rent → partial pay → add charge → settle → vacate
 *
 * SIM-02  Multi-month tenant with arrears
 *         3 months of rent, some paid late, arrears carried forward, final vacate
 *
 * SIM-03  Reservation → confirmation → full tenure → vacate with deposit
 *         Reserve → confirm → 2 months → charge → pay → vacate + adjust deposit
 *
 * SIM-04  Overpayment accumulation then vacate
 *         Several overpayments create advance; advance refunded at vacate
 *
 * SIM-05  Charge-heavy tenant
 *         Rent + 5 misc charges; pays in 3 installments; settled at vacate
 */

import { test, expect } from '@playwright/test'
import {
  TestEnv,
  currentMonthYear,
  firstOfMonthISO,
  futureDateISO,
} from './helpers/seed'
import * as api from './helpers/api'
import * as a   from './helpers/assertions'

// ─────────────────────────────────────────────────────────────────────────────

test.describe('SIM-01 — Standard Tenant Lifecycle', () => {
  test('assign → rent → partial pay → charge → settle → vacate; invariant holds at each step', async ({ request }) => {
    const suffix = `SIM01-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    // Step 1: assign
    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      deposit:      10_000,
      moveInDate:   firstOfMonthISO(),
    })
    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    // Step 2: generate rent
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 8000)

    // Step 3: partial payment
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 5000 })
    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 3000)

    // Step 4: add charge
    await api.addCharge(request, env.token, env.propertyId, tenantId, { amount: 400, description: 'Electricity' })
    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 3400)

    // Step 5: settle remaining dues
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 3400 })
    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    // Step 6: vacate with full deposit refund
    const result = await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      depositAction: 'refund',
      refundAmount:  10_000,
      refundMethod:  'upi',
    })
    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    expect(result.depositBalance).toBe(0)
    expect(result.depositStatus).toBe('refunded')

    // Tenant vacated
    const tenant = await api.getTenantById(request, env.token, env.propertyId, tenantId)
    expect(tenant['status']).toBe('vacated')
  })
})

test.describe('SIM-02 — Multi-Month Tenant with Arrears', () => {
  test('3 months rent generated; arrears accumulate; lump-sum settles; vacate clean', async ({ request }) => {
    const suffix = `SIM02-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 6000)
    const now    = new Date()
    const m1     = now.getMonth() + 1
    const y1     = now.getFullYear()
    const m2     = m1 === 12 ? 1 : m1 + 1
    const y2     = m1 === 12 ? y1 + 1 : y1
    const m3     = m2 === 12 ? 1 : m2 + 1
    const y3     = m2 === 12 ? y2 + 1 : y2

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 6000,
      deposit:      0,
      moveInDate:   `${y1}-${String(m1).padStart(2, '0')}-01`,
    })

    // Month 1: generate, pay partially
    await api.generateRent(request, env.token, env.propertyId, m1, y1)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 2000 })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 4000) // ₹4,000 arrear

    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)

    // Month 2: generate (no payment)
    await api.generateRent(request, env.token, env.propertyId, m2, y2)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 10_000) // ₹4k + ₹6k

    // Month 3: generate
    await api.generateRent(request, env.token, env.propertyId, m3, y3)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 16_000) // ₹10k + ₹6k

    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)

    // Lump-sum settlement
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 16_000 })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)

    // Vacate clean
    await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      vacateOption: 'proceed',
    })
    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)
  })
})

test.describe('SIM-03 — Reservation to Full Tenure to Vacate', () => {
  test('reserve with advance → confirm → generate rent → vacate with deposit adjust', async ({ request }) => {
    const suffix    = `SIM03-${Date.now()}`
    const env       = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    // Un-assigned tenant
    const { tenantId } = await env.createTenant()

    // Reservation with ₹3,000 advance
    await api.reserveBed(request, env.token, env.propertyId, env.roomId, env.bedId, {
      tenantId,
      reservedTill: futureDateISO(30),
      advance:      3000,
      advanceMode:  'cash',
    })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, -3000)
    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)

    // Confirm reservation (assign to same bed)
    await api.assignTenantToBed(
      request, env.token, env.propertyId,
      env.roomId, env.bedId, tenantId,
      { rentOverride: 8000, moveInDate: firstOfMonthISO(), deposit: 8000 },
    )
    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)

    // Generate rent
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)

    // Add a charge
    await api.addCharge(request, env.token, env.propertyId, tenantId, {
      amount: 500, description: 'Electricity',
    })

    // Pay whatever is owed
    const balance = await api.getCurrentBalance(request, env.token, env.propertyId, tenantId)
    if (balance > 0) {
      await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: balance })
    }
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)
    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)

    // Vacate: full deposit refund
    const result = await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      depositAction: 'refund',
      refundAmount:  8000,
      refundMethod:  'cash',
    })

    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)
    expect(result.depositBalance).toBe(0)
    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
    await a.assertLedgerChainConsistency(request, env.token, env.propertyId, tenantId)
  })
})

test.describe('SIM-04 — Overpayment Accumulation → Advance Refund at Vacate', () => {
  test('3 overpayments create large advance; advance refunded at vacate; invariant holds', async ({ request }) => {
    const suffix = `SIM04-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 5000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 5000,
      deposit:      0,
      moveInDate:   firstOfMonthISO(),
    })

    await api.generateRent(request, env.token, env.propertyId, month, year)

    // Pay ₹7,000 against ₹5,000 rent → advance = −₹2,000
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 7000 })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, -2000)
    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)

    // Extra ₹1,500 prepayment
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 1500 })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, -3500)
    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)

    // Extra ₹500 prepayment
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 500 })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, -4000)

    // Vacate: refund ₹4,000 advance credit
    await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      advanceCreditRefund: true,
      advanceCreditMethod: 'cash',
    })

    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)
    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)

    // Verify advance_refunded entry
    const refundEntries = await a.getLedgerEntriesByType(
      request, env.token, env.propertyId, tenantId, 'advance_refunded',
    )
    expect(refundEntries.length).toBe(1)
    expect(refundEntries[0].amount).toBe(4000)
  })
})

test.describe('SIM-05 — Charge-Heavy Tenant (Multi-Installment Settlement)', () => {
  test('rent + 5 charges paid in 3 installments; invariant holds; final balance = 0', async ({ request }) => {
    const suffix = `SIM05-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      deposit:      0,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)

    // Add 5 charges — total ₹1,550
    const charges = [
      { amount: 350, description: 'Electricity' },
      { amount: 250, description: 'Water'       },
      { amount: 400, description: 'Laundry'     },
      { amount: 300, description: 'WiFi'         },
      { amount: 250, description: 'Cleaning'    },
    ]
    for (const c of charges) {
      await api.addCharge(request, env.token, env.propertyId, tenantId, c)
    }

    const totalDues = 8000 + 1550  // ₹9,550
    await a.assertBalance(request, env.token, env.propertyId, tenantId, totalDues)
    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)

    // Installment 1: ₹3,000
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 3000 })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 6550)
    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)

    // Installment 2: ₹4,000
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 4000 })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 2550)
    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)

    // Installment 3: ₹2,550 (clears everything)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 2550 })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)
    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)

    // Clean vacate
    await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      vacateOption: 'proceed',
    })
    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    // Verify all 5 charge entries exist
    const chargeEntries = await a.getLedgerEntriesByType(
      request, env.token, env.propertyId, tenantId, 'manual_charge',
    )
    expect(chargeEntries.length).toBe(5)
  })
})
