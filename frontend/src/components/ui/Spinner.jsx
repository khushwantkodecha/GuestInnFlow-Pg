const Spinner = ({ className = '' }) => (
  <div className={`flex items-center justify-center py-16 ${className}`}>
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-100 border-t-primary-500" />
  </div>
)

export default Spinner
