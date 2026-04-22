/**
 * api.ts — Direct API client for backend (port 5001)
 *
 * All functions use Playwright's APIRequestContext so they run inside
 * the test process without spinning up a browser.  Pass the `request`
 * fixture from a test or a global setup context.
 *
 * Base URL: http://localhost:5001/api  (Vite proxies /api → this in-browser)
 * Auth:     Bearer token in Authorization header
 */

import type { APIRequestContext } from '@playwright/test'

export const API = 'http://localhost:5001/api'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthResult {
  token:  string
  userId: string
}

export interface LedgerEntry {
  _id:           string
  type:          'debit' | 'credit'
  referenceType: string
  amount:        number
  balanceAfter:  number
  description:   string | null
  method:        string | null
  createdAt:     string
}

export interface LedgerResult {
  entries:        LedgerEntry[]
  currentBalance: number
  totalPages:     number
}

export interface RentRecord {
  _id:           string
  tenant:        string
  amount:        number
  paidAmount:    number
  balance:       number
  status:        'pending' | 'partial' | 'paid' | 'overdue'
  month:         number
  year:          number
  paymentDate:   string | null
  paymentMethod: string | null
  notes:         string | null
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function register(
  request: APIRequestContext,
  suffix: string,
): Promise<AuthResult> {
  const email    = `test-${suffix}@guestinnflow-qa.test`
  const password = 'TestPass123!'
  const name     = `QA User ${suffix}`

  const res = await request.post(`${API}/auth/register`, {
    data: { name, email, password, phone: `9${suffix.slice(-9).padStart(9, '0')}` },
  })

  if (!res.ok()) {
    // Already registered — just login
    return login(request, email, password)
  }

  const body = await res.json()
  return { token: body.token, userId: body.data.id }
}

export async function login(
  request: APIRequestContext,
  email:   string,
  password: string,
): Promise<AuthResult> {
  const res = await request.post(`${API}/auth/login`, {
    data: { email, password },
  })
  const body = await res.json()
  if (!res.ok()) throw new Error(`Login failed: ${body.message}`)
  return { token: body.token, userId: body.data.id }
}

// ─── Properties ───────────────────────────────────────────────────────────────

export async function createProperty(
  request: APIRequestContext,
  token:   string,
  suffix:  string,
): Promise<string> {
  const res = await request.post(`${API}/properties`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name:    `Test PG ${suffix}`,
      type:    'pg',
      address: { street: '1 Test Road', city: 'Testville', state: 'KA', pincode: '560001' },
    },
  })
  const body = await res.json()
  if (!res.ok()) throw new Error(`createProperty: ${body.message}`)
  return body.data._id as string
}

// ─── Rooms ────────────────────────────────────────────────────────────────────

/**
 * Creates a single-occupancy room. The server auto-creates one bed.
 * Returns { roomId, bedId }.
 */
export async function createSingleRoom(
  request:    APIRequestContext,
  token:      string,
  propertyId: string,
  suffix:     string,
  baseRent    = 8000,
): Promise<{ roomId: string; bedId: string }> {
  const roomRes = await request.post(`${API}/properties/${propertyId}/rooms`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      roomNumber: `R${suffix}`,
      type:       'single',
      baseRent,
      floor:      0,
    },
  })
  const roomBody = await roomRes.json()
  if (!roomRes.ok()) throw new Error(`createRoom: ${roomBody.message}`)
  const roomId = roomBody.data._id as string

  // Fetch the auto-created bed
  const bedRes = await request.get(`${API}/properties/${propertyId}/rooms/${roomId}/beds`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const bedBody = await bedRes.json()
  if (!bedRes.ok()) throw new Error(`getBeds: ${bedBody.message}`)
  const bedId = bedBody.data[0]._id as string

  return { roomId, bedId }
}

// ─── Tenants ──────────────────────────────────────────────────────────────────

export async function createTenant(
  request:    APIRequestContext,
  token:      string,
  propertyId: string,
  suffix:     string,
  overrides:  Record<string, unknown> = {},
): Promise<string> {
  const res = await request.post(`${API}/properties/${propertyId}/tenants`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name:  `Tenant ${suffix}`,
      phone: `9${suffix.slice(-9).padStart(9, '0')}`,
      ...overrides,
    },
  })
  const body = await res.json()
  if (!res.ok()) throw new Error(`createTenant: ${body.message}`)
  return body.data._id as string
}

export async function assignTenantToBed(
  request:    APIRequestContext,
  token:      string,
  propertyId: string,
  roomId:     string,
  bedId:      string,
  tenantId:   string,
  opts: {
    moveInDate?:   string   // 'YYYY-MM-DD'
    rentOverride?: number
    deposit?:      number
  } = {},
): Promise<void> {
  const res = await request.patch(
    `${API}/properties/${propertyId}/rooms/${roomId}/beds/${bedId}/assign`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        tenantId,
        moveInDate:   opts.moveInDate,
        rentOverride: opts.rentOverride,
        deposit:      opts.deposit ?? 0,
      },
    },
  )
  const body = await res.json()
  if (!res.ok()) throw new Error(`assignBed: ${body.message}`)
}

// ─── Rent ─────────────────────────────────────────────────────────────────────

export async function generateRent(
  request:    APIRequestContext,
  token:      string,
  propertyId: string,
  month:      number,
  year:       number,
): Promise<{ created: number; records: RentRecord[] }> {
  const res = await request.post(`${API}/properties/${propertyId}/rents/generate`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { month, year },
  })
  const body = await res.json()
  if (!res.ok()) throw new Error(`generateRent: ${body.message}`)
  return { created: body.data.created, records: body.data.records }
}

export async function getTenantRents(
  request:    APIRequestContext,
  token:      string,
  propertyId: string,
  tenantId:   string,
): Promise<RentRecord[]> {
  const res = await request.get(
    `${API}/properties/${propertyId}/rents/tenants/${tenantId}/rents`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const body = await res.json()
  if (!res.ok()) throw new Error(`getTenantRents: ${body.message}`)
  return body.data as RentRecord[]
}

export async function getAllRents(
  request:    APIRequestContext,
  token:      string,
  propertyId: string,
  params:     Record<string, string> = {},
): Promise<RentRecord[]> {
  const qs  = new URLSearchParams(params).toString()
  const url = `${API}/properties/${propertyId}/rents${qs ? `?${qs}` : ''}`
  const res = await request.get(url, { headers: { Authorization: `Bearer ${token}` } })
  const body = await res.json()
  if (!res.ok()) throw new Error(`getAllRents: ${body.message}`)
  return body.data as RentRecord[]
}

// ─── Payments ─────────────────────────────────────────────────────────────────

export async function recordPayment(
  request:    APIRequestContext,
  token:      string,
  propertyId: string,
  data: {
    tenantId:       string
    amount:         number
    method?:        string
    notes?:         string
    paymentDate?:   string
    idempotencyKey?: string
  },
): Promise<{ paymentId: string; newBalance: number; advanceApplied: number }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (data.idempotencyKey) headers['x-idempotency-key'] = data.idempotencyKey

  const res = await request.post(`${API}/properties/${propertyId}/rents/payments`, {
    headers,
    data: {
      tenantId:    data.tenantId,
      amount:      data.amount,
      method:      data.method ?? 'cash',
      notes:       data.notes,
      paymentDate: data.paymentDate,
    },
  })
  const body = await res.json()
  if (!res.ok()) {
    const err: Error & { status?: number; code?: string } = new Error(body.message)
    err.status = res.status()
    err.code   = body.code
    throw err
  }
  return {
    paymentId:     body.data.payment._id,
    newBalance:    body.data.newBalance,
    advanceApplied: body.data.payment.advanceApplied ?? 0,
  }
}

export async function reversePayment(
  request:    APIRequestContext,
  token:      string,
  propertyId: string,
  paymentId:  string,
  reason?:    string,
): Promise<void> {
  const res = await request.post(
    `${API}/properties/${propertyId}/rents/payments/${paymentId}/reverse`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data:    { reason },
    },
  )
  const body = await res.json()
  if (!res.ok()) throw new Error(`reversePayment: ${body.message}`)
}

// ─── Charges ──────────────────────────────────────────────────────────────────

export async function addCharge(
  request:    APIRequestContext,
  token:      string,
  propertyId: string,
  tenantId:   string,
  data: {
    amount:       number
    description?: string
    chargeDate?:  string
  },
): Promise<void> {
  const res = await request.post(
    `${API}/properties/${propertyId}/rents/tenants/${tenantId}/charge`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data,
    },
  )
  const body = await res.json()
  if (!res.ok()) throw new Error(`addCharge: ${body.message}`)
}

// ─── Ledger ───────────────────────────────────────────────────────────────────

export async function getTenantLedger(
  request:    APIRequestContext,
  token:      string,
  propertyId: string,
  tenantId:   string,
): Promise<LedgerResult> {
  const res = await request.get(
    `${API}/properties/${propertyId}/rents/tenants/${tenantId}/ledger`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const body = await res.json()
  if (!res.ok()) throw new Error(`getLedger: ${body.message}`)
  return body.data as LedgerResult
}

/** Returns the most-recent ledger entry (the current running balance). */
export async function getLastLedgerEntry(
  request:    APIRequestContext,
  token:      string,
  propertyId: string,
  tenantId:   string,
): Promise<LedgerEntry | null> {
  const ledger = await getTenantLedger(request, token, propertyId, tenantId)
  return ledger.entries[0] ?? null
}

export async function getCurrentBalance(
  request:    APIRequestContext,
  token:      string,
  propertyId: string,
  tenantId:   string,
): Promise<number> {
  const ledger = await getTenantLedger(request, token, propertyId, tenantId)
  return ledger.currentBalance
}

// ─── Deposit ──────────────────────────────────────────────────────────────────

export async function vacateWithPayment(
  request:    APIRequestContext,
  token:      string,
  propertyId: string,
  tenantId:   string,
  opts: {
    vacateOption?:       'collect' | 'proceed'
    paymentAmount?:      number
    paymentMethod?:      string
    depositAction?:      'adjust' | 'adjust_and_refund' | 'refund' | 'forfeit' | null
    refundAmount?:       number
    refundMethod?:       string
    advanceCreditRefund?: boolean
    checkOutDate?:       string
    notes?:              string
  } = {},
): Promise<{ depositBalance: number; depositStatus: string; ledgerBalance: number }> {
  const res = await request.post(
    `${API}/properties/${propertyId}/tenants/${tenantId}/vacate-with-payment`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data:    opts,
    },
  )
  const body = await res.json()
  if (!res.ok()) {
    const err: Error & { status?: number; code?: string } = new Error(body.message)
    err.status = res.status()
    err.code   = body.code
    throw err
  }
  const t = body.data.tenant
  return {
    depositBalance: t.depositBalance  ?? 0,
    depositStatus:  t.depositStatus   ?? 'none',
    ledgerBalance:  t.ledgerBalance   ?? 0,
  }
}

// ─── Reservation ──────────────────────────────────────────────────────────────

export async function reserveBed(
  request:    APIRequestContext,
  token:      string,
  propertyId: string,
  roomId:     string,
  bedId:      string,
  data: {
    tenantId?:     string
    reservedTill:  string   // ISO future date
    advance?:      number
    advanceMode?:  string
    moveInDate?:   string
    notes?:        string
  },
): Promise<void> {
  const res = await request.patch(
    `${API}/properties/${propertyId}/rooms/${roomId}/beds/${bedId}/reserve`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        tenantId:    data.tenantId,
        reservedTill: data.reservedTill,
        advance:     data.advance,
        advanceMode: data.advanceMode,
        moveInDate:  data.moveInDate,
        notes:       data.notes,
      },
    },
  )
  const body = await res.json()
  if (!res.ok()) throw new Error(`reserveBed: ${body.message}`)
}

export async function cancelReservation(
  request:    APIRequestContext,
  token:      string,
  propertyId: string,
  roomId:     string,
  bedId:      string,
  forfeit:    boolean = false,
): Promise<void> {
  const res = await request.patch(
    `${API}/properties/${propertyId}/rooms/${roomId}/beds/${bedId}/unreserve`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data:    { forfeit },
    },
  )
  const body = await res.json()
  if (!res.ok()) throw new Error(`cancelReservation: ${body.message}`)
}

export async function getTenantById(
  request:    APIRequestContext,
  token:      string,
  propertyId: string,
  tenantId:   string,
): Promise<Record<string, unknown>> {
  const res = await request.get(
    `${API}/properties/${propertyId}/tenants/${tenantId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  const body = await res.json()
  if (!res.ok()) throw new Error(`getTenant: ${body.message}`)
  return body.data as Record<string, unknown>
}
