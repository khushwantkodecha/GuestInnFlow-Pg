/**
 * idempotency.spec.ts — Payment idempotency key tests
 *
 * IDEM-01  Same key sent twice → single payment, single ledger entry, balance not doubled
 * IDEM-02  Same key with different amount → second call returns FIRST payment (no double-charge)
 * IDEM-03  Different key, same amount → two separate payments recorded
 * IDEM-04  Simulated network retry (3 identical requests) → only 1 entry
 * IDEM-05  Idempotency key reuse after payment reversed → re-uses original payment ID (not a new one)
 * IDEM-06  No idempotency key → rapid identical API calls → duplicate detection depends on backend
 */

import { test, expect } from '@playwright/test'
import { TestEnv, currentMonthYear, firstOfMonthISO } from './helpers/seed'
import * as api from './helpers/api'
import * as a   from './helpers/assertions'

// ─────────────────────────────────────────────────────────────────────────────

test.describe('IDEM-01 — Same Key Sent Twice', () => {
  test('second call returns same payment ID; only 1 ledger entry; balance not doubled', async ({ request }) => {
    const suffix = `IDEM01-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)

    const iKey = `idem-01-${Date.now()}`

    const r1 = await api.recordPayment(request, env.token, env.propertyId, {
      tenantId, amount: 8000, method: 'cash', idempotencyKey: iKey,
    })
    const r2 = await api.recordPayment(request, env.token, env.propertyId, {
      tenantId, amount: 8000, method: 'cash', idempotencyKey: iKey,
    })

    // Same payment returned
    expect(r1.paymentId).toBe(r2.paymentId)

    // Only one payment_received entry
    const entries = await a.getLedgerEntriesByType(
      request, env.token, env.propertyId, tenantId, 'payment_received',
    )
    expect(entries.length).toBe(1)
    expect(entries[0].amount).toBe(8000)

    // Balance = 0 (paid once, not twice)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    await a.assertLedgerChainConsistency(request, env.token, env.propertyId, tenantId)
  })
})

test.describe('IDEM-02 — Same Key, Different Amount (First Wins)', () => {
  test('second call with different amount returns original payment; balance reflects first amount', async ({ request }) => {
    const suffix = `IDEM02-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)

    const iKey = `idem-02-${Date.now()}`

    // First: pay ₹5,000
    const r1 = await api.recordPayment(request, env.token, env.propertyId, {
      tenantId, amount: 5000, method: 'cash', idempotencyKey: iKey,
    })

    // Second: same key but different amount ₹8,000
    const r2 = await api.recordPayment(request, env.token, env.propertyId, {
      tenantId, amount: 8000, method: 'cash', idempotencyKey: iKey,
    })

    // Both return same payment ID (first wins)
    expect(r1.paymentId).toBe(r2.paymentId)

    // Only ₹5,000 was recorded (not ₹8,000)
    const entries = await a.getLedgerEntriesByType(
      request, env.token, env.propertyId, tenantId, 'payment_received',
    )
    expect(entries.length).toBe(1)
    expect(entries[0].amount).toBe(5000)

    // Balance = ₹3,000 remaining (8000 - 5000)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 3000)
  })
})

test.describe('IDEM-03 — Different Keys, Same Amount (Two Separate Payments)', () => {
  test('two different keys create two separate payment entries', async ({ request }) => {
    const suffix = `IDEM03-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 10_000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 10_000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)

    const key1 = `idem-03a-${Date.now()}`
    const key2 = `idem-03b-${Date.now() + 1}`

    const r1 = await api.recordPayment(request, env.token, env.propertyId, {
      tenantId, amount: 5000, method: 'cash', idempotencyKey: key1,
    })
    const r2 = await api.recordPayment(request, env.token, env.propertyId, {
      tenantId, amount: 5000, method: 'upi',  idempotencyKey: key2,
    })

    // Different payments
    expect(r1.paymentId).not.toBe(r2.paymentId)

    // Two ledger entries
    const entries = await a.getLedgerEntriesByType(
      request, env.token, env.propertyId, tenantId, 'payment_received',
    )
    expect(entries.length).toBe(2)

    // Balance = 0 (₹5,000 + ₹5,000 = ₹10,000)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    await a.assertLedgerChainConsistency(request, env.token, env.propertyId, tenantId)
  })
})

test.describe('IDEM-04 — Simulated Network Retry (3 Identical Requests)', () => {
  test('3 retries with the same key produce exactly 1 ledger entry', async ({ request }) => {
    const suffix = `IDEM04-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)

    const iKey = `idem-retry-${Date.now()}`
    const paymentData = { tenantId, amount: 8000, method: 'cash', idempotencyKey: iKey }

    // Fire 3 "retries" sequentially (simulating client retry logic)
    const results = await Promise.all([
      api.recordPayment(request, env.token, env.propertyId, paymentData),
      api.recordPayment(request, env.token, env.propertyId, paymentData),
      api.recordPayment(request, env.token, env.propertyId, paymentData),
    ])

    // All return the same payment ID
    const ids = results.map(r => r.paymentId)
    expect(new Set(ids).size).toBe(1) // all identical

    // Only one ledger entry
    const entries = await a.getLedgerEntriesByType(
      request, env.token, env.propertyId, tenantId, 'payment_received',
    )
    expect(entries.length).toBe(1)

    // Balance correct
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    await a.assertLedgerChainConsistency(request, env.token, env.propertyId, tenantId)
  })
})

test.describe('IDEM-05 — Idempotency Key After Payment Reversed', () => {
  test('after reversal, re-sending the same key returns the ORIGINAL payment (reversed state)', async ({ request }) => {
    const suffix = `IDEM05-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)

    const iKey = `idem-05-${Date.now()}`

    // Pay
    const r1 = await api.recordPayment(request, env.token, env.propertyId, {
      tenantId, amount: 8000, method: 'cash', idempotencyKey: iKey,
    })
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 0)

    // Reverse
    await api.reversePayment(request, env.token, env.propertyId, r1.paymentId, 'IDEM-05 reversal')
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 8000)

    // Re-send with same key — backend should return the original (reversed) payment
    // This MUST NOT create a new ledger credit entry
    const entriesBeforeRetry = (await api.getTenantLedger(
      request, env.token, env.propertyId, tenantId,
    )).entries.length

    const r2 = await api.recordPayment(request, env.token, env.propertyId, {
      tenantId, amount: 8000, method: 'cash', idempotencyKey: iKey,
    })

    // Returns original payment ID
    expect(r2.paymentId).toBe(r1.paymentId)

    // No new credit entries added
    const entriesAfterRetry = (await api.getTenantLedger(
      request, env.token, env.propertyId, tenantId,
    )).entries.length
    expect(entriesAfterRetry).toBe(entriesBeforeRetry)

    // Balance still reflects the reversal (not the retry)
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 8000)
  })
})
