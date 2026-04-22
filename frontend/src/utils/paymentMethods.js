const ALL_METHODS = ['cash', 'upi', 'bank_transfer', 'cheque']

export const loadEnabledMethods = (propertyId) => {
  if (!propertyId) return ALL_METHODS
  try {
    const stored = JSON.parse(localStorage.getItem(`pm_${propertyId}`))
    return Array.isArray(stored) && stored.length > 0 ? stored : ALL_METHODS
  } catch {
    return ALL_METHODS
  }
}
