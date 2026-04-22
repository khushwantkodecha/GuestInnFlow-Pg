// ExcelJS loaded on-demand to keep the main bundle lean

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }
const HEADER_FONT = { bold: true, size: 10 }
const HEADER_BORDER = {
  bottom: { style: 'medium', color: { argb: 'FF94A3B8' } },
}

function applyHeaderRow(row) {
  row.font = HEADER_FONT
  row.fill = HEADER_FILL
  row.eachCell(cell => { cell.border = HEADER_BORDER })
}

function rupeeCell(cell, value) {
  cell.value = value
  cell.numFmt = '₹#,##0'
  cell.alignment = { horizontal: 'right' }
}

const isRefundType = (rt) => rt === 'deposit_refunded' || rt === 'refund'

export async function exportLedgerXlsx({ entries, tenant, currentBalance }) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator  = 'GuestInnFlow'
  wb.created  = new Date()
  wb.modified = new Date()

  // ── Derived values ──────────────────────────────────────────────────
  const sorted = [...entries].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))

  const rentEs     = sorted.filter(e => ['rent_generated', 'rent_record'].includes(e.referenceType))
  const chargesEs  = sorted.filter(e => e.referenceType === 'adjustment')
  const paymentsEs = sorted.filter(e => ['payment_received', 'payment'].includes(e.referenceType))
  const depAdjEs   = paymentsEs.filter(e => e.method === 'deposit_adjustment')
  const cashEs     = paymentsEs.filter(e => e.method !== 'deposit_adjustment')

  const totalRent     = rentEs.reduce((s, e)    => s + (e.amount ?? 0), 0)
  const totalCharges  = chargesEs.reduce((s, e) => s + (e.amount ?? 0), 0)
  const totalCash     = cashEs.reduce((s, e)    => s + (e.amount ?? 0), 0)
  const depositUsed   = depAdjEs.reduce((s, e)  => s + (e.amount ?? 0), 0)
  const totalBilled   = totalRent + totalCharges
  const totalCleared  = totalCash + depositUsed

  const depositOriginal  = tenant.depositAmount  ?? 0
  const depositAvailable = tenant.depositBalance  ?? depositOriginal
  const roomInfo = tenant.bed
    ? `Room ${tenant.bed.room?.roomNumber ?? '?'} · Bed ${tenant.bed.bedNumber}`
    : '—'

  const HIDE_TYPES = new Set(['deposit_adjusted', 'deposit_collected'])

  // ── Sheet 1: Summary ────────────────────────────────────────────────
  const sumWs = wb.addWorksheet('Summary')
  sumWs.columns = [
    { key: 'field', width: 26 },
    { key: 'value', width: 22 },
  ]

  const sumHeaderRow = sumWs.addRow(['Field', 'Value'])
  applyHeaderRow(sumHeaderRow)
  sumWs.autoFilter = { from: 'A1', to: 'B1' }
  sumWs.views = [{ state: 'frozen', ySplit: 1 }]

  const summaryData = [
    ['Tenant Name',        tenant.name ?? '—', false],
    ['Property / Room',    roomInfo,            false],
    ['Total Billed',       totalBilled,         true ],
    ['  – Rent',           totalRent,           true ],
    ['  – Charges',        totalCharges,        true ],
    ['Total Paid (Cash)',  totalCash,            true ],
    ['Deposit Used',       depositUsed,          true ],
    ['Total Cleared',      totalCleared,         true ],
    ['Remaining Balance',  currentBalance,       true ],
    ['Deposit Available',  depositAvailable,     true ],
  ]

  summaryData.forEach(([field, value, isCurrency]) => {
    const row = sumWs.addRow([field, isCurrency ? value : value])
    row.getCell('A').font = { size: 10 }
    if (isCurrency) {
      rupeeCell(row.getCell('B'), value)
      if (field === 'Remaining Balance' && value > 0)
        row.getCell('B').font = { bold: true, color: { argb: 'FFDC2626' }, size: 10 }
    } else {
      row.getCell('B').alignment = { horizontal: 'left' }
      row.getCell('B').font = { size: 10 }
    }
  })

  // ── Sheet 2: Ledger ─────────────────────────────────────────────────
  const ledWs = wb.addWorksheet('Ledger')
  ledWs.columns = [
    { key: 'date',    width: 17 },
    { key: 'desc',    width: 36 },
    { key: 'type',    width: 22 },
    { key: 'method',  width: 16 },
    { key: 'amount',  width: 15 },
    { key: 'balance', width: 15 },
  ]

  const ledHeader = ledWs.addRow(['Date', 'Description', 'Type', 'Method', 'Amount (₹)', 'Balance After (₹)'])
  applyHeaderRow(ledHeader)
  ledWs.autoFilter = { from: 'A1', to: 'F1' }
  ledWs.views = [{ state: 'frozen', ySplit: 1 }]

  sorted.filter(e => !HIDE_TYPES.has(e.referenceType)).forEach(e => {
    const isDebit   = e.type === 'debit' || isRefundType(e.referenceType)
    const amtSigned = isDebit ? -(e.amount ?? 0) : (e.amount ?? 0)
    const methodLabel = e.method === 'deposit_adjustment' ? 'Deposit Adj.'
      : e.method === 'bank_transfer' ? 'Bank Transfer'
      : e.method === 'upi' ? 'UPI'
      : e.method ? e.method.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      : ''
    const typeLabel = e.referenceType?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) ?? '—'

    const row = ledWs.addRow([
      new Date(e.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      e.description ?? '—',
      typeLabel,
      methodLabel,
      amtSigned,
      e.balanceAfter ?? 0,
    ])

    const amtCell = row.getCell(5)
    amtCell.numFmt    = '₹#,##0;[Red]-₹#,##0'
    amtCell.alignment = { horizontal: 'right' }
    amtCell.font = { color: { argb: isDebit ? 'FFDC2626' : 'FF16A34A' }, size: 10 }

    const balCell = row.getCell(6)
    const bal = e.balanceAfter ?? 0
    balCell.value     = bal
    balCell.numFmt    = '₹#,##0;[Red]₹#,##0'
    balCell.alignment = { horizontal: 'right' }
    balCell.font = {
      bold: bal !== 0,
      color: { argb: bal > 0 ? 'FFDC2626' : bal < 0 ? 'FF16A34A' : 'FF64748B' },
      size: 10,
    }

    row.getCell(1).font = { size: 10 }
    row.getCell(2).font = { size: 10 }
    row.getCell(3).font = { size: 10, color: { argb: 'FF64748B' } }
    row.getCell(4).font = { size: 10, color: { argb: 'FF64748B' } }
  })

  // ── Sheet 3: Breakdown ──────────────────────────────────────────────
  const bkWs = wb.addWorksheet('Breakdown')
  bkWs.columns = [
    { key: 'category', width: 26 },
    { key: 'amount',   width: 18 },
  ]

  const bkHeader = bkWs.addRow(['Category', 'Amount (₹)'])
  applyHeaderRow(bkHeader)
  bkWs.autoFilter = { from: 'A1', to: 'B1' }
  bkWs.views = [{ state: 'frozen', ySplit: 1 }]

  const sections = [
    { label: '— BILLED —',         value: null },
    { label: 'Total Rent',          value: totalRent    },
    { label: 'Total Charges',       value: totalCharges },
    { label: 'Total Billed',        value: totalBilled,  bold: true },
    { label: '',                    value: null },
    { label: '— PAID —',            value: null },
    { label: 'Cash Payments',       value: totalCash    },
    { label: 'Deposit Used',        value: depositUsed  },
    { label: 'Total Cleared',       value: totalCleared, bold: true },
    { label: '',                    value: null },
    { label: '— BALANCE —',         value: null },
    { label: 'Remaining Balance',   value: currentBalance,  bold: true, red: currentBalance > 0 },
    { label: '',                    value: null },
    { label: '— DEPOSIT —',         value: null },
    { label: 'Original Deposit',    value: depositOriginal  },
    { label: 'Deposit Used',        value: depositUsed      },
    { label: 'Deposit Available',   value: depositAvailable, bold: true },
  ]

  sections.forEach(({ label, value, bold, red }) => {
    if (!label) { bkWs.addRow([]); return }
    if (value === null) {
      const sRow = bkWs.addRow([label, ''])
      sRow.getCell(1).font = { bold: true, italic: true, color: { argb: 'FF64748B' }, size: 9 }
      sRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }
      return
    }
    const row = bkWs.addRow([label, value])
    row.getCell(1).font = { bold, size: 10 }
    const valCell = row.getCell(2)
    valCell.value     = value
    valCell.numFmt    = '₹#,##0'
    valCell.alignment = { horizontal: 'right' }
    valCell.font = {
      bold,
      size: 10,
      color: { argb: red ? 'FFDC2626' : bold ? 'FF1E293B' : 'FF334155' },
    }
  })

  // ── Download ────────────────────────────────────────────────────────
  const now      = new Date()
  const safeName = (tenant.name ?? 'Tenant').replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '')
  const fileName = `${safeName}_Ledger_${MONTHS[now.getMonth()]}_${now.getFullYear()}.xlsx`

  const buffer = await wb.xlsx.writeBuffer()
  const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url    = URL.createObjectURL(blob)
  const a      = document.createElement('a')
  a.href       = url
  a.download   = fileName
  a.click()
  URL.revokeObjectURL(url)
}
