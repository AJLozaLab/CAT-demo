'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  STEPS_5STAR,
  STEPS_1STAR,
  STEPS_5_THEN_1,
  STEPS_1_THEN_5,
  PROMPT_STEPS,
  BRANCH_FROM_5_INDEX,
  BRANCH_FROM_1_INDEX,
  getFixedSteerPromptDisplay,
  countPromptOnlySteps,
  mergeTraceAtBranch,
} from '@/lib/steps-data'

// ── Brand colors (5★ vs 1★) ───────────────────────────────────────────────────
const STAR5 = '#648FFF'
const STAR1 = '#D95B5D'
const YELLOW = '#ffdb9c'

const STAR5_SOFT = 'rgba(100, 143, 255, 0.14)'
const STAR1_SOFT = 'rgba(217, 91, 93, 0.14)'
const STAR5_BORDER = '#4a72d9'
const STAR1_BORDER = '#b84a4c'

const ARXIV_PAPER_URL = 'http://arxiv.org/abs/2605.14004'

const ATTR_THRESHOLD = '0.8'
const TOKEN_EPSILON = '0.001'
const TOP_K = '20'

const DEFAULT_TOKEN_REVEAL_MS = 1000

const PROMPT_CHART_GREY = '#9ca3af'
const PROMPT_CHART_GREY_DARK = '#6b7280'

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
  if (t === '<|*_5|>')  return <span className="token-badge" style={{ background: '#e8eeff', color: '#3d5cad', border: '1px solid #c8d9ff' }}>★★★★★ 5-STAR</span>
  if (t === '<|*_4|>')  return <span className="token-badge" style={{ background: '#fff8e8', color: '#b87a00', border: '1px solid #ffdb9c' }}>★★★★☆ 4-STAR</span>
  if (t === '<|*_3|>')  return <span className="token-badge" style={{ background: '#f3f4f6', color: '#6b7280', border: '1px solid #d1d5db' }}>★★★☆☆ 3-STAR</span>
  if (t === '<|*_2|>')  return <span className="token-badge" style={{ background: '#f3f0ff', color: '#7c6ca8', border: '1px solid #c4b5fd' }}>★★☆☆☆ 2-STAR</span>
  if (t === '<|*_1|>')  return <span className="token-badge" style={{ background: '#fceaea', color: '#a33436', border: '1px solid #f0b4b5' }}>★☆☆☆☆ 1-STAR</span>
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

/** Concatenate steered decode tokens (skips prompt-only I / really). */
function starLabel(target) {
  return target === '5' ? '5-Star' : '1-Star'
}

function committedChosenDisplay(steps, count) {
  if (!steps?.length || count <= 0) return ''
  return steps
    .slice(0, count)
    .filter(s => !s.prompt_only)
    .map(s => s.chosen_token_display)
    .join('')
}

function applyChartStep(chart, stepList, idx, visibleCount, { preSteer = false } = {}) {
  const n = Math.min(Math.max(0, visibleCount), stepList.length)
  if (n === 0) return
  const hi = Math.min(Math.max(0, idx), n - 1)
  const star5 = Array(n).fill(null)
  const star1 = Array(n).fill(null)
  for (let i = 0; i <= hi; i++) {
    star5[i] = stepList[i].chosen_star5
    star1[i] = stepList[i].chosen_star1
  }
  chart.data.labels = chartLabelsForSteps(stepList).slice(0, n)
  chart.data.datasets[0].data = star5
  chart.data.datasets[1].data = star1

  if (preSteer) {
    chart.data.datasets[0].borderColor = PROMPT_CHART_GREY
    chart.data.datasets[1].borderColor = PROMPT_CHART_GREY
    chart.data.datasets[0].backgroundColor = 'transparent'
    chart.data.datasets[1].backgroundColor = 'transparent'
    chart.data.datasets[0].pointBackgroundColor = Array(n).fill(PROMPT_CHART_GREY)
    chart.data.datasets[1].pointBackgroundColor = Array(n).fill(PROMPT_CHART_GREY)
    chart.data.datasets[0].pointBorderColor = Array.from({ length: n }, (_, i) =>
      i === hi ? PROMPT_CHART_GREY_DARK : '#fff'
    )
    chart.data.datasets[1].pointBorderColor = Array.from({ length: n }, (_, i) =>
      i === hi ? PROMPT_CHART_GREY_DARK : '#fff'
    )
    if (chart.options.scales?.x?.ticks) {
      chart.options.scales.x.ticks.color = PROMPT_CHART_GREY
    }
  } else {
    chart.data.datasets[0].borderColor = STAR5
    chart.data.datasets[1].borderColor = STAR1
    chart.data.datasets[0].backgroundColor = STAR5_SOFT
    chart.data.datasets[1].backgroundColor = STAR1_SOFT
    chart.data.datasets[0].pointBackgroundColor = STAR5
    chart.data.datasets[1].pointBackgroundColor = STAR1
    chart.data.datasets[0].pointBorderColor = '#fff'
    chart.data.datasets[1].pointBorderColor = '#fff'
    if (chart.options.scales?.x?.ticks) {
      chart.options.scales.x.ticks.color = '#374151'
    }
  }

  chart.data.datasets.forEach(ds => {
    ds.pointRadius      = Array.from({ length: n }, (_, i) => (i === hi ? 8 : i <= hi ? 4 : 0))
    ds.pointHoverRadius = Array.from({ length: n }, (_, i) => (i <= hi ? 6 : 0))
  })
  chart.update()
}

// ── Main component ────────────────────────────────────────────────────────────
export default function CATDemo() {
  const [steerTarget, setSteerTarget] = useState(null) // null until 5★ or 1★ is chosen
  const [activeTrace, setActiveTrace] = useState(null)
  const [branchTaken, setBranchTaken] = useState(false)
  const [branchFromTarget, setBranchFromTarget] = useState(null) // original path before branch switch
  const [introStage, setIntroStage]   = useState('pre') // 'pre' | 'prefix' | 'live'
  const [playTokenCount, setPlayTokenCount] = useState(0)
  const [playPaused, setPlayPaused] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [sortCol, setSortCol]         = useState('prob')
  const [sortDir, setSortDir]         = useState('desc')
  const [tokenRevealMs, setTokenRevealMs] = useState(DEFAULT_TOKEN_REVEAL_MS)

  const canvasRef      = useRef(null)
  const chartRef       = useRef(null)
  const prefixTimerRef = useRef(null)
  const prefixTimeoutsRef = useRef([])
  const prefixRunIdRef = useRef(0)

  const isPreSteer = steerTarget == null
  const traceSteps = activeTrace ?? []
  const steps = isPreSteer ? PROMPT_STEPS : traceSteps
  const hasSteps = steps.length > 0
  const star1Ready = STEPS_1STAR.length > 0
  const live = !isPreSteer && introStage === 'live' && traceSteps.length > 0
  /** Chart + table: pre-steer prompt view, or once a steer path is selected. */
  const vizActive =
    (isPreSteer && PROMPT_STEPS.length > 0) ||
    (traceSteps.length > 0 &&
      (live || introStage === 'pre' || (introStage === 'prefix' && playTokenCount > 0)))
  /** Pre-steer: fixed at last prompt token (really); no stepping through I / really. */
  const preSteerStepIndex = Math.max(0, PROMPT_STEPS.length - 1)
  const isPlayingAnim = introStage === 'prefix' && !playPaused
  const isPausedAnim = introStage === 'prefix' && playPaused
  const vizStepIndex = isPreSteer
    ? preSteerStepIndex
    : isPlayingAnim || isPausedAnim
      ? Math.max(0, playTokenCount - 1)
      : currentStep
  const step = vizActive ? steps[vizStepIndex] : null

  const chartVisibleCount = useMemo(() => {
    if (!vizActive || !hasSteps) return 0
    if (isPreSteer) return PROMPT_STEPS.length
    if (isPlayingAnim || isPausedAnim) return Math.min(steps.length, playTokenCount)
    return Math.min(steps.length, currentStep + 1)
  }, [vizActive, hasSteps, isPreSteer, isPlayingAnim, isPausedAnim, steps.length, currentStep, playTokenCount])

  const fixedPrompt = useMemo(() => getFixedSteerPromptDisplay(steps), [steps])
  const { fixedPromptTrimmed, fixedPromptTrailing } = useMemo(() => {
    const trimmed = fixedPrompt.trimEnd()
    return { fixedPromptTrimmed: trimmed, fixedPromptTrailing: fixedPrompt.slice(trimmed.length) }
  }, [fixedPrompt])

  const stepsRef = useRef(steps)
  stepsRef.current = steps
  const steerTargetRef = useRef(steerTarget)
  steerTargetRef.current = steerTarget
  const playTokenCountRef = useRef(0)
  playTokenCountRef.current = playTokenCount
  const currentStepRef = useRef(currentStep)
  currentStepRef.current = currentStep
  const introStageRef = useRef(introStage)
  introStageRef.current = introStage
  const branchTakenRef = useRef(branchTaken)
  branchTakenRef.current = branchTaken

  /** playTokenCount so viz index `stepIndex` is the active token (stepIndex is 0-based). */
  const playCountForStepIndex = stepIndex => stepIndex + 1

  const initialSteerPlayCount = (stepList, stepIndex) => {
    const steerStart = countPromptOnlySteps(stepList)
    return Math.max(playCountForStepIndex(steerStart), playCountForStepIndex(stepIndex))
  }

  const resetIntro = useCallback(() => {
    prefixRunIdRef.current += 1
    if (prefixTimerRef.current) {
      clearInterval(prefixTimerRef.current)
      prefixTimerRef.current = null
    }
    for (const tid of prefixTimeoutsRef.current) clearTimeout(tid)
    prefixTimeoutsRef.current = []
    setSteerTarget(null)
    setActiveTrace(null)
    setBranchTaken(false)
    setBranchFromTarget(null)
    setIntroStage('pre')
    setPlayTokenCount(0)
    setPlayPaused(false)
    setCurrentStep(0)
  }, [])

  const onSteerChange = next => {
    prefixRunIdRef.current += 1
    if (prefixTimerRef.current) {
      clearInterval(prefixTimerRef.current)
      prefixTimerRef.current = null
    }
    for (const tid of prefixTimeoutsRef.current) clearTimeout(tid)
    prefixTimeoutsRef.current = []
    const targetSteps = next === '5' ? STEPS_5STAR : STEPS_1STAR
    const startStep = countPromptOnlySteps(targetSteps)
    setSteerTarget(next)
    setActiveTrace(targetSteps)
    setBranchTaken(false)
    setBranchFromTarget(null)
    setIntroStage('pre')
    setCurrentStep(startStep)
    setPlayTokenCount(0)
    setPlayPaused(false)
  }

  const onBranchSwitch = () => {
    prefixRunIdRef.current += 1
    if (prefixTimerRef.current) {
      clearInterval(prefixTimerRef.current)
      prefixTimerRef.current = null
    }
    for (const tid of prefixTimeoutsRef.current) clearTimeout(tid)
    prefixTimeoutsRef.current = []
    const step = currentStepRef.current
    const branchIdx = steerTarget === '5' ? BRANCH_FROM_5_INDEX : BRANCH_FROM_1_INDEX
    const resumeStep = Math.max(step, branchIdx)
    if (steerTarget === '5') {
      setBranchFromTarget('5')
      setActiveTrace(mergeTraceAtBranch(STEPS_5STAR, STEPS_5_THEN_1, branchIdx))
      setSteerTarget('1')
    } else if (steerTarget === '1') {
      setBranchFromTarget('1')
      setActiveTrace(mergeTraceAtBranch(STEPS_1STAR, STEPS_1_THEN_5, branchIdx))
      setSteerTarget('5')
    }
    setBranchTaken(true)
    setCurrentStep(resumeStep)
    setPlayTokenCount(playCountForStepIndex(resumeStep))
    setIntroStage('pre')
    setPlayPaused(true)
  }

  // ── Chart.js during Play (per revealed token) and in live walkthrough ───
  useEffect(() => {
    if (!vizActive || !hasSteps || chartVisibleCount <= 0) {
      chartRef.current?.destroy()
      chartRef.current = null
      return
    }
    const vc = chartVisibleCount
    const idx = vizStepIndex
    let chart
    const labels = chartLabelsForSteps(steps).slice(0, vc)
    import('chart.js/auto').then(({ Chart }) => {
      if (!canvasRef.current) return
      chartRef.current?.destroy()
      chartRef.current = null
      try {
        chart = new Chart(canvasRef.current, {
          type: 'line',
          data: {
            labels,
            datasets: [
              {
                label: '5★ prob',
                data: Array(vc).fill(null),
                borderColor: STAR5,
                backgroundColor: STAR5_SOFT,
                pointBackgroundColor: STAR5,
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
                data: Array(vc).fill(null),
                borderColor: STAR1,
                backgroundColor: STAR1_SOFT,
                pointBackgroundColor: STAR1,
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
                ticks: { color: '#374151', maxRotation: 45, font: { family: 'JetBrains Mono, monospace', size: 11 } },
                grid:  { display: false },
                border: { color: '#e5e7eb' },
              },
              y: {
                min: 0, max: 1,
                ticks: { color: '#374151', font: { size: 11 }, callback: v => (v * 100).toFixed(0) + '%' },
                grid:  { display: false },
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
        applyChartStep(chart, steps, idx, vc, { preSteer: isPreSteer })
      } catch (err) {
        console.error('Chart init failed', err)
      }
    })
    return () => {
      chart?.destroy()
      if (chartRef.current === chart) chartRef.current = null
    }
  }, [vizActive, hasSteps, steps, chartVisibleCount, isPreSteer, vizStepIndex])

  // ── Update chart when step changes ─────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !vizActive || chartVisibleCount <= 0) return
    applyChartStep(chart, steps, vizStepIndex, chartVisibleCount, { preSteer: isPreSteer })
  }, [vizStepIndex, vizActive, steps, chartVisibleCount, isPreSteer])

  // ── Keyboard navigation ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'r' || e.key === 'R') {
        resetIntro()
        return
      }
      if (!hasSteps) return
      if (live) {
        if (e.key === 'ArrowRight') setCurrentStep(s => Math.min(s + 1, steps.length - 1))
        if (e.key === 'ArrowLeft') setCurrentStep(s => Math.max(s - 1, 0))
      } else if (!isPreSteer && !live && !isPlayingAnim) {
        const min = countPromptOnlySteps(steps)
        if (e.key === 'ArrowRight') {
          if (isPausedAnim) {
            setPlayTokenCount(c => {
              const n = Math.min(steps.length, c + 1)
              setCurrentStep(Math.max(0, n - 1))
              return n
            })
          } else setCurrentStep(s => Math.min(s + 1, steps.length - 1))
        }
        if (e.key === 'ArrowLeft') {
          if (isPausedAnim) {
            setPlayTokenCount(c => {
              const n = Math.max(0, c - 1)
              setCurrentStep(Math.max(0, n - 1))
              return n
            })
          } else setCurrentStep(s => Math.max(min, s - 1))
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [live, introStage, playPaused, hasSteps, isPreSteer, isPlayingAnim, isPausedAnim, steps.length, resetIntro])

  /** Auto-pause at branch overlap so the user can switch steer targets. */
  const tryPauseAtBranchPoint = useCallback((runId, count) => {
    const steer = steerTargetRef.current
    if (!steer || branchTakenRef.current) return false
    const branchIdx = steer === '5' ? BRANCH_FROM_5_INDEX : BRANCH_FROM_1_INDEX
    const hasBranch = steer === '5' ? STEPS_5_THEN_1.length > 0 : STEPS_1_THEN_5.length > 0
    if (!hasBranch || count !== branchIdx + 1) return false
    if (runId !== prefixRunIdRef.current) return true
    prefixRunIdRef.current += 1
    for (const tid of prefixTimeoutsRef.current) clearTimeout(tid)
    prefixTimeoutsRef.current = []
    setPlayTokenCount(count)
    setCurrentStep(branchIdx)
    setPlayPaused(true)
    return true
  }, [])

  const pausePlay = useCallback(() => {
    prefixRunIdRef.current += 1
    if (prefixTimerRef.current) {
      clearInterval(prefixTimerRef.current)
      prefixTimerRef.current = null
    }
    for (const tid of prefixTimeoutsRef.current) clearTimeout(tid)
    prefixTimeoutsRef.current = []
    setCurrentStep(Math.max(0, playTokenCountRef.current - 1))
    setPlayPaused(true)
  }, [])

  const resumePlay = useCallback(() => {
    prefixRunIdRef.current += 1
    const runId = prefixRunIdRef.current
    for (const tid of prefixTimeoutsRef.current) clearTimeout(tid)
    prefixTimeoutsRef.current = []

    const st = stepsRef.current
    const n = st.length
    const ms = Math.max(0, Math.min(5000, Math.round(Number(tokenRevealMs) || 0)))
    const start = steerTargetRef.current
      ? Math.max(
          playTokenCountRef.current,
          initialSteerPlayCount(st, currentStepRef.current)
        )
      : playTokenCountRef.current

    setPlayPaused(false)

    const finishToLive = () => {
      if (runId !== prefixRunIdRef.current) return
      setPlayPaused(false)
      if (!steerTargetRef.current) {
        setIntroStage('pre')
        setPlayTokenCount(0)
        return
      }
      if (n > 0) {
        setIntroStage('live')
        setCurrentStep(Math.max(0, n - 1))
        setPlayTokenCount(0)
      } else {
        setIntroStage('pre')
      }
    }

    if (start >= n) {
      finishToLive()
      return
    }

    setPlayTokenCount(start)
    let count = start
    const revealNext = () => {
      const tid = setTimeout(() => {
        if (runId !== prefixRunIdRef.current) return
        count += 1
        setPlayTokenCount(count)
        if (tryPauseAtBranchPoint(runId, count)) return
        if (count >= n) {
          finishToLive()
          return
        }
        revealNext()
      }, ms)
      prefixTimeoutsRef.current.push(tid)
    }
    revealNext()
  }, [hasSteps, tokenRevealMs, tryPauseAtBranchPoint])

  const playPrefix = useCallback(() => {
    prefixRunIdRef.current += 1
    const runId = prefixRunIdRef.current
    if (prefixTimerRef.current) {
      clearInterval(prefixTimerRef.current)
      prefixTimerRef.current = null
    }
    for (const tid of prefixTimeoutsRef.current) clearTimeout(tid)
    prefixTimeoutsRef.current = []

    const st = stepsRef.current
    const n = st.length
    const ms = Math.max(0, Math.min(5000, Math.round(Number(tokenRevealMs) || 0)))

    const finishToLive = () => {
      if (runId !== prefixRunIdRef.current) return
      setPlayPaused(false)
      if (!steerTargetRef.current) {
        setIntroStage('pre')
        setPlayTokenCount(0)
        return
      }
      if (n > 0) {
        setIntroStage('live')
        setCurrentStep(Math.max(0, n - 1))
        setPlayTokenCount(0)
      } else {
        setIntroStage('pre')
      }
    }

    if (n === 0) {
      finishToLive()
      return
    }

    const initialCount = steerTargetRef.current
      ? initialSteerPlayCount(st, currentStepRef.current)
      : 0
    setPlayPaused(false)
    setIntroStage('prefix')
    setPlayTokenCount(initialCount)

    if (initialCount >= n) {
      finishToLive()
      return
    }

    let count = initialCount
    const revealNext = () => {
      const tid = setTimeout(() => {
        if (runId !== prefixRunIdRef.current) return
        count += 1
        setPlayTokenCount(count)
        if (tryPauseAtBranchPoint(runId, count)) return
        if (count >= n) {
          finishToLive()
          return
        }
        revealNext()
      }, ms)
      prefixTimeoutsRef.current.push(tid)
    }
    revealNext()
  }, [hasSteps, tokenRevealMs, tryPauseAtBranchPoint])

  useEffect(() => () => {
    if (prefixTimerRef.current) clearInterval(prefixTimerRef.current)
    for (const tid of prefixTimeoutsRef.current) clearTimeout(tid)
  }, [])

  // ── Table sort (when chart / table are visible) ───────────────────────────
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
  const thClass  = col => `px-5 py-3 cursor-pointer select-none transition-colors hover:text-[#5278d9] ${sortCol === col ? 'text-[#648FFF]' : ''}`

  const playCommittedText =
    isPlayingAnim || isPausedAnim
      ? committedChosenDisplay(steps, playTokenCount)
      : !isPreSteer && !live
        ? committedChosenDisplay(steps, currentStep)
        : ''
  const livePriorText = live && step ? committedChosenDisplay(steps, currentStep) : ''

  const statusPaused = isPausedAnim ? ' · paused' : ''

  const nSteps = steps.length
  const steerStart = countPromptOnlySteps(traceSteps)
  const canStepForward =
    !isPreSteer &&
    hasSteps &&
    !isPlayingAnim &&
    (live
      ? currentStep < nSteps - 1
      : isPausedAnim
        ? playTokenCount < nSteps
        : currentStep < nSteps - 1)
  const canStepBack =
    !isPreSteer &&
    hasSteps &&
    !isPlayingAnim &&
    (live
      ? currentStep > 0
      : isPausedAnim
        ? playTokenCount > 0
        : currentStep > steerStart)
  const steerAccent = steerTarget === '1' ? STAR1 : STAR5
  const steerAccentBorder = steerTarget === '1' ? STAR1_BORDER : STAR5_BORDER
  const branchIndex = steerTarget === '5' ? BRANCH_FROM_5_INDEX : BRANCH_FROM_1_INDEX
  const branchReady =
    steerTarget === '5' ? STEPS_5_THEN_1.length > 0 : STEPS_1_THEN_5.length > 0
  const showBranchSwitch =
    !isPreSteer && !branchTaken && branchReady && vizStepIndex === branchIndex

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="bg-gray-50 text-gray-900 min-h-screen">
      <div className="max-w-6xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
            <h1 className="text-4xl sm:text-3xl font-extrabold tracking-tight text-gray-900 leading-[1.1] max-w-4xl">
              Conditional Attribute Transformers (CAT)
            </h1>
            <a href={ARXIV_PAPER_URL} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-[#5278d9] hover:underline shrink-0">Paper on arXiv →</a>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_min(260px,30%)] xl:grid-cols-[1fr_280px] gap-6 lg:gap-10 items-start">
            <div className="min-w-0 space-y-5">
              <div className="text-gray-900 text-sm sm:text-base w-full space-y-3 leading-relaxed">
                <p>
                  What if a language model could predict not only the next token, but also its consequences?
                  <br></br><span className="font-medium"> Conditional Attribute Transformers (CAT) jointly estimate the next token and, for each candidate next token, sequence-level outcomes enabling attribution, counterfactual comparison across next-token choices, and steering via sequential selection.</span>
                </p>
                <p>
                  In one forward pass CAT supports token-level attribution to downstream outcomes, counterfactual reasoning under alternative next tokens, and steering toward safer or better outcomes. It delivers strong results on RL and language modeling; in medical foundation models it supports interpretable dynamic risk estimation with massive speedups over sampling. Joint training can also improve plain next-token prediction.
                </p>
              </div>
            </div>

            <aside className="lg:sticky lg:top-6 shrink-0 w-full">
              <div className="rounded-lg border border-gray-200 bg-white px-5 py-4 text-sm shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-900 mb-4">Satisficing criterion</div>
                <div className="space-y-5 text-gray-900">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-900 mb-1.5">Attribute threshold</div>
                    <div className="font-mono tabular-nums text-xl font-bold tracking-tight">{ATTR_THRESHOLD}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-900 mb-1.5">Token epsilon</div>
                    <div className="font-mono tabular-nums text-xl font-bold tracking-tight">{TOKEN_EPSILON}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-900 mb-1.5">k</div>
                    <div className="font-mono tabular-nums text-xl font-bold tracking-tight">{TOP_K}</div>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>

        {/* Generated text */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 shadow-sm">
          <div className="text-xs text-gray-900 uppercase tracking-widest mb-3 font-semibold">Generated text</div>
          <div className="text-lg leading-relaxed font-mono min-h-10 text-gray-900">
            <span className="inline rounded-md bg-gray-100 px-1.5 py-0 text-gray-600 ring-1 ring-gray-200/80 align-baseline leading-snug">
              {fixedPromptTrimmed}
            </span>
            {fixedPromptTrailing}
            {playCommittedText ? <ContextText context={playCommittedText} /> : null}
            {live && step && (
              <>
                {livePriorText ? <ContextText context={livePriorText} /> : null}
                <span
                  className="inline rounded px-1.5 py-0 font-semibold leading-snug align-baseline"
                  style={{
                    background: steerTarget === '1' ? STAR1_SOFT : STAR5_SOFT,
                    color: steerTarget === '1' ? '#a33436' : '#3d5cad',
                  }}
                >
                  {renderSpecial(step.chosen_token_display)}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 mb-6 shadow-sm flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-900">Steer toward</span>
          {isPreSteer ? (
            <>
              <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm">
                <button
                  type="button"
                  onClick={() => onSteerChange('5')}
                  className="px-4 py-1.5 rounded-md text-sm font-medium transition-colors text-gray-900 hover:bg-gray-50"
                >
                  ★★★★★ 5-star
                </button>
                <button
                  type="button"
                  onClick={() => onSteerChange('1')}
                  disabled={!star1Ready}
                  title={!star1Ready ? 'Add STEPS_1STAR for the full 1★ walkthrough' : 'Steer toward 1★ reviews'}
                  className="px-4 py-1.5 rounded-md text-sm font-medium transition-colors text-gray-900 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ★☆☆☆☆ 1-star
                </button>
              </div>
              {!star1Ready && (
                <span className="text-xs text-gray-900">
                  1★ tables: plug in data in <code className="text-[11px]">lib/steps-data.js</code> (<code className="text-[11px]">STEPS_1STAR</code>).
                </span>
              )}
              <span className="text-sm text-gray-600">Choose 5★ or 1★ to start steering.</span>
            </>
          ) : (
            <>
              <span className="text-sm font-semibold tracking-tight" style={{ color: steerAccent }}>
                {branchTaken && branchFromTarget
                  ? `Steered toward ${starLabel(branchFromTarget)}, now steering to ${starLabel(steerTarget)}`
                  : `Steering toward ${starLabel(steerTarget)}`}
              </span>
              {showBranchSwitch && (
                <button
                  type="button"
                  onClick={onBranchSwitch}
                  className="px-4 py-1.5 rounded-md text-sm font-semibold text-white shadow-sm transition-colors"
                  style={{
                    background: steerTarget === '5' ? STAR1 : STAR5,
                    border: `1px solid ${steerTarget === '5' ? STAR1_BORDER : STAR5_BORDER}`,
                  }}
                >
                  Steer toward {steerTarget === '5' ? '1-Star' : '5-Star'}
                </button>
              )}
            </>
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-900 font-medium">
              <span className="whitespace-nowrap">Token delay (ms)</span>
              <input
                type="number"
                min={0}
                max={5000}
                step={50}
                value={tokenRevealMs}
                disabled={introStage === 'prefix' && !playPaused}
                onChange={e => {
                  const v = parseInt(e.target.value, 10)
                  setTokenRevealMs(Number.isFinite(v) ? Math.max(0, Math.min(5000, v)) : DEFAULT_TOKEN_REVEAL_MS)
                }}
                className="w-24 rounded-md border border-gray-300 px-2 py-1.5 font-mono text-sm tabular-nums disabled:opacity-50"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                if (isPlayingAnim) pausePlay()
                else if (isPausedAnim) resumePlay()
                else playPrefix()
              }}
              disabled={isPreSteer || (live && hasSteps)}
              className="px-4 py-2 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm disabled:opacity-35 disabled:cursor-not-allowed"
              style={{ background: '#4b5563', border: '1px solid #374151' }}
            >
              {isPlayingAnim ? '⏸ Pause' : isPausedAnim ? '▶ Resume' : '▶ Play'}
            </button>
            <button
              type="button"
              onClick={resetIntro}
              className="px-4 py-2 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg text-sm font-medium text-gray-900 transition-colors shadow-sm"
            >
              ↺ Reset
            </button>
            <button
              type="button"
              onClick={() => {
                if (live) setCurrentStep(s => Math.max(s - 1, 0))
                else if (isPausedAnim) {
                  setPlayTokenCount(c => {
                    const n = Math.max(0, c - 1)
                    setCurrentStep(Math.max(0, n - 1))
                    return n
                  })
                } else setCurrentStep(s => Math.max(steerStart, s - 1))
              }}
              disabled={!canStepBack}
              className="px-4 py-2 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg text-sm font-medium text-gray-900 transition-colors shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => {
                if (live) setCurrentStep(s => Math.min(s + 1, nSteps - 1))
                else if (isPausedAnim) {
                  setPlayTokenCount(c => {
                    const n = Math.min(nSteps, c + 1)
                    setCurrentStep(Math.max(0, n - 1))
                    return n
                  })
                } else setCurrentStep(s => Math.min(s + 1, nSteps - 1))
              }}
              disabled={!canStepForward}
              className="px-4 py-2 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ background: STAR5, border: `1px solid ${STAR5_BORDER}` }}
            >
              Next →
            </button>
          </div>
          <div className="text-sm text-gray-900 font-mono font-medium">
            {vizActive
              ? `Step ${vizStepIndex + 1} / ${steps.length}${statusPaused}`
              : introStage === 'prefix'
                ? `Playing…${statusPaused}`
                : !hasSteps
                  ? 'No trace yet'
                  : isPreSteer
                    ? 'At really · choose 5★ or 1★'
                    : 'Press Play'}
          </div>
        </div>

        {/* Chart: updates each token during Play, then follows live step */}
        {vizActive && (
          <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs text-gray-900 uppercase tracking-widest font-semibold">
                Attribute probabilities of chosen tokens
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-900 font-medium">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-full" style={{ background: STAR1 }} />
                  1★ prob
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-full" style={{ background: STAR5 }} />
                  5★ prob
                </span>
              </div>
            </div>
            <div className="relative h-[220px]">
              <canvas ref={canvasRef} />
            </div>
          </div>
        )}

        {/* Selection logic */}
        {vizActive && step && (
          <div className="rounded-lg px-4 py-2.5 mb-5 text-sm" style={{ background: '#f0f4ff', border: '1px solid #d6e2ff' }}>
            <span className="font-semibold mr-1" style={{ color: '#4566c7' }}>Selection logic:</span>
            <span className="text-gray-900">{step.explanation}</span>
          </div>
        )}

        {/* Candidate table */}
        {vizActive && step && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="text-xs text-gray-900 uppercase tracking-widest font-semibold">
                Candidate tokens at current position
              </div>
              <div className="text-xs text-gray-900">
                Click column headers to sort · Column color = attribute intensity
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-900 text-xs uppercase tracking-wide border-b border-gray-100">
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
                    const bg1    = cellBg(colNorm(row.star1, min1,    max1),    STAR1)
                    const bg5    = cellBg(colNorm(row.star5, min5,    max5),    STAR5)
                    return (
                      <tr
                        key={i}
                        className="transition-colors hover:brightness-95"
                        style={{ background: 'white', outline: isChosen ? `2px solid ${steerAccent}` : 'none', outlineOffset: '-2px' }}
                      >
                        <td className="px-5 py-2.5 font-medium font-mono text-gray-800 border-b border-gray-50">
                          <div className="flex items-center gap-2">
                            {renderSpecial(row.token)}
                            {isChosen && (
                              <span className="text-xs text-white px-1.5 py-0.5 rounded font-semibold" style={{ background: steerAccent }}>
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
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-gray-900 text-sm font-medium">
            No step data for this steer target yet.
          </div>
        )}

      </div>
    </div>
  )
}
