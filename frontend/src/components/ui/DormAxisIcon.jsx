export default function DormAxisIcon({ size = 16, color = 'currentColor' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Chevron 1 — leftmost house shape with window grid */}
      <path
        d="M2 25 L12 4 L22 25"
        stroke={color}
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 2×2 window grid inside chevron 1 */}
      <rect x="8.5"  y="14"   width="2.6" height="2.6" rx="0.6" fill={color} />
      <rect x="12.2" y="14"   width="2.6" height="2.6" rx="0.6" fill={color} />
      <rect x="8.5"  y="17.4" width="2.6" height="2.6" rx="0.6" fill={color} />
      <rect x="12.2" y="17.4" width="2.6" height="2.6" rx="0.6" fill={color} />

      {/* Chevron 2 — middle, slightly taller */}
      <path
        d="M14 25 L23 3 L30 18"
        stroke={color}
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.7"
      />

      {/* Chevron 3 — rightmost, partial diagonal only */}
      <path
        d="M21 25 L28 9"
        stroke={color}
        strokeWidth="3.2"
        strokeLinecap="round"
        opacity="0.45"
      />
    </svg>
  )
}
