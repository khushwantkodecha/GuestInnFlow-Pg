import { createContext, useContext, useState, useCallback } from 'react'
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'

const ToastContext = createContext(null)

let _id = 0

const STYLES = {
  success: {
    wrap:  'border-green-200 bg-white',
    icon:  <CheckCircle2 size={16} className="text-green-500 shrink-0" />,
    text:  'text-green-800',
  },
  error: {
    wrap:  'border-red-200 bg-white',
    icon:  <AlertTriangle size={16} className="text-red-500 shrink-0" />,
    text:  'text-red-800',
  },
  info: {
    wrap:  'border-blue-200 bg-white',
    icon:  <Info size={16} className="text-blue-500 shrink-0" />,
    text:  'text-blue-800',
  },
}

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback((message, type = 'success', duration = 3500) => {
    const id = ++_id
    setToasts((prev) => [...prev.slice(-4), { id, message, type }]) // max 5 visible
    setTimeout(() => dismiss(id), duration)
    return id
  }, [dismiss])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}

      {/* Toast container — bottom-right, above everything */}
      <div className="fixed bottom-5 right-5 z-[200] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => {
          const s = STYLES[t.type] ?? STYLES.info
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-center gap-3 rounded-xl border px-4 py-3 shadow-lg text-sm font-medium min-w-[260px] max-w-sm animate-slideInRight ${s.wrap}`}
            >
              {s.icon}
              <span className={`flex-1 leading-snug ${s.text}`}>{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                className="ml-1 rounded p-0.5 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={13} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx.toast
}
