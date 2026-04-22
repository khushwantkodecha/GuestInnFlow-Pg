/**
 * fuzz.spec.ts — Randomised operation sequences
 *
 * Rather than scripted scenarios, these tests run semi-random sequences of
 * valid financial operations and verify three things after every step:
 *
 *   1. The system did not crash (no 5xx errors)
 *   2. The API-computed balance equals our locally-tracked expected balance
 *   3. The system invariant holds (Σ ledger = currentBalance)
 *
 * The random seed is derived from Date.now() so each CI run exercises a
 * different sequence, but the expected balance is always computed alongside
 * the actual operations — the test is fully deterministic given the same seed.
 *
 * FUZZ-01  12-step random sequence (rentable ops only)
 * FUZZ-02  20-step mixed sequence with reversals
 * FUZZ-03  Charge-heavy fuzz (80 % chance of charge per step)
 * FUZZ-04  Payment-heavy fuzz (small amounts, many steps)
 */

import { test, expect } from '@playwright/test'
import { TestEnv, currentMonthYear, firstOfMonthISO } from './helpers/seed'
import * as api from './helpers/api'
import * as a   from './helpers/assertions'

// ─── Minimal PRNG so sequences are reproducible from seed ────────────────────

class PRNG {
  private s: number
  constructor(seed: number) { this.s = seed >>> 0 }
  next(): number {                             // [0, 1)
    this.s = (Math.imul(1664525, this.s) + 1013904223) >>> 0
    return this.s / 0x100000000
  }
  int(min: number, max: number): number {      // [min, max]
    return Math.floor(this.next() * (max - min + 1)) + min
  }
  pick<T>(arr: T[]): T { return arr[this.int(0, arr.length - 1)] }
  chance(p: number): boolean { return this.next() < p }
}

// ─── Step types the fuzz engine can generate ─────────────────────────────────

type FuzzStep =
  | { kind: 'generateRent' }
  | { kind: 'pay';    amount: number }
  | { kind: 'charge'; amount: number }
  | { kind: 'reverse'; paymentId: string; originalAmount: number }

interface FuzzState {
  expectedBalance:  number
  rentGenerated:    boolean
  payments:         Array<{ id: string; amount: number }>
  log:              string[]
}

// ─── Core executor ───────────────────────────────────────────────────────────

async function runFuzz(
  request:    import('@playwright/test').APIRequestContext,
  env:        TestEnv,
  tenantId:   string,
  steps:      number,
  rng:        PRNG,
  opts: {
    chargeProbability?:   number   // 0-1; default 0.25
    reverseProbability?:  number   // 0-1; default 0.15
    maxPaymentAmount?:    number   // default 12000
  } = {},
): Promise<void> {
  const { month, year } = currentMonthYear()
  const {
    chargeProbability  = 0.25,
    reverseProbability = 0.15,
    maxPaymentAmount   = 12_000,
  } = opts

  const state: FuzzState = {
    expectedBalance: 0,
    rentGenerated:   false,
    payments:        [],
    log:             [],
  }

  for (let step = 0; step < steps; step++) {
    // Build available operations
    const ops: Array<() => Promise<FuzzStep>> = []

    if (!state.rentGenerated) {
      ops.push(async () => {
        await api.generateRent(request, env.token, env.propertyId, month, year)
        return { kind: 'generateRent' }
      })
    } else {
      // Pay
      ops.push(async () => {
        const amount = rng.int(500, maxPaymentAmount)
        const { paymentId } = await api.recordPayment(request, env.token, env.propertyId, {
          tenantId, amount, method: 'cash',
        })
        return { kind: 'pay', amount, paymentId: paymentId } as FuzzStep
      })
    }

    // Charge (always available after tenant is assigned)
    if (rng.chance(chargeProbability)) {
      ops.push(async () => {
        const amount = rng.int(100, 2000)
        await api.addCharge(request, env.token, env.propertyId, tenantId, {
          amount, description: `Fuzz charge ${step}`,
        })
        return { kind: 'charge', amount }
      })
    }

    // Reversal (only if we have unreversed payments)
    if (state.payments.length > 0 && rng.chance(reverseProbability)) {
      const target = rng.pick(state.payments)
      ops.push(async () => {
        await api.reversePayment(request, env.token, env.propertyId, target.id)
        return { kind: 'reverse', paymentId: target.id, originalAmount: target.amount }
      })
    }

    // Pick and execute a random op
    const op     = rng.pick(ops)
    const result = await op()
    state.log.push(`step ${step}: ${JSON.stringify(result)}`)

    // Track expected balance
    if (result.kind === 'generateRent') {
      // Rent amount is 8000 (base for fuzz tests)
      state.expectedBalance += 8000
      state.rentGenerated = true
    } else if (result.kind === 'pay') {
      state.expectedBalance -= result.amount
      state.payments.push({ id: result.paymentId, amount: result.amount })
    } else if (result.kind === 'charge') {
      state.expectedBalance += result.amount
    } else if (result.kind === 'reverse') {
      state.expectedBalance += result.originalAmount
      // Remove from reversible list so we don't try to reverse it again
      const idx = state.payments.findIndex(p => p.id === result.paymentId)
      if (idx !== -1) state.payments.splice(idx, 1)
    }

    // After every step: verify system invariant
    const actualBalance = await api.getCurrentBalance(request, env.token, env.propertyId, tenantId)
    expect(
      actualBalance,
      `After step ${step} (${result.kind}): expected balance ${state.expectedBalance} but got ${actualBalance}.\nLog:\n${state.log.join('\n')}`,
    ).toBe(state.expectedBalance)

    await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
  }
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('FUZZ-01 — 12-step Random Sequence', () => {
  test('no crash + invariant at every step (12 ops)', async ({ request }) => {
    const seed   = Date.now() % 0xFFFFFF
    const suffix = `FZ01-${seed}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const rng    = new PRNG(seed)

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      moveInDate:   firstOfMonthISO(),
    })

    await runFuzz(request, env, tenantId, 12, rng)
  })
})

test.describe('FUZZ-02 — 20-step Mixed Sequence with Reversals', () => {
  test('no crash + invariant holds including after reversals (20 ops)', async ({ request }) => {
    const seed   = (Date.now() + 42) % 0xFFFFFF
    const suffix = `FZ02-${seed}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const rng    = new PRNG(seed)

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      moveInDate:   firstOfMonthISO(),
    })

    await runFuzz(request, env, tenantId, 20, rng, {
      reverseProbability: 0.30,   // more reversals
      maxPaymentAmount:   6000,
    })
  })
})

test.describe('FUZZ-03 — Charge-Heavy Fuzz', () => {
  test('many small charges + periodic payments; invariant at every step', async ({ request }) => {
    const seed   = (Date.now() + 99) % 0xFFFFFF
    const suffix = `FZ03-${seed}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const rng    = new PRNG(seed)

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      moveInDate:   firstOfMonthISO(),
    })

    await runFuzz(request, env, tenantId, 15, rng, {
      chargeProbability: 0.70,   // mostly charges
      maxPaymentAmount:  4000,
    })
  })
})

test.describe('FUZZ-04 — Payment-Heavy Fuzz (Small Amounts)', () => {
  test('many small payments; balance tracks correctly; no phantom entries', async ({ request }) => {
    const seed   = (Date.now() + 777) % 0xFFFFFF
    const suffix = `FZ04-${seed}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const rng    = new PRNG(seed)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      moveInDate:   firstOfMonthISO(),
    })

    // Pre-generate rent so all steps are payment ops
    await api.generateRent(request, env.token, env.propertyId, month, year)

    // Run 15 small payment steps manually (override the fuzz engine for this pattern)
    let expectedBalance = 8000
    for (let i = 0; i < 15; i++) {
      const amount = rng.int(100, 2000)
      await api.recordPayment(request, env.token, env.propertyId, {
        tenantId, amount, method: 'cash',
      })
      expectedBalance -= amount

      const actual = await api.getCurrentBalance(request, env.token, env.propertyId, tenantId)
      expect(actual, `Step ${i}: expected ${expectedBalance} got ${actual}`).toBe(expectedBalance)
      await a.assertSystemInvariant(request, env.token, env.propertyId, tenantId)
    }

    // Verify count: 1 rent_generated + 15 payment_received entries
    const payEntries = await a.getLedgerEntriesByType(
      request, env.token, env.propertyId, tenantId, 'payment_received',
    )
    expect(payEntries.length).toBe(15)

    await a.assertLedgerChainConsistency(request, env.token, env.propertyId, tenantId)
  })
})
