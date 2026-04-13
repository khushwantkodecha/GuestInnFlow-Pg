// ─────────────────────────────────────────────────────────────────────────────
// API Configuration
//
// • In development, replace DEV_API_BASE_URL with your machine's local IP.
//   "localhost" / "127.0.0.1" does NOT work on Android emulators or real devices.
//   Run `ipconfig` (Windows) or `ifconfig` (Mac/Linux) to find your LAN IP.
//   Example: 'http://192.168.1.42:5001/api'
//
// • For production, set EXPO_PUBLIC_API_BASE_URL in your .env file.
// ─────────────────────────────────────────────────────────────────────────────

const DEV_API_BASE_URL = 'http://192.168.1.1:5001/api' // ← replace with your LAN IP

export const API_BASE_URL =
  (process.env.EXPO_PUBLIC_API_BASE_URL as string) || DEV_API_BASE_URL

// Token key used in AsyncStorage
export const TOKEN_KEY = 'guestinnflow_token'

// App-wide colour palette (mirrors web app Tailwind tokens)
export const COLORS = {
  primary:        '#60c3ad',
  primaryDark:    '#45a793',
  primaryDarker:  '#358a79',
  primaryDeep:    '#1a5c4e',

  white:          '#ffffff',
  background:     '#f9fafb',
  surface:        '#ffffff',

  text:           '#111827',
  textSecondary:  '#374151',
  textMuted:      '#6b7280',
  placeholder:    '#9ca3af',

  border:         '#e5e7eb',
  borderFocus:    '#60c3ad',

  errorBg:        '#fef2f2',
  errorBorder:    '#fee2e2',
  errorText:      '#b91c1c',
  errorDot:       '#ef4444',

  strengthWeak:   '#ef4444',
  strengthFair:   '#f59e0b',
  strengthGood:   '#22c55e',
  strengthStrong: '#10b981',
} as const
