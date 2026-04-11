import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const CommandPaletteContext = createContext(null)

export const CommandPaletteProvider = ({ children }) => {
  const [open, setOpen] = useState(false)

  const toggle = useCallback(() => setOpen((v) => !v), [])
  const close  = useCallback(() => setOpen(false), [])

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        toggle()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [toggle])

  return (
    <CommandPaletteContext.Provider value={{ open, toggle, close }}>
      {children}
    </CommandPaletteContext.Provider>
  )
}

export const useCommandPalette = () => {
  const ctx = useContext(CommandPaletteContext)
  if (!ctx) throw new Error('useCommandPalette must be used within CommandPaletteProvider')
  return ctx
}
