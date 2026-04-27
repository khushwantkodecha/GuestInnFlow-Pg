import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { getProperties } from '../api/properties'
import { useAuth } from './AuthContext'

const PropertyContext = createContext(null)

const STORAGE_KEY = 'selectedPropertyId'

export const PropertyProvider = ({ children }) => {
  const { user } = useAuth()
  const [properties, setProperties]      = useState([])
  const [selectedProperty, _setSelected] = useState(null)
  const [loading, setLoading]            = useState(true)

  useEffect(() => {
    if (!user) {
      setProperties([])
      _setSelected(null)
      setLoading(false)
      return
    }

    setLoading(true)
    getProperties()
      .then((res) => {
        const list = res.data?.data ?? []
        setProperties(list)

        const savedId = localStorage.getItem(STORAGE_KEY)
        const match   = list.find((p) => p._id === savedId)
        _setSelected(match ?? list[0] ?? null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [user])

  const setSelectedProperty = useCallback((property) => {
    _setSelected(property)
    localStorage.setItem(STORAGE_KEY, property?._id ?? '')
  }, [])

  const refreshProperties = useCallback(() => {
    if (!user) return
    getProperties()
      .then((res) => {
        const list = res.data?.data ?? []
        setProperties(list)
        _setSelected((prev) => {
          if (!prev) return list[0] ?? null
          const stillActive = list.find((p) => p._id === prev._id)
          if (!stillActive) {
            const next = list[0] ?? null
            localStorage.setItem(STORAGE_KEY, next?._id ?? '')
            return next
          }
          return prev
        })
      })
      .catch(() => {})
  }, [user])

  const value = useMemo(
    () => ({ properties, selectedProperty, setSelectedProperty, refreshProperties, loading }),
    [properties, selectedProperty, setSelectedProperty, refreshProperties, loading]
  )

  return (
    <PropertyContext.Provider value={value}>
      {children}
    </PropertyContext.Provider>
  )
}

export const useProperty = () => {
  const ctx = useContext(PropertyContext)
  if (!ctx) throw new Error('useProperty must be used within a PropertyProvider')
  return ctx
}
