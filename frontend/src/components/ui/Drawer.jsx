import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const Drawer = ({ title, subtitle, onClose, children, width = 'max-w-lg', closeOnBackdrop = true }) => {
  useEffect(() => {
    const handler = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 animate-fadeIn"
        style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(2px)' }}
        onClick={closeOnBackdrop ? onClose : undefined}
      />

      {/* Panel */}
      <div
        className={`relative flex h-full w-full flex-col ${width} bg-white`}
        style={{
          borderLeft: '1px solid #E2E8F0',
          boxShadow: '-8px 0 24px rgba(0,0,0,0.08)',
          animation: 'slideInDrawer 0.25s cubic-bezier(0.16, 1, 0.3, 1) both'
        }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between px-5 sm:px-6 py-4 sm:py-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-800 tracking-tight">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors active:scale-95"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>

      <style>{`
        @keyframes slideInDrawer {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>,
    document.body
  )
}

export default Drawer

