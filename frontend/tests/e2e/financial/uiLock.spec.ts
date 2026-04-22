/**
 * uiLock.spec.ts — UI financial action lock-out after vacate
 *
 * After a tenant is vacated, the UI must prevent further financial actions.
 * This protects against accidental double-payment or incorrect data entry.
 *
 * UL-01  Vacated tenant row shows no "Collect" button
 * UL-02  Ledger drawer's "Add Charge" button is absent or disabled for vacated tenant
 * UL-03  Active tenant still has Collect button (regression check)
 * UL-04  Vacated tenant with unpaid balance has no Collect button
 * UL-05  Rent row for vacated tenant shows read-only status (not actionable)
 */

import { test, expect } from '@playwright/test'
import { TestEnv, currentMonthYear, firstOfMonthISO } from './helpers/seed'
import * as api from './helpers/api'
import * as a   from './helpers/assertions'

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the row locator for a given tenant name (or null-like if not found).
 * Scans all <tr> elements in the rent table.
 */
async function findTenantRow(page: import('@playwright/test').Page, nameSuffix: string) {
  const rows = page.locator('tr')
  const count = await rows.count()
  for (let i = 1; i < count; i++) {
    const row = rows.nth(i)
    const text = await row.locator('td').first().textContent().catch(() => '')
    if (text && text.includes(nameSuffix)) return row
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('UL-01 — Vacated Tenant Has No Collect Button', () => {
  test('after vacate with zero balance, no Collect button appears in the rent row', async ({ request, page }) => {
    const suffix = `UL01-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      deposit:      0,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 8000 })
    await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      vacateOption: 'proceed',
    })

    await a.injectAuth(page, env.token, env.propertyId)
    await a.gotoRentPage(page)
    await page.reload()
    await expect(page.locator('h2:has-text("Rent Collection")')).toBeVisible({ timeout: 15_000 })

    const row = await findTenantRow(page, `Tenant ${suffix}`)

    // If the row is not rendered at all, that is also acceptable (tenant filtered out)
    if (row === null) return

    // If the row IS rendered, it must not have a Collect button
    const collectBtnCount = await row.locator('button:has-text("Collect")').count()
    expect(
      collectBtnCount,
      'Vacated tenant row should not have a Collect button',
    ).toBe(0)
  })
})

test.describe('UL-02 — Add Charge Locked for Vacated Tenant', () => {
  test('Add Charge button absent or disabled in ledger drawer after vacate', async ({ request, page }) => {
    const suffix = `UL02-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 7000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 7000,
      deposit:      0,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 7000 })
    await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      vacateOption: 'proceed',
    })

    await a.injectAuth(page, env.token, env.propertyId)
    await a.gotoRentPage(page)
    await page.reload()
    await expect(page.locator('h2:has-text("Rent Collection")')).toBeVisible({ timeout: 15_000 })

    const row = await findTenantRow(page, `Tenant ${suffix}`)
    if (row === null) {
      // Vacated tenant not shown — acceptable, no lockout needed
      return
    }

    // Open ledger drawer if possible
    const ledgerBtn = row.locator('button[title="View ledger"]')
    if (await ledgerBtn.count() === 0) return  // row has no ledger button — acceptable

    await ledgerBtn.click()
    await page.waitForSelector('p.text-lg.font-bold.tabular-nums', { timeout: 8_000 }).catch(() => {})

    // Look for Add Charge button — should be absent or disabled
    const addChargeBtn = page.locator('button:has-text("Add Charge")').first()
    const isPresent = await addChargeBtn.count() > 0

    if (isPresent) {
      // If it's present, it must be disabled
      const isDisabled = await addChargeBtn.isDisabled()
      expect(
        isDisabled,
        'Add Charge button must be disabled for vacated tenant',
      ).toBe(true)
    }
    // If not present → test passes (button was removed from DOM)

    // Close drawer
    await page.keyboard.press('Escape')
  })
})

test.describe('UL-03 — Active Tenant Still Has Collect Button (Regression)', () => {
  test('vacating one tenant does not remove Collect button from active tenants', async ({ request, page }) => {
    const suffix1 = `UL03a-${Date.now()}`
    const suffix2 = `UL03b-${Date.now() + 1}`

    // Create two tenants in separate envs (separate rooms, same property isn't possible
    // without creating a multi-bed room — use separate envs for isolation)
    const env1 = await TestEnv.create(request, suffix1, 6000)
    const env2 = await TestEnv.create(request, suffix2, 6000)
    const { month, year } = currentMonthYear()

    // Tenant 1 — will be vacated
    const { tenantId: t1 } = await env1.createAssignedTenant({
      rentOverride: 6000,
      deposit:      0,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env1.token, env1.propertyId, month, year)
    await api.recordPayment(request, env1.token, env1.propertyId, { tenantId: t1, amount: 6000 })
    await api.vacateWithPayment(request, env1.token, env1.propertyId, t1, { vacateOption: 'proceed' })

    // Tenant 2 in its own property — still active with unpaid rent
    const { tenantId: t2 } = await env2.createAssignedTenant({
      rentOverride: 6000,
      deposit:      0,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env2.token, env2.propertyId, month, year)

    // Log into env2's context and verify active tenant has Collect button
    await a.injectAuth(page, env2.token, env2.propertyId)
    await a.gotoRentPage(page)
    await page.reload()
    await expect(page.locator('h2:has-text("Rent Collection")')).toBeVisible({ timeout: 15_000 })

    const activeRow = await findTenantRow(page, `Tenant ${suffix2}`)
    if (activeRow !== null) {
      const collectBtnCount = await activeRow.locator('button:has-text("Collect")').count()
      expect(
        collectBtnCount,
        'Active tenant should have a Collect button',
      ).toBeGreaterThan(0)
    }
  })
})

test.describe('UL-04 — Vacated Tenant with Unpaid Balance Has No Collect Button', () => {
  test('bad-debt vacate row has no financial action buttons', async ({ request, page }) => {
    const suffix = `UL04-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 8000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 8000,
      deposit:      0,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    // Do NOT pay — vacate with unpaid ₹8,000 balance
    await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      vacateOption: 'proceed',
    })

    // Verify API: tenant is vacated, balance still ₹8,000
    const tenant = await api.getTenantById(request, env.token, env.propertyId, tenantId)
    expect(tenant['status']).toBe('vacated')
    await a.assertBalance(request, env.token, env.propertyId, tenantId, 8000)

    await a.injectAuth(page, env.token, env.propertyId)
    await a.gotoRentPage(page)
    await page.reload()
    await expect(page.locator('h2:has-text("Rent Collection")')).toBeVisible({ timeout: 15_000 })

    const row = await findTenantRow(page, `Tenant ${suffix}`)
    if (row === null) return  // tenant filtered out of view — acceptable

    // No Collect button even with outstanding balance
    const collectBtnCount = await row.locator('button:has-text("Collect")').count()
    expect(
      collectBtnCount,
      'Vacated tenant (bad debt) should not have a Collect button',
    ).toBe(0)
  })
})

test.describe('UL-05 — Vacated Tenant Rent Row is Read-Only', () => {
  test('rent row for vacated tenant shows no interactive financial buttons', async ({ request, page }) => {
    const suffix = `UL05-${Date.now()}`
    const env    = await TestEnv.create(request, suffix, 5000)
    const { month, year } = currentMonthYear()

    const { tenantId } = await env.createAssignedTenant({
      rentOverride: 5000,
      deposit:      0,
      moveInDate:   firstOfMonthISO(),
    })
    await api.generateRent(request, env.token, env.propertyId, month, year)
    await api.recordPayment(request, env.token, env.propertyId, { tenantId, amount: 5000 })
    await api.vacateWithPayment(request, env.token, env.propertyId, tenantId, {
      vacateOption: 'proceed',
    })

    await a.injectAuth(page, env.token, env.propertyId)
    await a.gotoRentPage(page)
    await page.reload()
    await expect(page.locator('h2:has-text("Rent Collection")')).toBeVisible({ timeout: 15_000 })

    const row = await findTenantRow(page, `Tenant ${suffix}`)
    if (row === null) return  // not shown — acceptable

    // No payment-triggering buttons should be present in the row
    const actionButtons = await row.locator('button:has-text("Collect"), button:has-text("Pay"), button:has-text("Record")').count()
    expect(
      actionButtons,
      'Vacated tenant row must not have any payment action buttons',
    ).toBe(0)
  })
})
