export default function Spinner({ size = 20 }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24" fill="none"
      style={{ animation: 'spin 0.7s linear infinite' }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <circle cx="12" cy="12" r="10" stroke="#e2e8f0" strokeWidth="3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="#45a793" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
