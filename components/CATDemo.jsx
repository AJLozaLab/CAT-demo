'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { STEPS } from '@/lib/steps-data'

// ── Brand colors ──────────────────────────────────────────────────────────────
const TEAL   = '#6ac6ac'
const YELLOW = '#ffdb9c'
const BLUE   = '#b6cbff'

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtPct(n) {
  if (n == null) return '—'
  return (n * 100).toFixed(2) + '%'
}

function colNorm(val, min, max) {
  return max > min ? (val - min) / (max - min) : 0
}

function cellBg(t, hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgb(${Math.round(255 + (r - 255) * t)},${Math.round(255 + (g - 255) * t)},${Math.round(255 + (b - 255) * t)})`
}

function SpecialTokenBadge({ token }) {
  const t = token.trim()
  if (t === '<|sor|>')  return <span className="token-badge" style={{ background: '#e8f7f2', color: '#3a9e88', border: '1px solid #b8e6d9' }}>⏎ END-OF-REVIEW</span>
  if (t === '<|*_5|>')  return <span className="token-badge" style={{ background: '#fff8e8', color: '#b87a00', border: '1px solid #ffdb9c' }}>★★★★★ 5-STAR</span>
  if (t === '<|*_4|>')  return <span className="token-badge" style={{ background: '#fff8e8', color: '#b87a00', border: '1px solid #ffdb9c' }}>★★★★☆ 4-STAR</span>
  if (t === '<|*_3|>')  return <span className="token-badge" style={{ background: '#f3f4f6', color: '#6b7280', border: '1px solid #d1d5db' }}>★★★☆☆ 3-STAR</span>
  if (t === '<|*_2|>')  return <span className="token-badge" style={{ background: '#f3f0ff', color: '#7c6ca8', border: '1px solid #c4b5fd' }}>★★☆☆☆ 2-STAR</span>
  if (t === '<|*_1|>')  return <span className="token-badge" style={{ background: '#eef3ff', color: '#4a6ecc', border: '1px solid #b6cbff' }}>★☆☆☆☆ 1-STAR</span>
  if (t === '<|*_0|>')  return <span className="token-badge" style={{ background: '#f3f4f6', color: '#9ca3af', border: '1px solid #e5e7eb' }}>☆ 0-STAR</span>
  return null
}

function TokenDisplay({ token }) {
  const badge = <SpecialTokenBadge token={token} />
  if (badge.type !== SpecialTokenBadge || badge.props) {
    const special = token.trim().match(/^<\|[^|]+\|>$/)
    if (special) return <SpecialTokenBadge token={token} />
  }
  if (token.trim() === '') return <span className="text-gray-400 italic">[space]</span>
  return <span className="font-mono">{token}</span>
}

function renderSpecial(token) {
  const t = token.trim()
  const isSpecial = /^<\|[^|]+\|>$/.test(t)
  if (isSpecial) return <SpecialTokenBadge token={token} />
  if (token.trim() === '') return <span className="text-gray-400 italic">[space]</span>
  return <>{token}</>
}

// Parse a context string, rendering any embedded special tokens as badges
function ContextText({ context }) {
  const parts = context.split(/(<\|[^|]+\|>)/g)
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>{renderSpecial(part)}</span>
      ))}
    </>
  )
}

// ── Chart labels (computed once) ──────────────────────────────────────────────
const ALL_LABELS = STEPS.map(s =>
  s.chosen_token.replace(/<\|([^|]+)\|>/g, '[$1]').trim() || '·'
)

// ── Main component ────────────────────────────────────────────────────────────
export default function CATDemo() {
  const [currentStep, setCurrentStep] = useState(0)
  const [sortCol, setSortCol]         = useState('prob')
  const [sortDir, setSortDir]         = useState('desc')

  const canvasRef      = useRef(null)
  const chartRef       = useRef(null)

  // ── Init Chart.js ──────────────────────────────────────────────────────────
  useEffect(() => {
    let chart
    import('chart.js/auto').then(({ Chart }) => {
      if (!canvasRef.current || chartRef.current) return
      chart = new Chart(canvasRef.current, {
        type: 'line',
        data: {
          labels: ALL_LABELS,
          datasets: [
            {
              label: '5★ prob',
              data: Array(STEPS.length).fill(null),
              borderColor: TEAL,
              backgroundColor: 'rgba(106,198,172,0.12)',
              pointBackgroundColor: TEAL,
              pointBorderColor: '#fff',
              pointBorderWidth: 1.5,
              pointRadius: 5,
              pointHoverRadius: 7,
              tension: 0.3,
              fill: false,
              borderWidth: 2.5,
            },
            {
              label: '1★ prob',
              data: Array(STEPS.length).fill(null),
              borderColor: BLUE,
              backgroundColor: 'rgba(182,203,255,0.12)',
              pointBackgroundColor: BLUE,
              pointBorderColor: '#fff',
              pointBorderWidth: 1.5,
              pointRadius: 5,
              pointHoverRadius: 7,
              tension: 0.3,
              fill: false,
              borderWidth: 2.5,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 300 },
          scales: {
            x: {
              ticks: { color: '#9ca3af', maxRotation: 45, font: { family: 'JetBrains Mono, monospace', size: 11 } },
              grid:  { color: 'rgba(0,0,0,0.05)' },
              border: { color: '#e5e7eb' },
            },
            y: {
              min: 0, max: 1,
              ticks: { color: '#9ca3af', font: { size: 11 }, callback: v => (v * 100).toFixed(0) + '%' },
              grid:  { color: 'rgba(0,0,0,0.06)' },
              border: { color: '#e5e7eb' },
            },
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#fff',
              borderColor: '#e5e7eb',
              borderWidth: 1,
              titleColor: '#111827',
              bodyColor: '#6b7280',
              callbacks: { label: ctx => `${ctx.dataset.label}: ${fmtPct(ctx.raw)}` },
            },
          },
        },
      })
      chartRef.current = chart
    })
    return () => { chart?.destroy(); chartRef.current = null }
  }, [])

  // ── Update chart when step changes ─────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const star5 = Array(STEPS.length).fill(null)
    const star1 = Array(STEPS.length).fill(null)
    for (let i = 0; i <= currentStep; i++) {
      star5[i] = STEPS[i].chosen_star5
      star1[i] = STEPS[i].chosen_star1
    }
    chart.data.datasets[0].data = star5
    chart.data.datasets[1].data = star1
    chart.data.datasets.forEach(ds => {
      ds.pointRadius      = Array.from({ length: STEPS.length }, (_, i) => i === currentStep ? 8 : i <= currentStep ? 4 : 0)
      ds.pointHoverRadius = Array.from({ length: STEPS.length }, (_, i) => i <= currentStep ? 6 : 0)
    })
    chart.update()
  }, [currentStep])

  // ── Keyboard navigation ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'ArrowRight') setCurrentStep(s => Math.min(s + 1, STEPS.length - 1))
      if (e.key === 'ArrowLeft')  setCurrentStep(s => Math.max(s - 1, 0))
      if (e.key === 'r' || e.key === 'R') setCurrentStep(0)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Derived state ──────────────────────────────────────────────────────────
  const step = STEPS[currentStep]

  const { minProb, maxProb, min1, max1, min5, max5 } = useMemo(() => {
    const pv = step.table.map(r => r.prob)
    const s1 = step.table.map(r => r.star1)
    const s5 = step.table.map(r => r.star5)
    return {
      minProb: Math.min(...pv), maxProb: Math.max(...pv),
      min1: Math.min(...s1),    max1: Math.max(...s1),
      min5: Math.min(...s5),    max5: Math.max(...s5),
    }
  }, [step])

  const sortedRows = useMemo(() => {
    return [...step.table].sort((a, b) => {
      const va = a[sortCol], vb = b[sortCol]
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
      return sortDir === 'asc' ? va - vb : vb - va
    })
  }, [step, sortCol, sortDir])

  const handleSort = col => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir(col === 'token' ? 'asc' : 'desc') }
  }

  const sortIcon = col => sortCol !== col ? '↕' : sortDir === 'asc' ? '↑' : '↓'
  const thClass  = col => `px-5 py-3 cursor-pointer select-none transition-colors hover:text-[#4aaa94] ${sortCol === col ? 'text-[#6ac6ac]' : ''}`

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="bg-gray-50 text-gray-900 min-h-screen">
      <div className="max-w-5xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-white text-xs font-semibold px-2.5 py-1 rounded-full tracking-widest uppercase" style={{ background: TEAL }}>
              Research Demo
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 mb-1">
            CAT: Conditional Attribute Transformers
          </h1>
          <p className="text-gray-500 text-sm max-w-2xl">
            Step through token-by-token generation steered toward high sentiment. At each position
            the model scores all candidate tokens by their attribute probabilities (1★ &amp; 5★) and
            selects a token consistent with the target attribute.
          </p>
        </div>

        {/* Generated text */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 shadow-sm">
          <div className="text-xs text-gray-400 uppercase tracking-widest mb-3 font-semibold">Generated text</div>
          <div className="text-lg leading-relaxed font-mono min-h-10 text-gray-600">
            <ContextText context={step.context} />
            <span style={{ background: '#d4f2ea', color: '#2a7d68', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>
              {renderSpecial(step.chosen_token_display)}
            </span>
          </div>
        </div>

        {/* Chart */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs text-gray-400 uppercase tracking-widest font-semibold">
              Attribute probabilities of chosen tokens
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-600">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-full" style={{ background: BLUE }} />
                1★ prob
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-full" style={{ background: TEAL }} />
                5★ prob
              </span>
            </div>
          </div>
          <div className="relative h-[220px]">
            <canvas ref={canvasRef} />
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setCurrentStep(0)}
              className="px-4 py-2 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg text-sm font-medium text-gray-600 transition-colors shadow-sm"
            >
              ↺ Reset
            </button>
            <button
              onClick={() => setCurrentStep(s => Math.max(s - 1, 0))}
              disabled={currentStep === 0}
              className="px-4 py-2 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg text-sm font-medium text-gray-600 transition-colors shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ← Back
            </button>
            <button
              onClick={() => setCurrentStep(s => Math.min(s + 1, STEPS.length - 1))}
              disabled={currentStep === STEPS.length - 1}
              className="px-4 py-2 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ background: TEAL, border: '1px solid #5ab89e' }}
            >
              Next →
            </button>
          </div>
          <div className="text-sm text-gray-400 font-mono">
            Step {currentStep + 1} / {STEPS.length}
          </div>
        </div>

        {/* Selection logic */}
        <div className="rounded-lg px-4 py-2.5 mb-5 text-sm" style={{ background: '#f0faf8', border: '1px solid #b8e6d9' }}>
          <span className="font-semibold mr-1" style={{ color: '#4aaa94' }}>Selection logic:</span>
          <span className="text-gray-600">{step.explanation}</span>
        </div>

        {/* Candidate table */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="text-xs text-gray-400 uppercase tracking-widest font-semibold">
              Candidate tokens at current position
            </div>
            <div className="text-xs text-gray-400">
              Click column headers to sort · Column color = attribute intensity
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-400 text-xs uppercase tracking-wide border-b border-gray-100">
                  <th className={`${thClass('token')} text-left`} onClick={() => handleSort('token')}>
                    Token <span className="ml-1 opacity-60">{sortIcon('token')}</span>
                  </th>
                  <th className={`${thClass('prob')} text-right`} onClick={() => handleSort('prob')}>
                    Token prob <span className="ml-1 opacity-60">{sortIcon('prob')}</span>
                  </th>
                  <th className={`${thClass('star1')} text-right`} onClick={() => handleSort('star1')}>
                    1★ prob <span className="ml-1 opacity-60">{sortIcon('star1')}</span>
                  </th>
                  <th className={`${thClass('star5')} text-right`} onClick={() => handleSort('star5')}>
                    5★ prob <span className="ml-1 opacity-60">{sortIcon('star5')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, i) => {
                  const isChosen = row.token.trim() === step.chosen_token.trim()
                  const bgProb = cellBg(colNorm(row.prob,  minProb, maxProb), YELLOW)
                  const bg1    = cellBg(colNorm(row.star1, min1,    max1),    BLUE)
                  const bg5    = cellBg(colNorm(row.star5, min5,    max5),    TEAL)
                  return (
                    <tr
                      key={i}
                      className="transition-colors hover:brightness-95"
                      style={{ background: 'white', outline: isChosen ? `2px solid ${TEAL}` : 'none', outlineOffset: '-2px' }}
                    >
                      <td className="px-5 py-2.5 font-medium font-mono text-gray-800 border-b border-gray-50">
                        <div className="flex items-center gap-2">
                          {renderSpecial(row.token)}
                          {isChosen && (
                            <span className="text-xs text-white px-1.5 py-0.5 rounded font-semibold" style={{ background: TEAL }}>
                              chosen
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-2.5 text-right font-mono tabular-nums text-gray-700 border-b border-gray-50" style={{ background: bgProb }}>
                        {fmtPct(row.prob)}
                      </td>
                      <td className="px-5 py-2.5 text-right font-mono tabular-nums text-gray-700 border-b border-gray-50" style={{ background: bg1 }}>
                        {fmtPct(row.star1)}
                      </td>
                      <td className="px-5 py-2.5 text-right font-mono tabular-nums text-gray-700 border-b border-gray-50" style={{ background: bg5 }}>
                        {fmtPct(row.star5)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}
