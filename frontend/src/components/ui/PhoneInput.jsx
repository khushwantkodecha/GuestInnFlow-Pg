import { useState, useEffect } from 'react'

const COUNTRIES = [
  { code: '+91',  flag: '🇮🇳' },
  { code: '+1',   flag: '🇺🇸' },
  { code: '+44',  flag: '🇬🇧' },
  { code: '+971', flag: '🇦🇪' },
  { code: '+61',  flag: '🇦🇺' },
  { code: '+65',  flag: '🇸🇬' },
  { code: '+977', flag: '🇳🇵' },
  { code: '+880', flag: '🇧🇩' },
  { code: '+92',  flag: '🇵🇰' },
  { code: '+94',  flag: '🇱🇰' },
]

// Sort longest-first so "+91" isn't confused with "+1" during parsing
const SORTED = [...COUNTRIES].sort((a, b) => b.code.length - a.code.length)

const parse = (value) => {
  if (!value) return { code: '+91', number: '' }
  for (const { code } of SORTED) {
    if (value.startsWith(code)) return { code, number: value.slice(code.length) }
  }
  // Plain number without country prefix — default to +91
  return { code: '+91', number: value }
}

const PhoneInput = ({
  value      = '',
  onChange,
  placeholder = 'Mobile number',
  className   = '',
  disabled    = false,
  error       = false,
  autoFocus   = false,
  testid,
}) => {
  const parsed = parse(value)
  const [countryCode, setCountryCode] = useState(parsed.code)
  const [localNumber, setLocalNumber] = useState(parsed.number)

  // Sync when value is reset externally (e.g. form clear)
  useEffect(() => {
    const p = parse(value)
    setCountryCode(p.code)
    setLocalNumber(p.number)
  }, [value])

  const handleCodeChange = (e) => {
    const code = e.target.value
    setCountryCode(code)
    onChange?.(localNumber ? `${code}${localNumber}` : '')
  }

  const handleNumberChange = (e) => {
    const num = e.target.value
    setLocalNumber(num)
    onChange?.(num ? `${countryCode}${num}` : '')
  }

  return (
    <div className={`
      flex rounded-xl border bg-white overflow-hidden
      transition-all duration-200
      focus-within:border-primary-500 focus-within:ring-4 focus-within:ring-primary-500/10
      ${error ? 'border-red-400 focus-within:border-red-400 focus-within:ring-red-400/10' : 'border-slate-200'}
      ${className}
    `}>
      <select
        value={countryCode}
        onChange={handleCodeChange}
        disabled={disabled}
        className="shrink-0 border-r border-slate-200 bg-slate-50 pl-2.5 pr-1 text-sm text-slate-600 focus:outline-none cursor-pointer"
      >
        {COUNTRIES.map(({ code, flag }) => (
          <option key={code} value={code}>{flag} {code}</option>
        ))}
      </select>
      <input
        type="tel"
        value={localNumber}
        onChange={handleNumberChange}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        data-testid={testid}
        className="flex-1 min-w-0 px-3 py-2.5 text-sm bg-transparent text-slate-800 placeholder-slate-400 focus:outline-none"
      />
    </div>
  )
}

export default PhoneInput
