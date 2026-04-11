import { createContext, useContext, useState, useEffect } from 'react'
import { getProperties } from '../api/properties'
import { useAuth } from './AuthContext'

const PropertyContext = createContext(null)

const STORAGE_KEY = 'selectedPropertyId'
// Special sentinel stored in localStorage meaning "All Properties"
const ALL_KEY = '__ALL__'

export const PropertyProvider = ({ children }) => {
  const { user } = useAuth()
  const [properties, setProperties]      = useState([])
  const [selectedProperty, _setSelected] = useState(null)  // null = All Properties
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

        if (savedId === ALL_KEY) {
          // Restore "All Properties" selection
          _setSelected(null)
        } else {
          const match = list.find((p) => p._id === savedId)
          _setSelected(match ?? list[0] ?? null)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [user])

  const setSelectedProperty = (property) => {
    _setSelected(property)
    if (property === null) {
      localStorage.setItem(STORAGE_KEY, ALL_KEY)
    } else {
      localStorage.setItem(STORAGE_KEY, property._id)
    }
  }

  // isAllProperties: true when the user has explicitly chosen "All Properties"
  // Distinguished from "nothing selected yet" (loading state)
  const isAllProperties = !loading && user && selectedProperty === null

  const refreshProperties = () => {
    if (!user) return
    getProperties()
      .then((res) => {
        const list = res.data?.data ?? []
        setProperties(list)
        _setSelected((prev) => {
          if (prev === null) return null  // keep "All Properties" selection
          const stillActive = list.find((p) => p._id === prev._id)
          if (!stillActive) {
            const next = list[0] ?? null
            localStorage.setItem(STORAGE_KEY, next ? next._id : ALL_KEY)
            return next
          }
          return prev
        })
      })
      .catch(() => {})
  }

  return (
    <PropertyContext.Provider value={{
      properties,
      selectedProperty,
      setSelectedProperty,
      isAllProperties,
      refreshProperties,
      loading,
    }}>
      {children}
    </PropertyContext.Provider>
  )
}

export const useProperty = () => {
  const ctx = useContext(PropertyContext)
  if (!ctx) throw new Error('useProperty must be used within a PropertyProvider')
  return ctx
}
