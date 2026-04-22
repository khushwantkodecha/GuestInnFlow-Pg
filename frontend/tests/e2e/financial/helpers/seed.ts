/**
 * seed.ts — Test environment factory
 *
 * Creates a fully isolated test context per test run:
 *   • unique user (register + login)
 *   • one property
 *   • one single-occupancy room (auto-creates 1 bed)
 *
 * Call `env.createTenant()` to create a tenant and optionally assign them.
 * Each invocation returns a new tenant; the room/bed can be reused for
 * sequential tests within a describe block.
 *
 * Usage:
 *   const env = await TestEnv.create(request, Date.now().toString())
 *   const t   = await env.createAssignedTenant({ rentOverride: 8000 })
 *   // → t.tenantId, env.propertyId, env.roomId, env.bedId, env.token
 */

import type { APIRequestContext } from '@playwright/test'
import * as api from './api'

export interface TenantCtx {
  tenantId: string
}

export class TestEnv {
  readonly token:      string
  readonly propertyId: string
  readonly roomId:     string
  readonly bedId:      string

  private readonly request:  APIRequestContext
  private readonly suffix:   string

  private constructor(
    request:    APIRequestContext,
    token:      string,
    propertyId: string,
    roomId:     string,
    bedId:      string,
    suffix:     string,
  ) {
    this.request    = request
    this.token      = token
    this.propertyId = propertyId
    this.roomId     = roomId
    this.bedId      = bedId
    this.suffix     = suffix
  }

  /** Bootstrap a complete isolated test environment. */
  static async create(
    request:  APIRequestContext,
    suffix:   string,
    baseRent  = 8000,
  ): Promise<TestEnv> {
    const auth = await api.register(request, suffix)
    const pid  = await api.createProperty(request, auth.token, suffix)
    const { roomId, bedId } = await api.createSingleRoom(
      request, auth.token, pid, suffix, baseRent,
    )
    return new TestEnv(request, auth.token, pid, roomId, bedId, suffix)
  }

  /**
   * Creates a tenant in this property WITHOUT assigning them to a bed.
   * Use when you need an unassigned tenant (e.g. for reservation tests).
   */
  async createTenant(overrides: Record<string, unknown> = {}): Promise<TenantCtx> {
    const idx      = Date.now().toString().slice(-6)
    const tenantId = await api.createTenant(
      this.request, this.token, this.propertyId,
      `${this.suffix}${idx}`, overrides,
    )
    return { tenantId }
  }

  /**
   * Creates a tenant AND assigns them to the env's bed.
   *
   * opts.rentOverride — overrides the room's base rent (e.g. to test exact amounts)
   * opts.deposit      — security deposit amount
   * opts.moveInDate   — 'YYYY-MM-DD'; defaults to today
   */
  async createAssignedTenant(opts: {
    rentOverride?: number
    deposit?:      number
    moveInDate?:   string
  } = {}): Promise<TenantCtx> {
    const { tenantId } = await this.createTenant()
    await api.assignTenantToBed(
      this.request, this.token, this.propertyId,
      this.roomId, this.bedId, tenantId,
      {
        moveInDate:   opts.moveInDate   ?? todayISO(),
        rentOverride: opts.rentOverride,
        deposit:      opts.deposit,
      },
    )
    return { tenantId }
  }
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/** Returns today as 'YYYY-MM-DD' (local). */
export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Returns the first day of the current month as 'YYYY-MM-DD'. */
export function firstOfMonthISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/** Returns 'YYYY-MM-DD' for the Nth day of the current month. */
export function nthDayOfMonthISO(day: number): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Current month (1–12) and year. */
export function currentMonthYear(): { month: number; year: number } {
  const d = new Date()
  return { month: d.getMonth() + 1, year: d.getFullYear() }
}

/**
 * Calculates the expected pro-rated rent amount.
 * Uses the same formula as computeFirstCycleCharge in rentService.js.
 *
 * @param fullRent  - monthly rent amount (e.g. 6000)
 * @param checkIn   - tenant check-in date
 * @param cycleStart - first day of billing cycle (midnight)
 * @param cycleEnd  - last ms of billing cycle (1ms before next cycleStart)
 */
export function calcProration(
  fullRent:   number,
  checkIn:    Date,
  cycleStart: Date,
  cycleEnd:   Date,
): number {
  const checkInNorm = new Date(checkIn)
  checkInNorm.setHours(0, 0, 0, 0)

  // Proration only applies when checkIn is strictly inside the cycle
  if (checkInNorm <= cycleStart || checkInNorm > cycleEnd) return fullRent

  const totalMs    = cycleEnd.getTime() + 1 - cycleStart.getTime()
  const occupiedMs = cycleEnd.getTime() + 1 - checkInNorm.getTime()
  return Math.max(0, Math.round((fullRent * occupiedMs) / totalMs))
}

/**
 * For the current calendar month with billingDay=1:
 * Returns { cycleStart, cycleEnd, expectedProration } for a given checkIn day.
 */
export function prorationForDay(checkInDay: number, fullRent: number) {
  const now   = new Date()
  const year  = now.getFullYear()
  const month = now.getMonth() // 0-based

  const cycleStart = new Date(year, month, 1, 0, 0, 0, 0)
  const nextMs     = new Date(year, month + 1, 1, 0, 0, 0, 0).getTime()
  const cycleEnd   = new Date(nextMs - 1)

  const checkIn    = new Date(year, month, checkInDay, 0, 0, 0, 0)
  const amount     = calcProration(fullRent, checkIn, cycleStart, cycleEnd)

  return { cycleStart, cycleEnd, checkIn, amount }
}

/** Future ISO date string N days from now. */
export function futureDateISO(daysAhead = 30): string {
  const d = new Date()
  d.setDate(d.getDate() + daysAhead)
  return d.toISOString().split('T')[0]
}
