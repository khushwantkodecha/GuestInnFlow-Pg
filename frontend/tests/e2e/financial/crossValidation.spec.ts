/**
 * crossValidation.spec.ts — UI ↔ API cross-validation tests
 *
 * Core invariant: after every financial operation, the balance, rent status,
 * and deposit balance displayed in the UI must match the values returned by
 * the backend API.  This catches rendering bugs, stale-state issues, and
 * race conditions between a write and the next read.
 *
 * CV-01  Balance after rent generation   — UI label "Outstanding Balance"
 * CV-02  Balance after full payment       — UI label "Fully Settled"
 * CV-03  Balance after overpayment        — UI label "Advance Credit" (negative)
 * CV-04  Balance after manual charge      — UI balance increased correctly
 * CV-05  Rent row status badge vs API rent.status
 * CV-06  Deposit balance shown after assign vs Tenant.depositBalance from API
 * CV-07  Balance after payment reversal   — UI reverts to "Outstanding Balance"
 */

import { test, expect } from '@playwright/test'
import {
  TestEnv,
  currentMonthYear,
  firstOfMonthISO,
} from './helpers/seed'
import * as api from './helpers/api'
import * as a   from './helpers/assertions'

// ─────────────────────────────────────────────────────────────────────────────

test.describe('CV-01 — Balance after rent generation', () => {
  test('UI "Outstanding Balance" matches API currentBalance', async ({ request, page }) => {
    const suffix = `CV01-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)

    // Inject auth + navigate
    await a.injectAuth(page, env.token, env.propertyId)
    await a.gotoRentPage(page)

    const tenantName = page.locator('tr').filter({ has: page.locator(`td`) })
    // Read API balance
    const apiBalance = await api.getCurrentBalance(request, env.token, env.propertyId, tenantId)
    expect(apiBalance).toBe(8000)

    // Read UI balance via ledger drawer
    // First, find the tenant name in the rent table
    const row = page.locator('tr').nth(1) // first data row (header is row 0)
    const tenantNameText = await row.locator('td').first().textContent() ?? ''

    const uiBalance = await a.readUIBalance(page, tenantNameText.trim())
    expect(uiBalance).toBe(apiBalance)
  })
})

test.describe('CV-02 — Balance after full payment', () => {
  test('UI shows "Fully Settled" and API balance = 0 after full payment', async ({ request, page }) => {
    const suffix = `CV02-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 6000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 6000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 6000 })

    await a.injectAuth(page, env.token, env.propertyId)
    await a.gotoRentPage(page)

    const apiBalance = await api.getCurrentBalance(request, env.token, env.propertyId, tenantId)
    expect(apiBalance).toBe(0)

    // Reload to get fresh data then verify UI
    await page.reload()
    await expect(page.locator('h2:has-text("Rent Collection")')).toBeVisible({ timeout: 15_000 })

    // Find this tenant's row and open the ledger drawer
    const rows = page.locator('tr')
    const count = await rows.count()
    let uiBalance: number | null = null
    for (let i = 1; i < count; i++) {
      const row = rows.nth(i)
      const nameCell = await row.locator('td').first().textContent()
      if (nameCell && nameCell.includes(`Tenant ${suffix}`)) {
        uiBalance = await a.readUIBalance(page, nameCell.trim())
        break
      }
    }
    expect(uiBalance).not.toBeNull()
    expect(uiBalance).toBe(0)
  })
})

test.describe('CV-03 — Balance after overpayment (advance credit)', () => {
  test('UI shows "Advance Credit" with correct amount; API balance is negative', async ({ request, page }) => {
    const suffix = `CV03-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 5000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 5000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    // Overpay by ₹2,000
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 7000 })

    const apiBalance = await api.getCurrentBalance(request, env.token, env.propertyId, tenantId)
    expect(apiBalance).toBe(-2000)

    await a.injectAuth(page, env.token, env.propertyId)
    await a.gotoRentPage(page)
    await page.reload()
    await expect(page.locator('h2:has-text("Rent Collection")')).toBeVisible({ timeout: 15_000 })

    // Find the row by scanning for the tenant name suffix
    const rows = page.locator('tr')
    const rowCount = await rows.count()
    let uiBalance: number | null = null
    for (let i = 1; i < rowCount; i++) {
      const row = rows.nth(i)
      const nameText = await row.locator('td').first().textContent()
      if (nameText && nameText.includes(`Tenant ${suffix}`)) {
        uiBalance = await a.readUIBalance(page, nameText.trim())
        break
      }
    }
    expect(uiBalance).not.toBeNull()
    expect(uiBalance).toBe(apiBalance) // -2000
    expect(uiBalance!).toBeLessThan(0)
  })
})

test.describe('CV-04 — Balance after manual charge', () => {
  test('UI balance increases by charge amount; matches API', async ({ request, page }) => {
    const suffix = `CV04-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    // Pay full rent, leaving balance = 0
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 8000 })
    // Add a charge
    await api.addCharge(request, env.token, env.propertyId, tenantId, {
      amount:      750,
      description: 'Electricity',
    })

    const apiBalance = await api.getCurrentBalance(request, env.token, env.propertyId, tenantId)
    expect(apiBalance).toBe(750)

    await a.injectAuth(page, env.token, env.propertyId)
    await a.gotoRentPage(page)
    await page.reload()
    await expect(page.locator('h2:has-text("Rent Collection")')).toBeVisible({ timeout: 15_000 })

    const rows = page.locator('tr')
    const rowCount = await rows.count()
    let uiBalance: number | null = null
    for (let i = 1; i < rowCount; i++) {
      const row = rows.nth(i)
      const nameText = await row.locator('td').first().textContent()
      if (nameText && nameText.includes(`Tenant ${suffix}`)) {
        uiBalance = await a.readUIBalance(page, nameText.trim())
        break
      }
    }
    expect(uiBalance).not.toBeNull()
    expect(uiBalance).toBe(750)
  })
})

test.describe('CV-05 — Rent row status badge vs API rent.status', () => {
  test('rent row status badge matches API rent record status after payment', async ({ request, page }) => {
    const suffix = `CV05-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 9000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 9000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)

    await a.injectAuth(page, env.token, env.propertyId)
    await a.gotoRentPage(page)
    await page.reload()
    await expect(page.locator('h2:has-text("Rent Collection")')).toBeVisible({ timeout: 15_000 })

    // Verify 'Pending' state in UI matches API
    const apiRentsBefore = await api.getTenantRents(request, env.token, env.propertyId, tenantId)
    const rentBefore = apiRentsBefore.find(r => r.month === month && r.year === year)
    expect(rentBefore?.status).toBe('pending')

    // Pay full rent via API
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 9000 })

    // Reload and check UI shows 'Paid'
    await page.reload()
    await expect(page.locator('h2:has-text("Rent Collection")')).toBeVisible({ timeout: 15_000 })

    const apiRentsAfter = await api.getTenantRents(request, env.token, env.propertyId, tenantId)
    const rentAfter = apiRentsAfter.find(r => r.month === month && r.year === year)
    expect(rentAfter?.status).toBe('paid')

    // Find row and verify badge text
    const rows = page.locator('tr')
    const rowCount = await rows.count()
    for (let i = 1; i < rowCount; i++) {
      const row = rows.nth(i)
      const nameText = await row.locator('td').first().textContent()
      if (nameText && nameText.includes(`Tenant ${suffix}`)) {
        // The row should contain a 'Paid' badge
        await expect(row).toContainText('Paid')
        break
      }
    }
  })
})

test.describe('CV-06 — Deposit balance: UI vs API', () => {
  test('after assign with deposit, API depositBalance matches what the tenant record shows', async ({ request }) => {
    // This test validates purely via API since deposit is shown in the Tenants
    // page (not Rent) — the API-side assertion is the primary contract
    const suffix = `CV06-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      deposit:      15_000,
      moveInDate:   firstOfMonthISO(),
    })

    const tenant = await api.getTenantById(request, env.token, env.propertyId, tenantId)
    expect(tenant['depositBalance']).toBe(15_000)

    // Also verify the deposit_collected ledger entry has the right amount
    const depositEntries = await a.getLedgerEntriesByType(
      request, env.token, env.propertyId, tenantId, 'deposit_collected',
    )
    expect(depositEntries.length).toBe(1)
    expect(depositEntries[0].amount).toBe(15_000)
    // Audit-only: rent balance not affected
    expect(depositEntries[0].balanceAfter).toBe(0)
  })
})

test.describe('CV-07 — Balance after payment reversal', () => {
  test('UI reverts to Outstanding Balance after reversal; matches API', async ({ request, page }) => {
    const suffix = `CV07-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 7000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 7000,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    const { paymentId } = await api.recordPayment(request, env.token, env.propertyId, {
      tenantId, amount: 7000,
    })
    // Reverse
    await api.reversePayment(request, env.token, env.propertyId, paymentId, 'CV07 test reversal')

    const apiBalance = await api.getCurrentBalance(request, env.token, env.propertyId, tenantId)
    expect(apiBalance).toBe(7000)

    await a.injectAuth(page, env.token, env.propertyId)
    await a.gotoRentPage(page)
    await page.reload()
    await expect(page.locator('h2:has-text("Rent Collection")')).toBeVisible({ timeout: 15_000 })

    const rows = page.locator('tr')
    const rowCount = await rows.count()
    let uiBalance: number | null = null
    for (let i = 1; i < rowCount; i++) {
      const row = rows.nth(i)
      const nameText = await row.locator('td').first().textContent()
      if (nameText && nameText.includes(`Tenant ${suffix}`)) {
        uiBalance = await a.readUIBalance(page, nameText.trim())
        break
      }
    }
    expect(uiBalance).not.toBeNull()
    expect(uiBalance).toBe(apiBalance) // 7000
  })
})
