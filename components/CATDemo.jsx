'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { STEPS_5STAR, STEPS_1STAR } from '@/lib/steps-data'

// ── Brand colors ──────────────────────────────────────────────────────────────
const TEAL   = '#6ac6ac'
const YELLOW = '#ffdb9c'
const BLUE   = '#b6cbff'

/** Optional: set `NEXT_PUBLIC_ARXIV_URL` in `.env.local` when the paper is live. */
const ARXIV_PAPER_URL =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_ARXIV_URL
    ? process.env.NEXT_PUBLIC_ARXIV_URL.trim()
    : ''

const PREFIX_WORDS = ['[sos]', 'I', 'really']
const PREFIX_GREY = '#9ca3af'
const ATTR_THRESHOLD = '0.8'
const TOKEN_EPSILON = '0.001'
const PREFIX_WORD_MS = 420

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

function chartLabelsForSteps(steps) {
  return steps.map(s =>
    s.chosen_token.replace(/<\|([^|]+)\|>/g, '[$1]').trim() || '·'
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function CATDemo() {
  const [steerTarget, setSteerTarget] = useState('5')
  const [introStage, setIntroStage]   = useState('pre') // 'pre' | 'prefix' | 'live'
  const [prefixCount, setPrefixCount] = useState(0)
  const [currentStep, setCurrentStep] = useState(0)
  const [sortCol, setSortCol]         = useState('prob')
  const [sortDir, setSortDir]         = useState('desc')

  const canvasRef      = useRef(null)
  const chartRef       = useRef(null)
  const prefixTimerRef = useRef(null)

  const steps = useMemo(
    () => (steerTarget === '5' ? STEPS_5STAR : STEPS_1STAR),
    [steerTarget]
  )
  const hasSteps = steps.length > 0
  const star1Ready = STEPS_1STAR.length > 0
  const live = introStage === 'live' && hasSteps
  const step = live ? steps[currentStep] : null

  const resetIntro = useCallback(() => {
    if (prefixTimerRef.current) {
      clearInterval(prefixTimerRef.current)
      prefixTimerRef.current = null
    }
    setIntroStage('pre')
    setPrefixCount(0)
    setCurrentStep(0)
  }, [])

  const onSteerChange = next => {
    if (next === '1' && !star1Ready) return
    setSteerTarget(next)
    resetIntro()
  }

  // ── Init / rebuild Chart.js when trace set changes ─────────────────────────
  useEffect(() => {
    if (!hasSteps) {
      chartRef.current?.destroy()
      chartRef.current = null
      return
    }
    let chart
    const labels = chartLabelsForSteps(steps)
    import('chart.js/auto').then(({ Chart }) => {
      if (!canvasRef.current) return
      chartRef.current?.destroy()
      chartRef.current = null
      chart = new Chart(canvasRef.current, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: '5★ prob',
              data: Array(steps.length).fill(null),
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
              data: Array(steps.length).fill(null),
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
    return () => {
      chart?.destroy()
      if (chartRef.current === chart) chartRef.current = null
    }
  }, [steps, hasSteps])

  // ── Update chart when step changes ─────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !live) return
    const star5 = Array(steps.length).fill(null)
    const star1 = Array(steps.length).fill(null)
    for (let i = 0; i <= currentStep; i++) {
      star5[i] = steps[i].chosen_star5
      star1[i] = steps[i].chosen_star1
    }
    chart.data.datasets[0].data = star5
    chart.data.datasets[1].data = star1
    chart.data.datasets.forEach(ds => {
      ds.pointRadius      = Array.from({ length: steps.length }, (_, i) => i === currentStep ? 8 : i <= currentStep ? 4 : 0)
      ds.pointHoverRadius = Array.from({ length: steps.length }, (_, i) => i <= currentStep ? 6 : 0)
    })
    chart.update()
  }, [currentStep, live, steps])

  // ── Keyboard navigation ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = e => {
      if (!live) return
      if (e.key === 'ArrowRight') setCurrentStep(s => Math.min(s + 1, steps.length - 1))
      if (e.key === 'ArrowLeft')  setCurrentStep(s => Math.max(s - 1, 0))
      if (e.key === 'r' || e.key === 'R') resetIntro()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [live, steps.length, resetIntro])

  const playPrefix = () => {
    if (!hasSteps) return
    if (prefixTimerRef.current) clearInterval(prefixTimerRef.current)
    setIntroStage('prefix')
    setPrefixCount(1)
    let i = 1
    prefixTimerRef.current = setInterval(() => {
      i += 1
      if (i > PREFIX_WORDS.length) {
        if (prefixTimerRef.current) clearInterval(prefixTimerRef.current)
        prefixTimerRef.current = null
        setIntroStage('live')
        setCurrentStep(0)
        return
      }
      setPrefixCount(i)
    }, PREFIX_WORD_MS)
  }

  useEffect(() => () => {
    if (prefixTimerRef.current) clearInterval(prefixTimerRef.current)
  }, [])

  // ── Table sort (only when live) ────────────────────────────────────────────
  const { minProb, maxProb, min1, max1, min5, max5 } = useMemo(() => {
    if (!step) {
      return { minProb: 0, maxProb: 1, min1: 0, max1: 1, min5: 0, max5: 1 }
    }
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
    if (!step) return []
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

  const prefixShown = PREFIX_WORDS.slice(0, prefixCount).join(' ')
  const steerLabel = steerTarget === '5' ? '5★' : '1★'

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="bg-gray-50 text-gray-900 min-h-screen">
      <div className="max-w-5xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-2">
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
              CAT: Conditional Attribute Transformers
            </h1>
            {ARXIV_PAPER_URL ? (
              <a
                href={ARXIV_PAPER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-[#4aaa94] hover:underline"
              >
                Paper on arXiv →
              </a>
            ) : (
              <span className="text-sm text-gray-400 border border-dashed border-gray-300 rounded-lg px-3 py-1.5">
                arXiv link (add <code className="text-xs text-gray-500">NEXT_PUBLIC_ARXIV_URL</code> in <code className="text-xs text-gray-500">.env.local</code>)
              </span>
            )}
          </div>

          <div className="text-gray-600 text-sm max-w-3xl space-y-3 leading-relaxed">
            <p>
              What if a language model could predict not only the next token, but also its consequences?
              <span className="text-gray-500"> Conditional Attribute Transformers (CAT) jointly estimate the next token and, for each candidate next token, sequence-level outcomes—enabling attribution, counterfactual comparison across next-token choices, and steering via sequential selection.</span>
            </p>
            <p className="text-gray-500">
              In one forward pass they support token-level attribution to downstream outcomes, counterfactual reasoning under alternative next tokens, and steering toward safer or better outcomes. They set strong results on RL and language modeling; in medical foundation models they support interpretable dynamic risk estimation with massive speedups over sampling. Joint training can also improve plain next-token prediction.
            </p>
          </div>

          <div className="mt-5 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Satisficing criterion</div>
            <p className="text-gray-700">
              Attribute threshold: <span className="font-mono tabular-nums">{ATTR_THRESHOLD}</span>
              <span className="text-gray-300 mx-2">·</span>
              Token epsilon: <span className="font-mono tabular-nums">{TOKEN_EPSILON}</span>
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Steer toward</span>
            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm">
              <button
                type="button"
                onClick={() => onSteerChange('5')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  steerTarget === '5' ? 'text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'
                }`}
                style={steerTarget === '5' ? { background: TEAL, border: '1px solid #5ab89e' } : {}}
              >
                ★★★★★ 5-star
              </button>
              <button
                type="button"
                onClick={() => onSteerChange('1')}
                disabled={!star1Ready}
                title={!star1Ready ? '1★ trace data coming soon' : 'Steer toward 1★ reviews'}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  steerTarget === '1' ? 'text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'
                } ${!star1Ready ? 'opacity-45 cursor-not-allowed' : ''}`}
                style={steerTarget === '1' ? { background: BLUE, border: '1px solid #9bb3f0' } : {}}
              >
                ★☆☆☆☆ 1-star
              </button>
            </div>
            {!star1Ready && (
              <span className="text-xs text-gray-400">1★ tables: plug in data in <code className="text-[11px]">lib/steps-data.js</code> (<code className="text-[11px]">STEPS_1STAR</code>).</span>
            )}
          </div>
        </div>

        {/* Generated text */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 shadow-sm">
          <div className="text-xs text-gray-400 uppercase tracking-widest mb-3 font-semibold">Generated text</div>
          <p className="text-xs text-gray-500 mb-3 leading-relaxed">
            Prefix <span className="font-mono text-gray-600">[sos] I really</span> is fixed context (shown in grey). Press <strong className="text-gray-700">Play</strong> to reveal it word by word; then step through CAT decoding steered toward <strong className="text-gray-700">{steerLabel}</strong> using the satisficing rule above.
          </p>
          <div className="text-lg leading-relaxed font-mono min-h-10 text-gray-600">
            {introStage === 'pre' && (
              <span className="text-gray-300 select-none">···</span>
            )}
            {introStage === 'prefix' && (
              <span style={{ color: PREFIX_GREY }}>{prefixShown}</span>
            )}
            {live && step && (
              <>
                <span style={{ color: PREFIX_GREY }}>[sos] </span>
                <ContextText context={step.context} />
                <span style={{ background: '#d4f2ea', color: '#2a7d68', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>
                  {renderSpecial(step.chosen_token_display)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Chart */}
        {hasSteps && (
          <div className={`bg-white border border-gray-200 rounded-xl p-5 mb-6 shadow-sm ${!live ? 'opacity-40 pointer-events-none' : ''}`}>
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
            {!live && (
              <p className="text-center text-xs text-gray-400 mt-2">Chart updates after Play finishes the prefix.</p>
            )}
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={playPrefix}
              disabled={!hasSteps || introStage === 'prefix'}
              className="px-4 py-2 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm disabled:opacity-35 disabled:cursor-not-allowed"
              style={{ background: '#4b5563', border: '1px solid #374151' }}
            >
              ▶ Play
            </button>
            <button
              type="button"
              onClick={resetIntro}
              className="px-4 py-2 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg text-sm font-medium text-gray-600 transition-colors shadow-sm"
            >
              ↺ Reset
            </button>
            <button
              type="button"
              onClick={() => setCurrentStep(s => Math.max(s - 1, 0))}
              disabled={!live || currentStep === 0}
              className="px-4 py-2 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg text-sm font-medium text-gray-600 transition-colors shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => setCurrentStep(s => Math.min(s + 1, steps.length - 1))}
              disabled={!live || currentStep >= steps.length - 1}
              className="px-4 py-2 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ background: TEAL, border: '1px solid #5ab89e' }}
            >
              Next →
            </button>
          </div>
          <div className="text-sm text-gray-400 font-mono">
            {live ? `Step ${currentStep + 1} / ${steps.length}` : introStage === 'prefix' ? 'Prefix…' : 'Press Play'}
          </div>
        </div>

        {/* Selection logic */}
        {live && step && (
          <div className="rounded-lg px-4 py-2.5 mb-5 text-sm" style={{ background: '#f0faf8', border: '1px solid #b8e6d9' }}>
            <span className="font-semibold mr-1" style={{ color: '#4aaa94' }}>Selection logic:</span>
            <span className="text-gray-600">{step.explanation}</span>
          </div>
        )}

        {/* Candidate table */}
        {live && step && (
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
        )}

        {!hasSteps && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500 text-sm">
            No step data for this steer target yet.
          </div>
        )}

      </div>
    </div>
  )
}
