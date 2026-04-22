import { X } from 'lucide-react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

const Modal = ({ title, onClose, children, size = 'md', disableBackdropClose = false, bodyClassName = 'overflow-y-auto px-5 py-5', zIndex = 'z-50' }) => {
  useEffect(() => {
    const handler = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const sizeClass = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  }[size] ?? 'max-w-lg'

  return createPortal(
    <div className={`fixed inset-0 ${zIndex} flex items-end sm:items-center justify-center p-0 sm:p-4`}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 animate-fadeIn"
        style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(2px)' }}
        onClick={disableBackdropClose ? undefined : onClose}
      />

      {/* Panel */}
      <div
        className={`
          relative w-full ${sizeClass}
          animate-scaleIn
          rounded-t-2xl sm:rounded-2xl
          max-h-[92vh] flex flex-col
          bg-white
        `}
        style={{
          border: '1px solid #E2E8F0',
          boxShadow: '0 8px 32px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.06)',
        }}
      >
        {/* Header */}
        {title && (
          <div className="flex shrink-0 items-center justify-between px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="h-1.5 w-1.5 rounded-full bg-primary-500" />
              <h2 className="text-[15px] font-semibold text-slate-800">{title}</h2>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors active:scale-95"
              aria-label="Close"
            >
              <X size={17} />
            </button>
          </div>
        )}

        {/* Body */}
        <div className={bodyClassName}>{children}</div>
      </div>
    </div>,
    document.body
  )
}

export default Modal
