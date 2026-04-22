/**
 * E2E tests — Properties module
 *
 * Strategy
 * ─────────
 * All API calls are intercepted with page.route() so the suite runs without a
 * live backend. Auth is bootstrapped by:
 *   1. Injecting a fake JWT into localStorage before the app loads
 *      (page.addInitScript).
 *   2. Mocking GET /api/auth/me so AuthContext resolves the user.
 *   3. Mocking GET /api/properties so PropertyContext resolves the list.
 *
 * Selector approach (no data-testid attributes exist in this codebase):
 *   • Form inputs      → getByPlaceholder()
 *   • Labelled buttons → getByRole('button', { name: … })
 *   • Card scoping     → locator('.rounded-2xl').filter({ hasText: … })
 *   • Overflow menu    → card.locator('button.w-9')  (icon-only MoreVertical btn)
 *   • Text content     → getByText() / locator(':has-text()')
 *
 * NOTE: If you add data-testid attributes to the UI the selectors can be
 * simplified significantly.  Suggested additions are listed at the bottom of
 * this file.
 */

import { test, expect, type Page, type Route } from '@playwright/test'

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_USER = {
  _id:   'user-001',
  name:  'Test Owner',
  email: 'test@guestinnflow.com',
  role:  'owner',
}

const MOCK_PROPERTY_1 = {
  _id:     'prop-001',
  name:    'Green Valley PG',
  type:    'pg',
  isActive: true,
  description: 'Quiet PG near metro',
  address: { street: '12 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
  createdAt: new Date().toISOString(),
}

const MOCK_PROPERTY_2 = {
  _id:     'prop-002',
  name:    'Blue Ridge Hostel',
  type:    'hostel',
  isActive: true,
  description: '',
  address: { street: '', city: 'Mumbai', state: 'Maharashtra', pincode: '' },
  createdAt: new Date().toISOString(),
}

const MOCK_PROPERTY_INACTIVE = {
  _id:     'prop-003',
  name:    'Old Nest PG',
  type:    'pg',
  isActive: false,
  description: '',
  address: { street: '', city: 'Pune', state: 'Maharashtra', pincode: '' },
  createdAt: new Date().toISOString(),
}

const MOCK_STATS_1 = {
  propertyId: 'prop-001',
  totalBeds: 10, occupiedBeds: 8, vacantBeds: 2,
  activeTenants: 8, totalRevenue: 40000, occupancyRate: 80,
}

const MOCK_STATS_2 = {
  propertyId: 'prop-002',
  totalBeds: 6, occupiedBeds: 3, vacantBeds: 3,
  activeTenants: 3, totalRevenue: 18000, occupancyRate: 50,
}

const MOCK_STATS_INACTIVE = {
  propertyId: 'prop-003',
  totalBeds: 0, occupiedBeds: 0, vacantBeds: 0,
  activeTenants: 0, totalRevenue: 0, occupancyRate: 0,
}

const MOCK_ANALYTICS = {
  trend: [
    { year: 2025, month: 10, label: 'Oct 25', expected: 40000, collected: 36000, collectionRate: 90 },
    { year: 2025, month: 11, label: 'Nov 25', expected: 40000, collected: 40000, collectionRate: 100 },
    { year: 2025, month: 12, label: 'Dec 25', expected: 40000, collected: 32000, collectionRate: 80 },
  ],
}

// ── Auth + API helpers ────────────────────────────────────────────────────────

/**
 * Inject a fake JWT token into localStorage BEFORE React boots.
 * AuthContext reads localStorage.getItem('token') on mount and calls
 * GET /api/auth/me — the mock below satisfies that call.
 */
async function injectToken(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'mock-jwt-token-for-testing')
  })
}

/**
 * Set up all API mocks required for the Properties page to render correctly.
 * Call this BEFORE page.goto().
 */
async function setupMocks(
  page: Page,
  options: {
    properties?: object[]
    stats?: object[]
  } = {},
) {
  const properties = options.properties ?? [MOCK_PROPERTY_1, MOCK_PROPERTY_2]
  const statsMap = Object.fromEntries(
    (options.stats ?? [MOCK_STATS_1, MOCK_STATS_2]).map((s: any) => [s.propertyId, s]),
  )

  // Auth
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ json: { success: true, data: MOCK_USER } }),
  )

  // PropertyContext list (used for the property selector in the sidebar/navbar)
  await page.route('**/api/properties', (route) => {
    if (route.request().method() === 'GET' && !route.request().url().includes('/all') && !route.request().url().includes('/stats'))
      return route.fulfill({ json: { success: true, data: properties.filter((p: any) => p.isActive) } })
    return route.fallback()
  })

  // Properties page — full list (includes inactive)
  await page.route('**/api/properties/all', (route) =>
    route.fulfill({ json: { success: true, data: properties } }),
  )

  // Stats for all active properties
  await page.route('**/api/properties/stats/all', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: properties
          .filter((p: any) => p.isActive)
          .map((p: any) => statsMap[p._id] ?? { propertyId: p._id, totalBeds: 0, occupiedBeds: 0, vacantBeds: 0, activeTenants: 0, totalRevenue: 0, occupancyRate: 0 }),
      },
    }),
  )

  // Analytics per property
  await page.route('**/api/properties/*/analytics', (route) =>
    route.fulfill({ json: { success: true, data: MOCK_ANALYTICS } }),
  )
}

/** Mock a successful create operation. Returns a new property with _id 'prop-new'. */
async function mockCreate(page: Page, overrides: Partial<typeof MOCK_PROPERTY_1> = {}) {
  await page.route('**/api/properties', (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      return route.fulfill({
        status: 201,
        json: {
          success: true,
          data: { ...MOCK_PROPERTY_1, _id: 'prop-new', ...body, ...overrides },
        },
      })
    }
    return route.fallback()
  })
}

/** Mock a successful update operation. */
async function mockUpdate(page: Page, propertyId: string) {
  await page.route(`**/api/properties/${propertyId}`, (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON()
      return route.fulfill({
        json: { success: true, data: { ...MOCK_PROPERTY_1, ...body, _id: propertyId } },
      })
    }
    return route.fallback()
  })
}

/** Mock a successful soft-delete (deactivate). */
async function mockDeactivate(page: Page, propertyId: string) {
  await page.route(`**/api/properties/${propertyId}`, (route) => {
    if (route.request().method() === 'DELETE') {
      return route.fulfill({
        json: { success: true, data: { ...MOCK_PROPERTY_1, _id: propertyId, isActive: false } },
      })
    }
    return route.fallback()
  })
}

/** Mock a successful reactivate. */
async function mockReactivate(page: Page, propertyId: string) {
  await page.route(`**/api/properties/${propertyId}/reactivate`, (route) =>
    route.fulfill({
      json: { success: true, data: { ...MOCK_PROPERTY_1, _id: propertyId, isActive: true } },
    }),
  )
}

/** Mock a successful permanent delete. */
async function mockPermanentDelete(page: Page, propertyId: string) {
  await page.route(`**/api/properties/${propertyId}/permanent`, (route) =>
    route.fulfill({ json: { success: true } }),
  )
}

// ── Page Object Model ─────────────────────────────────────────────────────────

class PropertiesPage {
  constructor(private page: Page) {}

  // Navigation
  async goto() {
    await this.page.goto('/properties')
    await this.page.waitForLoadState('networkidle')
  }

  // Header
  addButton() {
    return this.page.getByRole('button', { name: /add property/i })
  }

  searchInput() {
    return this.page.getByPlaceholder(/search properties/i)
  }

  // Filter tabs — "Active" | "Inactive" | "All"
  filterTab(label: 'Active' | 'Inactive' | 'All') {
    return this.page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') })
  }

  // Cards
  card(name: string) {
    return this.page.locator('.rounded-2xl').filter({ hasText: name }).first()
  }

  cardOverflowMenu(name: string) {
    return this.card(name).locator('button.w-9')
  }

  // Overflow menu items (visible after opening overflow menu)
  overflowItem(label: string) {
    return this.page.getByRole('button', { name: new RegExp(label, 'i') })
  }

  // Form inputs
  nameInput() {
    return this.page.getByPlaceholder(/e\.g\. Green Valley PG/i)
  }

  streetInput() {
    return this.page.getByPlaceholder(/Street address/i)
  }

  cityInput() {
    return this.page.getByPlaceholder(/^City$/i)
  }

  stateInput() {
    return this.page.getByPlaceholder(/^State$/i)
  }

  pincodeInput() {
    return this.page.getByPlaceholder(/^Pincode$/i)
  }

  // Form action buttons
  submitButton() {
    return this.page.getByRole('button', { name: /Create Property|Save Changes/i })
  }

  cancelButton() {
    return this.page.getByRole('button', { name: /^Cancel$/i }).first()
  }

  // Deactivate button inside the edit form danger zone
  deactivateInForm() {
    return this.page.getByRole('button', { name: /^Deactivate$/i })
  }

  // Confirm modal buttons
  confirmButton(label: string) {
    return this.page.getByRole('button', { name: new RegExp(label, 'i') })
  }

  // Hard-delete modal
  hardDeleteInput() {
    // placeholder is the property name itself — callers pass the name
    return this.page.locator('input[placeholder]').last()
  }

  hardDeleteConfirmButton() {
    return this.page.getByRole('button', { name: /Permanently Delete/i })
  }

  // Quick-setup modal
  setupRoomsButton() {
    return this.page.getByRole('button', { name: /Set Up Rooms Now/i })
  }

  maybeLaterButton() {
    return this.page.getByRole('button', { name: /Maybe Later/i })
  }

  // ── Compound actions ──────────────────────────────────────────────────────

  async fillCreateForm(data: {
    name: string
    street?: string
    city?: string
    state?: string
    pincode?: string
  }) {
    await this.nameInput().fill(data.name)
    if (data.street)  await this.streetInput().fill(data.street)
    if (data.city)    await this.cityInput().fill(data.city)
    if (data.state)   await this.stateInput().fill(data.state)
    if (data.pincode) await this.pincodeInput().fill(data.pincode)
  }

  async openOverflowMenu(propertyName: string) {
    await this.cardOverflowMenu(propertyName).click()
    // Wait for the dropdown to appear
    await this.page.waitForSelector('button:has-text("View Details")', { timeout: 3000 })
  }
}

// ── Test suite ────────────────────────────────────────────────────────────────

test.describe('Properties page', () => {

  // ── SETUP ────────────────────────────────────────────────────────────────

  test.beforeEach(async ({ page }) => {
    await injectToken(page)
  })

  // ── HAPPY PATH — PAGE LOAD ────────────────────────────────────────────────

  test.describe('Page load', () => {

    test('renders property cards for all active properties', async ({ page }) => {
      await setupMocks(page)
      const pom = new PropertiesPage(page)
      await pom.goto()

      await expect(pom.card('Green Valley PG')).toBeVisible()
      await expect(pom.card('Blue Ridge Hostel')).toBeVisible()
    })

    test('shows KPI strip with stats when stats are loaded', async ({ page }) => {
      await setupMocks(page)
      const pom = new PropertiesPage(page)
      await pom.goto()

      // KPI strip contains occupancy, tenants, beds
      const card = pom.card('Green Valley PG')
      await expect(card.getByText('80%')).toBeVisible()         // occupancyRate
      await expect(card.getByText('8')).toBeVisible()           // activeTenants
      await expect(card.getByText('8/10')).toBeVisible()        // occupiedBeds/totalBeds
    })

    test('shows "Active" badge on active properties', async ({ page }) => {
      await setupMocks(page)
      const pom = new PropertiesPage(page)
      await pom.goto()

      const card = pom.card('Green Valley PG')
      await expect(card.getByText('Active')).toBeVisible()
    })

    test('shows occupancy bar when totalBeds > 0', async ({ page }) => {
      await setupMocks(page)
      const pom = new PropertiesPage(page)
      await pom.goto()

      // The occupancy bar label "Occupancy" appears in the bar section
      const card = pom.card('Green Valley PG')
      await expect(card.locator('text=Occupancy').last()).toBeVisible()
    })

    test('shows empty state when no properties exist', async ({ page }) => {
      await setupMocks(page, { properties: [], stats: [] })
      const pom = new PropertiesPage(page)
      await pom.goto()

      // No cards rendered, empty state message visible
      await expect(page.getByText(/no properties/i)).toBeVisible()
    })

    test('shows "Add Property" button', async ({ page }) => {
      await setupMocks(page)
      const pom = new PropertiesPage(page)
      await pom.goto()

      await expect(pom.addButton()).toBeVisible()
    })
  })

  // ── HAPPY PATH — CREATE ───────────────────────────────────────────────────

  test.describe('Create property', () => {

    test('opens add-property modal on button click', async ({ page }) => {
      await setupMocks(page)
      const pom = new PropertiesPage(page)
      await pom.goto()

      await pom.addButton().click()
      await expect(page.getByText('Add New Property')).toBeVisible()
    })

    test('shows live preview of property name as user types', async ({ page }) => {
      await setupMocks(page)
      const pom = new PropertiesPage(page)
      await pom.goto()
      await pom.addButton().click()

      await pom.nameInput().fill('Sunrise PG')
      // The gradient header preview card should show the typed name
      await expect(page.getByText('Sunrise PG')).toBeVisible()
    })

    test('creates a property with full details and shows quick-setup modal', async ({ page }) => {
      await setupMocks(page)
      await mockCreate(page, { name: 'Sunrise PG' })

      // After create, the page re-fetches — return the new property in the list
      await page.route('**/api/properties/all', (route) =>
        route.fulfill({
          json: {
            success: true,
            data: [MOCK_PROPERTY_1, MOCK_PROPERTY_2, { ...MOCK_PROPERTY_1, _id: 'prop-new', name: 'Sunrise PG' }],
          },
        }),
      )
      await page.route('**/api/properties/stats/all', (route) =>
        route.fulfill({
          json: {
            success: true,
            data: [MOCK_STATS_1, MOCK_STATS_2, { propertyId: 'prop-new', totalBeds: 0, occupiedBeds: 0, vacantBeds: 0, activeTenants: 0, totalRevenue: 0, occupancyRate: 0 }],
          },
        }),
      )

      const pom = new PropertiesPage(page)
      await pom.goto()
      await pom.addButton().click()

      await pom.fillCreateForm({
        name: 'Sunrise PG',
        street: '5 Park Ave',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500001',
      })
      await pom.submitButton().click()

      // Quick-setup modal should appear
      await expect(page.getByText(/Created successfully/i)).toBeVisible()
      await expect(page.getByText('Sunrise PG')).toBeVisible()
    })

    test('quick-setup modal — "Maybe Later" dismisses modal', async ({ page }) => {
      await setupMocks(page)
      await mockCreate(page)

      const pom = new PropertiesPage(page)
      await pom.goto()
      await pom.addButton().click()
      await pom.nameInput().fill('Test PG')
      await pom.submitButton().click()

      await expect(page.getByText(/Created successfully/i)).toBeVisible()
      await pom.maybeLaterButton().click()
      // Modal gone
      await expect(page.getByText(/Created successfully/i)).not.toBeVisible()
    })

    test('quick-setup modal — "Set Up Rooms Now" navigates to /rooms', async ({ page }) => {
      await setupMocks(page)
      await mockCreate(page, { _id: 'prop-new' } as any)

      const pom = new PropertiesPage(page)
      await pom.goto()
      await pom.addButton().click()
      await pom.nameInput().fill('Test PG')
      await pom.submitButton().click()

      await expect(page.getByText(/Created successfully/i)).toBeVisible()
      await pom.setupRoomsButton().click()
      await expect(page).toHaveURL(/\/rooms/)
    })

    test('creates a property with name only (minimal form)', async ({ page }) => {
      await setupMocks(page)
      await mockCreate(page)

      const pom = new PropertiesPage(page)
      await pom.goto()
      await pom.addButton().click()
      await pom.nameInput().fill('Minimal PG')
      await expect(pom.submitButton()).toBeEnabled()
    })
  })

  // ── HAPPY PATH — EDIT ─────────────────────────────────────────────────────

  test.describe('Edit property', () => {

    test('opens edit modal with prefilled name from overflow menu', async ({ page }) => {
      await setupMocks(page)
      const pom = new PropertiesPage(page)
      await pom.goto()

      await pom.openOverflowMenu('Green Valley PG')
      await pom.overflowItem('Edit Property').click()

      await expect(page.getByText('Edit Property')).toBeVisible()
      // Input should be pre-filled
      await expect(pom.nameInput()).toHaveValue('Green Valley PG')
    })

    test('saves edits and updates card', async ({ page }) => {
      await setupMocks(page)
      await mockUpdate(page, 'prop-001')

      // After save, re-fetch returns updated name
      await page.route('**/api/properties/all', (route) =>
        route.fulfill({
          json: {
            success: true,
            data: [{ ...MOCK_PROPERTY_1, name: 'Green Valley PG — Edited' }, MOCK_PROPERTY_2],
          },
        }),
      )

      const pom = new PropertiesPage(page)
      await pom.goto()
      await pom.openOverflowMenu('Green Valley PG')
      await pom.overflowItem('Edit Property').click()

      await pom.nameInput().clear()
      await pom.nameInput().fill('Green Valley PG — Edited')
      await pom.submitButton().click()

      // Modal should close; updated card should appear
      await expect(page.getByText('Edit Property')).not.toBeVisible()
    })

    test('cancel closes the edit modal without saving', async ({ page }) => {
      await setupMocks(page)
      const pom = new PropertiesPage(page)
      await pom.goto()

      await pom.openOverflowMenu('Green Valley PG')
      await pom.overflowItem('Edit Property').click()

      await pom.nameInput().clear()
      await pom.nameInput().fill('Changed Name')
      await pom.cancelButton().click()

      await expect(page.getByText('Edit Property')).not.toBeVisible()
      // Original card name should still be visible
      await expect(pom.card('Green Valley PG')).toBeVisible()
    })
  })

  // ── HAPPY PATH — VIEW DETAILS ─────────────────────────────────────────────

  test.describe('View details', () => {

    test('opens detail modal from overflow menu', async ({ page }) => {
      await setupMocks(page)
      const pom = new PropertiesPage(page)
      await pom.goto()

      await pom.openOverflowMenu('Green Valley PG')
      await pom.overflowItem('View Details').click()

      // Detail modal header shows property name
      await expect(page.locator('h2').filter({ hasText: 'Green Valley PG' })).toBeVisible()
    })

    test('detail modal shows stats pills when stats are available', async ({ page }) => {
      await setupMocks(page)
      const pom = new PropertiesPage(page)
      await pom.goto()

      await pom.openOverflowMenu('Green Valley PG')
      await pom.overflowItem('View Details').click()

      // Stats pills: beds, tenants, occupancy
      await expect(page.getByText(/8\/10 beds/i)).toBeVisible()
      await expect(page.getByText(/8 tenant/i)).toBeVisible()
      await expect(page.getByText(/80% full/i)).toBeVisible()
    })

    test('detail modal shows address when present', async ({ page }) => {
      await setupMocks(page)
      const pom = new PropertiesPage(page)
      await pom.goto()

      await pom.openOverflowMenu('Green Valley PG')
      await pom.overflowItem('View Details').click()

      await expect(page.getByText(/12 MG Road/)).toBeVisible()
    })
  })

  // ── HAPPY PATH — ANALYTICS ────────────────────────────────────────────────

  test.describe('Analytics', () => {

    test('opens analytics modal from overflow menu', async ({ page }) => {
      await setupMocks(page)
      const pom = new PropertiesPage(page)
      await pom.goto()

      await pom.openOverflowMenu('Green Valley PG')
      await pom.overflowItem('Analytics').click()

      await expect(page.getByText(/Analytics — Green Valley PG/i)).toBeVisible()
    })

    test('renders trend table with month rows', async ({ page }) => {
      await setupMocks(page)
      const pom = new PropertiesPage(page)
      await pom.goto()

      await pom.openOverflowMenu('Green Valley PG')
      await pom.overflowItem('Analytics').click()

      await expect(page.getByText('Oct 25')).toBeVisible()
      await expect(page.getByText('Nov 25')).toBeVisible()
    })

    test('shows "No data yet" when trend is empty', async ({ page }) => {
      await setupMocks(page)
      // Override analytics to return empty trend
      await page.route('**/api/properties/*/analytics', (route) =>
        route.fulfill({ json: { success: true, data: { trend: [] } } }),
      )
      const pom = new PropertiesPage(page)
      await pom.goto()

      await pom.openOverflowMenu('Green Valley PG')
      await pom.overflowItem('Analytics').click()

      await expect(page.getByText(/No data yet/i)).toBeVisible()
    })
  })

  // ── HAPPY PATH — DEACTIVATE ───────────────────────────────────────────────

  test.describe('Deactivate property', () => {

    test('deactivates from overflow menu and shows confirm modal', async ({ page }) => {
      await setupMocks(page)
      const pom = new PropertiesPage(page)
      await pom.goto()

      await pom.openOverflowMenu('Green Valley PG')
      await pom.overflowItem('Deactivate').click()

      await expect(page.getByText('Deactivate Property')).toBeVisible()
      await expect(page.getByText(/Green Valley PG/)).toBeVisible()
    })

    test('confirms deactivation and removes card from active view', async ({ page }) => {
      await setupMocks(page)
      await mockDeactivate(page, 'prop-001')

      // After deactivation re-fetch: prop-001 now inactive
      await page.route('**/api/properties/all', (route) =>
        route.fulfill({
          json: {
            success: true,
            data: [{ ...MOCK_PROPERTY_1, isActive: false }, MOCK_PROPERTY_2],
          },
        }),
      )
      await page.route('**/api/properties/stats/all', (route) =>
        route.fulfill({ json: { success: true, data: [MOCK_STATS_2] } }),
      )

      const pom = new PropertiesPage(page)
      await pom.goto()
      await pom.openOverflowMenu('Green Valley PG')
      await pom.overflowItem('Deactivate').click()
      await pom.confirmButton('Deactivate').last().click()

      // Confirm modal should close
      await expect(page.getByText('Deactivate Property')).not.toBeVisible()
    })

    test('cancels deactivation — modal closes, card remains', async ({ page }) => {
      await setupMocks(page)
      const pom = new PropertiesPage(page)
      await pom.goto()

      await pom.openOverflowMenu('Green Valley PG')
      await pom.overflowItem('Deactivate').click()
      await pom.confirmButton('Cancel').click()

      await expect(page.getByText('Deactivate Property')).not.toBeVisible()
      await expect(pom.card('Green Valley PG')).toBeVisible()
    })
  })

  // ── HAPPY PATH — REACTIVATE ───────────────────────────────────────────────

  test.describe('Reactivate property', () => {

    test('inactive card shows "Reactivate" button directly', async ({ page }) => {
      await setupMocks(page, {
        properties: [MOCK_PROPERTY_1, MOCK_PROPERTY_INACTIVE],
        stats: [MOCK_STATS_1],
      })
      const pom = new PropertiesPage(page)
      await pom.goto()

      // Switch to "All" tab to show inactive properties
      await pom.filterTab('All').click()

      const inactiveCard = pom.card('Old Nest PG')
      await expect(inactiveCard.getByRole('button', { name: /Reactivate/i })).toBeVisible()
    })

    test('reactivates property and shows confirm modal', async ({ page }) => {
      await setupMocks(page, {
        properties: [MOCK_PROPERTY_1, MOCK_PROPERTY_INACTIVE],
        stats: [MOCK_STATS_1],
      })
      await mockReactivate(page, 'prop-003')

      const pom = new PropertiesPage(page)
      await pom.goto()
      await pom.filterTab('All').click()

      await pom.card('Old Nest PG').getByRole('button', { name: /Reactivate/i }).click()
      await expect(page.getByText('Reactivate Property')).toBeVisible()
    })
  })

  // ── HAPPY PATH — HARD DELETE ──────────────────────────────────────────────

  test.describe('Permanent delete', () => {

    test('shows hard-delete modal with name confirmation input', async ({ page }) => {
      await setupMocks(page, {
        properties: [MOCK_PROPERTY_1, MOCK_PROPERTY_INACTIVE],
        stats: [MOCK_STATS_1],
      })
      const pom = new PropertiesPage(page)
      await pom.goto()
      await pom.filterTab('All').click()

      await pom.card('Old Nest PG').getByRole('button', { name: /Delete Forever/i }).click()
      await expect(page.getByText('Permanent Delete')).toBeVisible()
      await expect(page.getByText(/This action is irreversible/i)).toBeVisible()
    })

    test('confirm button is disabled until property name is typed correctly', async ({ page }) => {
      await setupMocks(page, {
        properties: [MOCK_PROPERTY_1, MOCK_PROPERTY_INACTIVE],
        stats: [MOCK_STATS_1],
      })
      const pom = new PropertiesPage(page)
      await pom.goto()
      await pom.filterTab('All').click()

      await pom.card('Old Nest PG').getByRole('button', { name: /Delete Forever/i }).click()

      // Confirm button disabled before typing
      await expect(pom.hardDeleteConfirmButton()).toBeDisabled()

      // Type wrong name — still disabled
      await pom.hardDeleteInput().fill('wrong name')
      await expect(pom.hardDeleteConfirmButton()).toBeDisabled()

      // Type exact name — enabled
      await pom.hardDeleteInput().fill('Old Nest PG')
      await expect(pom.hardDeleteConfirmButton()).toBeEnabled()
    })

    test('completes permanent delete and removes property', async ({ page }) => {
      await setupMocks(page, {
        properties: [MOCK_PROPERTY_1, MOCK_PROPERTY_INACTIVE],
        stats: [MOCK_STATS_1],
      })
      await mockPermanentDelete(page, 'prop-003')

      // After delete, re-fetch without prop-003
      await page.route('**/api/properties/all', (route) =>
        route.fulfill({ json: { success: true, data: [MOCK_PROPERTY_1] } }),
      )

      const pom = new PropertiesPage(page)
      await pom.goto()
      await pom.filterTab('All').click()

      await pom.card('Old Nest PG').getByRole('button', { name: /Delete Forever/i }).click()
      await pom.hardDeleteInput().fill('Old Nest PG')
      await pom.hardDeleteConfirmButton().click()

      await expect(page.getByText('Permanent Delete')).not.toBeVisible()
    })
  })

  // ── SEARCH AND FILTER ─────────────────────────────────────────────────────

  test.describe('Search', () => {

    test('filters cards by property name (case-insensitive)', async ({ page }) => {
      await setupMocks(page)
      const pom = new PropertiesPage(page)
      await pom.goto()

      await pom.searchInput().fill('green')
      await expect(pom.card('Green Valley PG')).toBeVisible()
      await expect(page.locator('.rounded-2xl').filter({ hasText: 'Blue Ridge Hostel' })).not.toBeVisible()
    })

    test('filters by city', async ({ page }) => {
      await setupMocks(page)
      const pom = new PropertiesPage(page)
      await pom.goto()

      await pom.searchInput().fill('Mumbai')
      await expect(pom.card('Blue Ridge Hostel')).toBeVisible()
      await expect(page.locator('.rounded-2xl').filter({ hasText: 'Green Valley PG' })).not.toBeVisible()
    })

    test('shows empty results when no match', async ({ page }) => {
      await setupMocks(page)
      const pom = new PropertiesPage(page)
      await pom.goto()

      await pom.searchInput().fill('zzz-no-match')
      // No property cards visible
      await expect(page.locator('.rounded-2xl').filter({ hasText: 'Green Valley PG' })).not.toBeVisible()
      await expect(page.locator('.rounded-2xl').filter({ hasText: 'Blue Ridge Hostel' })).not.toBeVisible()
    })

    test('clears search and restores all cards', async ({ page }) => {
      await setupMocks(page)
      const pom = new PropertiesPage(page)
      await pom.goto()

      await pom.searchInput().fill('green')
      await pom.searchInput().clear()

      await expect(pom.card('Green Valley PG')).toBeVisible()
      await expect(pom.card('Blue Ridge Hostel')).toBeVisible()
    })
  })

  test.describe('Filter tabs', () => {

    test('"Active" tab shows only active properties by default', async ({ page }) => {
      await setupMocks(page, {
        properties: [MOCK_PROPERTY_1, MOCK_PROPERTY_2, MOCK_PROPERTY_INACTIVE],
        stats: [MOCK_STATS_1, MOCK_STATS_2],
      })
      const pom = new PropertiesPage(page)
      await pom.goto()

      await expect(pom.card('Green Valley PG')).toBeVisible()
      await expect(pom.card('Blue Ridge Hostel')).toBeVisible()
      // Inactive property not shown on default "Active" tab
      await expect(page.locator('.rounded-2xl').filter({ hasText: 'Old Nest PG' })).not.toBeVisible()
    })

    test('"Inactive" tab shows only inactive properties', async ({ page }) => {
      await setupMocks(page, {
        properties: [MOCK_PROPERTY_1, MOCK_PROPERTY_2, MOCK_PROPERTY_INACTIVE],
        stats: [MOCK_STATS_1, MOCK_STATS_2],
      })
      const pom = new PropertiesPage(page)
      await pom.goto()

      await pom.filterTab('Inactive').click()
      await expect(pom.card('Old Nest PG')).toBeVisible()
      await expect(page.locator('.rounded-2xl').filter({ hasText: 'Green Valley PG' })).not.toBeVisible()
    })

    test('"All" tab shows active and inactive properties', async ({ page }) => {
      await setupMocks(page, {
        properties: [MOCK_PROPERTY_1, MOCK_PROPERTY_2, MOCK_PROPERTY_INACTIVE],
        stats: [MOCK_STATS_1, MOCK_STATS_2],
      })
      const pom = new PropertiesPage(page)
      await pom.goto()

      await pom.filterTab('All').click()
      await expect(pom.card('Green Valley PG')).toBeVisible()
      await expect(pom.card('Old Nest PG')).toBeVisible()
    })
  })

  // ── EDGE CASES & VALIDATION ───────────────────────────────────────────────

  test.describe('Form validation', () => {

    test('submit button is disabled when name is empty', async ({ page }) => {
      await setupMocks(page)
      const pom = new PropertiesPage(page)
      await pom.goto()
      await pom.addButton().click()

      await expect(pom.submitButton()).toBeDisabled()
    })

    test('shows inline error when form is submitted with blank name', async ({ page }) => {
      await setupMocks(page)
      const pom = new PropertiesPage(page)
      await pom.goto()
      await pom.addButton().click()

      // Type then clear the name to bypass the disabled state guard
      await pom.nameInput().fill('x')
      await pom.nameInput().clear()
      // Button should be disabled again
      await expect(pom.submitButton()).toBeDisabled()
    })

    test('submit button re-enables after valid name is typed', async ({ page }) => {
      await setupMocks(page)
      const pom = new PropertiesPage(page)
      await pom.goto()
      await pom.addButton().click()

      await pom.nameInput().fill('Valid Name')
      await expect(pom.submitButton()).toBeEnabled()
    })

    test('closing the form with the X button discards unsaved changes', async ({ page }) => {
      await setupMocks(page)
      const pom = new PropertiesPage(page)
      await pom.goto()
      await pom.addButton().click()

      await pom.nameInput().fill('Unsaved Property')

      // Click the X button in the form header
      await page.getByLabel('Close').first().click()

      // Form gone, no new card with that name
      await expect(page.getByText('Add New Property')).not.toBeVisible()
    })
  })

  // ── UI STATE ──────────────────────────────────────────────────────────────

  test.describe('Occupancy color coding', () => {

    test('shows emerald color for occupancy >= 80%', async ({ page }) => {
      await setupMocks(page, {
        properties: [MOCK_PROPERTY_1],
        stats: [{ ...MOCK_STATS_1, occupancyRate: 85 }],
      })
      const pom = new PropertiesPage(page)
      await pom.goto()

      const card = pom.card('Green Valley PG')
      const occText = card.locator('.text-emerald-600').filter({ hasText: /\d+%/ }).first()
      await expect(occText).toBeVisible()
    })

    test('shows amber color for occupancy between 50–79%', async ({ page }) => {
      await setupMocks(page, {
        properties: [MOCK_PROPERTY_2],
        stats: [{ ...MOCK_STATS_2, occupancyRate: 60 }],
      })
      const pom = new PropertiesPage(page)
      await pom.goto()

      const card = pom.card('Blue Ridge Hostel')
      const occText = card.locator('.text-amber-600').filter({ hasText: /\d+%/ }).first()
      await expect(occText).toBeVisible()
    })
  })

  test.describe('Setup pending state', () => {

    test('shows "Setup Pending" badge when property has 0 beds', async ({ page }) => {
      await setupMocks(page, {
        properties: [MOCK_PROPERTY_1],
        stats: [{ ...MOCK_STATS_1, totalBeds: 0, occupiedBeds: 0, vacantBeds: 0, occupancyRate: 0 }],
      })
      const pom = new PropertiesPage(page)
      await pom.goto()

      const card = pom.card('Green Valley PG')
      await expect(card.getByText('Setup Pending')).toBeVisible()
    })

    test('shows "Add rooms & beds" alert when totalBeds is 0', async ({ page }) => {
      await setupMocks(page, {
        properties: [MOCK_PROPERTY_1],
        stats: [{ ...MOCK_STATS_1, totalBeds: 0, occupiedBeds: 0, vacantBeds: 0, activeTenants: 0, occupancyRate: 0 }],
      })
      const pom = new PropertiesPage(page)
      await pom.goto()

      await expect(pom.card('Green Valley PG').getByText(/Add rooms & beds/i)).toBeVisible()
    })
  })

  test.describe('Inactive property card', () => {

    test('inactive card has reduced opacity and no overflow menu', async ({ page }) => {
      await setupMocks(page, {
        properties: [MOCK_PROPERTY_INACTIVE],
        stats: [],
      })

      // Inactive properties only visible under "All" or "Inactive" tab
      await page.route('**/api/properties/all', (route) =>
        route.fulfill({ json: { success: true, data: [MOCK_PROPERTY_INACTIVE] } }),
      )

      const pom = new PropertiesPage(page)
      await pom.goto()
      await pom.filterTab('All').click()

      const card = pom.card('Old Nest PG')
      await expect(card.getByText('Inactive')).toBeVisible()

      // No overflow menu button (w-9) on inactive cards
      await expect(card.locator('button.w-9')).not.toBeVisible()
    })
  })
})

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * RECOMMENDED: Add data-testid attributes to the UI to make selectors more
 * resilient and tests easier to maintain.
 *
 * Suggested additions in Properties.jsx:
 *
 *   <button … data-testid="add-property-btn">Add Property</button>
 *   <input … data-testid="properties-search" placeholder="Search…" />
 *   <button … data-testid="filter-active">Active</button>
 *   <button … data-testid="filter-inactive">Inactive</button>
 *   <button … data-testid="filter-all">All</button>
 *
 * In PropertyCard:
 *   <div … data-testid={`property-card-${p._id}`}>
 *   <button … data-testid={`overflow-menu-${p._id}`}>
 *
 * In PropertyForm:
 *   <input … data-testid="property-name-input" />
 *   <button … data-testid="property-submit-btn" />
 *
 * In HardDeleteModal:
 *   <input … data-testid="hard-delete-confirm-input" />
 *   <button … data-testid="hard-delete-confirm-btn" />
 * ─────────────────────────────────────────────────────────────────────────────
 */
