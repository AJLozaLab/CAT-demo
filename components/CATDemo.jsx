'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  STEPS_5STAR,
  STEPS_1STAR,
  STEPS_5_THEN_1,
  STEPS_1_THEN_5,
  STEPS_NO_STEERING,
  PROMPT_STEPS,
  BRANCH_FROM_5_INDEX,
  BRANCH_FROM_1_INDEX,
  BRANCH_SWITCH_FROM_5_INDEX,
  BRANCH_SWITCH_FROM_1_INDEX,
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
const LAST_ADDED_HIGHLIGHT = '#F4B400'
const STAR5_BORDER = '#4a72d9'
const STAR1_BORDER = '#b84a4c'

const ARXIV_PAPER_URL = 'http://arxiv.org/abs/2605.14004'

const ATTR_THRESHOLD = '0.8'
const TOKEN_EPSILON = '0.001'
const TOP_K = '20'
const TABLE_TOP_K = 20

const DEFAULT_TOKEN_REVEAL_MS = 1000

const EMPTY_TRACE = []

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

function isSpecialToken(token) {
  return /^<\|[^|]+\|>$/.test(String(token).trim())
}

function renderSpecial(token) {
  const t = token.trim()
  if (isSpecialToken(t)) return <SpecialTokenBadge token={token} />
  return <span className="whitespace-pre-wrap">{token}</span>
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

function LastAddedToken({ token }) {
  if (!token) return null
  return (
    <span
      className="inline rounded px-1.5 py-0 font-semibold leading-snug align-baseline"
      style={{ background: LAST_ADDED_HIGHLIGHT, color: '#1f2937' }}
    >
      {isSpecialToken(token) ? renderSpecial(token) : token}
    </span>
  )
}

function GeneratedTokens({ prior, last }) {
  return (
    <>
      {prior ? <ContextText context={prior} /> : null}
      <LastAddedToken token={last} />
    </>
  )
}

function SatisficingCriterionBar() {
  const items = [
    { label: 'Attribute threshold', value: ATTR_THRESHOLD },
    { label: 'Token epsilon', value: TOKEN_EPSILON },
    { label: 'k', value: TOP_K },
  ]
  return (
    <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/80">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-900 shrink-0">
          Satisficing criterion
        </span>
        {items.map(({ label, value }, i) => (
          <div key={label} className="flex items-center gap-2 text-sm">
            {i > 0 && <span className="hidden sm:inline text-gray-300" aria-hidden>|</span>}
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
            <span className="font-mono tabular-nums font-bold text-gray-900">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SelectionReasonHint({ explanation, accent }) {
  const btnRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const updatePosition = useCallback(() => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ top: r.top + r.height / 2, left: r.right + 8 })
  }, [])

  const show = useCallback(() => {
    updatePosition()
    setOpen(true)
  }, [updatePosition])

  const hide = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onScrollOrResize = () => updatePosition()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open, updatePosition])

  if (!explanation) return null

  const tooltip =
    open &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        role="tooltip"
        className="pointer-events-none fixed z-[99999] w-72 max-w-[min(18rem,calc(100vw-2rem))] -translate-y-1/2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left text-xs leading-relaxed text-gray-800 shadow-xl"
        style={{ top: pos.top, left: pos.left }}
      >
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#4566c7]">
          Selection logic
        </span>
        {explanation}
      </div>,
      document.body
    )

  return (
    <span className="inline-flex items-center">
      <button
        ref={btnRef}
        type="button"
        className="relative z-[1] inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold leading-none text-white cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
        style={{ background: accent }}
        aria-label="Show selection reasoning"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        ?
      </button>
      {tooltip}
    </span>
  )
}

function chartLabelsForSteps(steps) {
  return steps.map(s =>
    s.chosen_token.replace(/<\|([^|]+)\|>/g, '[$1]').trim() || '·'
  )
}

/** Highlight span aligned to vertical steer guides (same boundaries as chartBoundaryBefore). */
function chartAlignedSpan(chart, fromIndex, toIndexExclusive, { revealEndIndex = null } = {}) {
  const n = chart.scales.x.ticks?.length ?? 0
  const start = Math.max(0, fromIndex)
  const end = Math.min(n, toIndexExclusive)
  if (start >= end) return null
  const { left: areaLeft, right: areaRight } = chart.chartArea
  const left = start <= 0 ? areaLeft : chartBoundaryBefore(chart, start)
  let right = end >= n ? areaRight : chartBoundaryBefore(chart, end)
  if (revealEndIndex != null && revealEndIndex > start) {
    const clipEnd = Math.min(revealEndIndex, end)
    const revealRight = clipEnd >= n ? areaRight : chartBoundaryBefore(chart, clipEnd)
    right = Math.min(right, revealRight)
  }
  if (right <= left) return null
  return { left, right }
}

function fillChartRect(ctx, left, top, right, bottom, chartArea) {
  const l = Math.max(left, chartArea.left)
  const r = Math.min(right, chartArea.right)
  if (r <= l) return
  ctx.fillRect(l, top, r - l, bottom - top)
}

/** Yellow backdrop on the active x-axis tick (uses Chart.js label layout). */
function configureXTickHighlight(chart, activeIndex) {
  const ticks = chart.options.scales?.x?.ticks
  if (!ticks) return
  const isActive = ctx =>
    ctx.index === activeIndex && !!chart.data.labels?.[ctx.index]
  ticks.color = '#000000'
  ticks.padding = 10
  ticks.showLabelBackdrop = isActive
  ticks.backdropColor = ctx => (isActive(ctx) ? LAST_ADDED_HIGHLIGHT : undefined)
  ticks.backdropPadding = { top: 4, bottom: 4, left: 6, right: 6 }
}

/** X at category `index` from laid-out points (falls back to scale ticks). */
function chartStepCenterX(chart, index) {
  const el = chart.getDatasetMeta(0)?.data?.[index]
  if (el != null && Number.isFinite(el.x)) return el.x
  const x = chart.scales.x
  const n = x.ticks?.length ?? 0
  if (n === 0) return x.left
  const i = Math.max(0, Math.min(index, n - 1))
  return x.getPixelForTick(i)
}

/** Vertical guide biased toward the next token column (not centered in the gap). */
function chartBoundaryBefore(chart, index, towardNext = 0.9) {
  const { left, right } = chart.chartArea
  if (index <= 0) return left
  const n = chart.scales.x.ticks?.length ?? 0
  if (index >= n) return right
  const prevX = chartStepCenterX(chart, index - 1)
  const nextX = chartStepCenterX(chart, index)
  return prevX + (nextX - prevX) * towardNext
}

function drawChartGuideLabel(
  ctx,
  text,
  x,
  y,
  { align = 'center', color = '#4b5563', lineHeight = 12 } = {}
) {
  const lines = String(text).split('\n')
  ctx.save()
  ctx.font = GUIDE_LABEL_FONT
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'bottom'
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, y - (lines.length - 1 - i) * lineHeight)
  }
  ctx.restore()
}

function drawChartVLine(ctx, x, top, bottom, color, dashed = true) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  if (dashed) ctx.setLineDash([4, 3])
  ctx.beginPath()
  ctx.moveTo(x, top)
  ctx.lineTo(x, bottom)
  ctx.stroke()
  ctx.restore()
}

let steerChartPluginRegistered = false

const REGION_LABEL_MARGIN = 12
const REGION_LABEL_LINE_HEIGHT = 12
const REGION_LABEL_MIN_GAP = 8
/** Fixed token slots for label centering at the left edge of a region (labels do not shift on reveal). */
const REGION_LABEL_MAX_TOKENS = 5
/** Fixed plot band height; total canvas height = plot + top label pad + bottom pad. */
const CHART_PLOT_HEIGHT = 200
/** Space below plot for rotated x labels + yellow tick backdrop (Chart.js layout.padding). */
const CHART_BOTTOM_PAD = 0
/** Extra space below canvas so labels are not clipped by overflow containers. */
const CHART_WRAPPER_BOTTOM = 16
const CHART_SIDE_PAD = 6
const REGION_LABEL_BASE_MARGIN = 12

function chartRegionLabelTopPad(cfg = {}) {
  const labelBlock = 3 * REGION_LABEL_LINE_HEIGHT + REGION_LABEL_BASE_MARGIN
  return labelBlock
}

function applyChartLayoutPadding(chart, topPad) {
  if (!chart.options.layout) chart.options.layout = {}
  chart.options.layout.padding = {
    top: topPad,
    bottom: CHART_BOTTOM_PAD,
    left: CHART_SIDE_PAD,
    right: CHART_SIDE_PAD,
  }
}

function configureYAxisTicks(chart) {
  const ticks = chart.options.scales?.y?.ticks
  if (ticks) ticks.color = '#000000'
}

const GUIDE_LABEL_FONT = '600 10px var(--font-sans), Inter, system-ui, sans-serif'

function measureGuideLabel(ctx, text) {
  const lines = String(text).split('\n')
  ctx.save()
  ctx.font = GUIDE_LABEL_FONT
  let width = 0
  for (const line of lines) {
    width = Math.max(width, ctx.measureText(line).width)
  }
  ctx.restore()
  return {
    lines,
    width,
    height: lines.length * REGION_LABEL_LINE_HEIGHT,
  }
}

function labelBounds(layout) {
  const left = layout.align === 'center' ? layout.x - layout.width / 2 : layout.x
  return { left, right: left + layout.width, top: layout.y - layout.height, bottom: layout.y }
}

/** Left-anchored span for region labels (fixed index window, independent of reveal). */
function chartLabelPlacementSpan(chart, fromIndex, slotCount, maxTokens = REGION_LABEL_MAX_TOKENS) {
  const end = Math.min(fromIndex + maxTokens, slotCount)
  if (end <= fromIndex) return null
  return chartAlignedSpan(chart, fromIndex, end)
}

/** Place label in region (centered when it fits); resolve horizontal overlap by stacking upward. */
function layoutRegionLabels(ctx, plans, chartArea) {
  const baseY = chartArea.top - 6
  const layouts = plans
    .filter(p => p.range && p.text)
    .map(plan => {
      const { width, height } = measureGuideLabel(ctx, plan.text)
      const xCenter = (plan.range.left + plan.range.right) / 2
      const half = width / 2
      const x = Math.max(chartArea.left + half, Math.min(xCenter, chartArea.right - half))
      return { ...plan, width, height, x, align: 'center', y: baseY }
    })

  for (let i = 1; i < layouts.length; i++) {
    const cur = layouts[i]
    cur.y = baseY
    for (let j = 0; j < i; j++) {
      const prev = layouts[j]
      const a = labelBounds(prev)
      const b = labelBounds(cur)
      if (b.left < a.right + REGION_LABEL_MIN_GAP) {
        cur.y = Math.min(cur.y, prev.y - prev.height - REGION_LABEL_MIN_GAP)
      }
    }
  }

  for (const layout of layouts) {
    drawChartGuideLabel(ctx, layout.text, layout.x, layout.y, {
      align: layout.align,
      color: layout.color,
      lineHeight: REGION_LABEL_LINE_HEIGHT,
    })
  }
}

function drawSteerRegionGuides(chart, cfg) {
  const { ctx, chartArea } = chart
  const { top, bottom } = chartArea
  const slotCount = cfg.slotCount ?? chart.scales.x.ticks?.length ?? 0
  const labelPlans = []

  const promptLabelRange =
    cfg.promptEndIndex > 0 ? chartAlignedSpan(chart, 0, cfg.promptEndIndex) : null
  if (promptLabelRange) {
    labelPlans.push({ text: 'Prompt', range: promptLabelRange, color: '#6b7280' })
  }

  if (cfg.preSteer || cfg.promptEndIndex <= 0 || cfg.noSteering) {
    layoutRegionLabels(ctx, labelPlans, chartArea)
    return
  }

  const firstSteerTarget = cfg.firstSteerTarget ?? cfg.steerTarget
  const firstSteerColor = firstSteerTarget === '1' ? STAR1 : STAR5
  const steerX = chartBoundaryBefore(chart, cfg.promptEndIndex)
  drawChartVLine(ctx, steerX, top, bottom, firstSteerColor, true)

  if (
    cfg.branchTaken &&
    cfg.branchIndex != null &&
    cfg.branchIndex > cfg.promptEndIndex &&
    cfg.steerTarget
  ) {
    const firstSteerLabelRange = chartAlignedSpan(chart, cfg.promptEndIndex, cfg.branchIndex)
    if (firstSteerLabelRange) {
      labelPlans.push({
        text: `Steering\ntoward\n${starLabel(firstSteerTarget)}`,
        range: firstSteerLabelRange,
        color: firstSteerColor,
      })
    }
    const branchX = chartBoundaryBefore(chart, cfg.branchIndex)
    const afterColor = cfg.steerTarget === '1' ? STAR1 : STAR5
    drawChartVLine(ctx, branchX, top, bottom, afterColor, true)
    const branchLabelRange = chartLabelPlacementSpan(chart, cfg.branchIndex, slotCount)
    if (branchLabelRange) {
      labelPlans.push({
        text: `Steer back\ntoward\n${starLabel(cfg.steerTarget)}`,
        range: branchLabelRange,
        color: afterColor,
      })
    }
  } else {
    const steerLabelRange = chartLabelPlacementSpan(chart, cfg.promptEndIndex, slotCount)
    if (steerLabelRange) {
      labelPlans.push({
        text: `Steering\ntoward\n${starLabel(firstSteerTarget)}`,
        range: steerLabelRange,
        color: firstSteerColor,
      })
    }
  }

  layoutRegionLabels(ctx, labelPlans, chartArea)
}

function registerSteerChartPlugin(Chart) {
  if (steerChartPluginRegistered) return
  steerChartPluginRegistered = true
  Chart.register({
    id: 'steerRegions',
    beforeDatasetsDraw(chart) {
      const cfg = chart.options.plugins?.steerRegions
      if (!cfg?.enabled) return
      const { ctx, chartArea } = chart
      const { top, bottom } = chartArea
      const slotCount = cfg.slotCount ?? chart.scales.x.ticks?.length ?? 0
      const revealedEnd = Math.min(cfg.revealedCount ?? 0, slotCount)
      const promptRange = chartAlignedSpan(chart, 0, cfg.promptEndIndex, {
        revealEndIndex: Math.min(revealedEnd, cfg.promptEndIndex),
      })
      if (promptRange) {
        ctx.save()
        ctx.fillStyle = cfg.preSteer ? 'rgba(243, 244, 246, 0.95)' : 'rgba(243, 244, 246, 0.72)'
        fillChartRect(ctx, promptRange.left, top, promptRange.right, bottom, chartArea)
        ctx.restore()
      }
      if (cfg.preSteer || cfg.promptEndIndex <= 0 || cfg.noSteering) return
      const firstSteerTarget = cfg.firstSteerTarget ?? cfg.steerTarget
      if (
        cfg.branchTaken &&
        cfg.branchIndex != null &&
        cfg.branchIndex > cfg.promptEndIndex &&
        cfg.steerTarget
      ) {
        const firstSteerRange = chartAlignedSpan(chart, cfg.promptEndIndex, cfg.branchIndex, {
          revealEndIndex: Math.min(revealedEnd, cfg.branchIndex),
        })
        if (firstSteerRange) {
          ctx.save()
          ctx.fillStyle =
            firstSteerTarget === '1' ? 'rgba(217, 91, 93, 0.06)' : 'rgba(100, 143, 255, 0.06)'
          fillChartRect(ctx, firstSteerRange.left, top, firstSteerRange.right, bottom, chartArea)
          ctx.restore()
        }
        const branchRange = chartAlignedSpan(chart, cfg.branchIndex, slotCount, {
          revealEndIndex: revealedEnd,
        })
        if (branchRange) {
          ctx.save()
          ctx.fillStyle =
            cfg.steerTarget === '1' ? 'rgba(217, 91, 93, 0.06)' : 'rgba(100, 143, 255, 0.06)'
          fillChartRect(ctx, branchRange.left, top, branchRange.right, bottom, chartArea)
          ctx.restore()
        }
      } else if (cfg.promptEndIndex < revealedEnd) {
        const steerRange = chartAlignedSpan(chart, cfg.promptEndIndex, slotCount, {
          revealEndIndex: revealedEnd,
        })
        if (steerRange) {
          ctx.save()
          ctx.fillStyle =
            firstSteerTarget === '1' ? 'rgba(217, 91, 93, 0.06)' : 'rgba(100, 143, 255, 0.06)'
          fillChartRect(ctx, steerRange.left, top, steerRange.right, bottom, chartArea)
          ctx.restore()
        }
      }
    },
    afterDatasetsDraw(chart) {
      const cfg = chart.options.plugins?.steerRegions
      if (!cfg?.enabled) return
      drawSteerRegionGuides(chart, cfg)
    },
  })
}

function buildChartPrefixSnapshot(stepList, branchIndex) {
  if (!stepList?.length || branchIndex <= 0) return null
  const n = Math.min(branchIndex, stepList.length)
  return {
    branchIndex: n,
    labels: chartLabelsForSteps(stepList).slice(0, n),
    star5: stepList.slice(0, n).map(s => s.chosen_star5),
    star1: stepList.slice(0, n).map(s => s.chosen_star1),
  }
}

/** Concatenate steered decode tokens (skips prompt-only I / really). */
function starLabel(target) {
  return target === '5' ? '5-Star' : '1-Star'
}

/** Default table sort: ascending on the attribute being steered toward. */
function defaultTableSort(steerTarget) {
  if (steerTarget === '5') return { col: 'star5', dir: 'asc' }
  if (steerTarget === '1') return { col: 'star1', dir: 'asc' }
  return { col: 'prob', dir: 'desc' }
}

function committedChosenDisplay(steps, count) {
  if (!steps?.length || count <= 0) return ''
  return steps
    .slice(0, count)
    .filter(s => !s.prompt_only)
    .map(s => s.chosen_token_display)
    .join('')
}

function committedChosenParts(steps, count) {
  if (!steps?.length || count <= 0) return { prior: '', last: '' }
  const tokens = steps
    .slice(0, count)
    .filter(s => !s.prompt_only)
    .map(s => s.chosen_token_display)
  if (!tokens.length) return { prior: '', last: '' }
  return {
    prior: tokens.slice(0, -1).join(''),
    last: tokens[tokens.length - 1],
  }
}

function applyChartStep(
  chart,
  stepList,
  idx,
  visibleCount,
  slotCount,
  {
    preSteer = false,
    steerTarget = null,
    branchTaken = false,
    branchFromTarget = null,
    branchIndex = null,
    promptEndIndex = 0,
    prefixSnapshot = null,
    firstSteerTarget = null,
    noSteering = false,
  } = {}
) {
  const capacity = Math.max(slotCount, stepList.length)
  if (capacity === 0) return
  const hi = Math.min(Math.max(0, idx), stepList.length - 1)
  const revealed = Math.min(Math.max(0, visibleCount), stepList.length, capacity)
  const steerStartIdx = countPromptOnlySteps(stepList)
  /** No yellow highlight on prompt-only tokens (e.g. I, really) — they live in the fixed prompt. */
  const highlightIdx =
    preSteer || hi < steerStartIdx || stepList[hi]?.prompt_only ? null : hi
  const stepLabels = chartLabelsForSteps(stepList)
  const snapEnd = prefixSnapshot?.branchIndex ?? 0
  const star5 = Array(capacity).fill(null)
  const star1 = Array(capacity).fill(null)
  for (let i = 0; i < revealed; i++) {
    if (i <= hi) {
      if (prefixSnapshot && i < snapEnd) {
        star5[i] = prefixSnapshot.star5[i]
        star1[i] = prefixSnapshot.star1[i]
      } else {
        star5[i] = stepList[i].chosen_star5
        star1[i] = stepList[i].chosen_star1
      }
    }
  }
  chart.data.labels = Array.from({ length: capacity }, (_, i) => {
    if (i >= revealed) return ''
    if (prefixSnapshot && i < snapEnd) return prefixSnapshot.labels[i] ?? ''
    return stepLabels[i] ?? ''
  })
  chart.data.datasets[0].data = star5
  chart.data.datasets[1].data = star1
  const n = capacity

  const lastSegmentDash = ctx => {
    if (ctx.p1DataIndex !== hi || ctx.p0.skip || ctx.p1.skip) return undefined
    return [6, 4]
  }

  const pointStyleArrays = (fillColor, ringColor) => ({
    pointBackgroundColor: Array.from({ length: n }, (_, i) => {
      if (i > hi || i >= revealed) return fillColor
      if (i === hi) return '#ffffff'
      return fillColor
    }),
    pointBorderColor: Array.from({ length: n }, (_, i) => {
      if (i > hi || i >= revealed) return '#fff'
      if (i === hi) return ringColor
      return '#fff'
    }),
    pointBorderWidth: Array.from({ length: n }, (_, i) =>
      i === hi && i <= hi && i < revealed ? 2.5 : 1.5
    ),
  })

  if (preSteer) {
    chart.data.datasets[0].borderColor = PROMPT_CHART_GREY
    chart.data.datasets[1].borderColor = PROMPT_CHART_GREY
    chart.data.datasets[0].backgroundColor = 'transparent'
    chart.data.datasets[1].backgroundColor = 'transparent'
    Object.assign(
      chart.data.datasets[0],
      pointStyleArrays(PROMPT_CHART_GREY, PROMPT_CHART_GREY_DARK)
    )
    Object.assign(
      chart.data.datasets[1],
      pointStyleArrays(PROMPT_CHART_GREY, PROMPT_CHART_GREY_DARK)
    )
    configureXTickHighlight(chart, highlightIdx)
  } else {
    chart.data.datasets[0].borderColor = STAR5
    chart.data.datasets[1].borderColor = STAR1
    chart.data.datasets[0].backgroundColor = STAR5_SOFT
    chart.data.datasets[1].backgroundColor = STAR1_SOFT
    Object.assign(chart.data.datasets[0], pointStyleArrays(STAR5, STAR5))
    Object.assign(chart.data.datasets[1], pointStyleArrays(STAR1, STAR1))
    configureXTickHighlight(chart, highlightIdx)
  }

  chart.data.datasets.forEach(ds => {
    ds.segment = { borderDash: lastSegmentDash }
    ds.pointRadius = Array.from({ length: n }, (_, i) =>
      i > hi || i >= revealed ? 0 : i === hi ? 8 : 4
    )
    ds.pointHoverRadius = Array.from({ length: n }, (_, i) =>
      i > hi || i >= revealed ? 0 : 6
    )
  })

  chart.options.plugins.steerRegions = {
    enabled: true,
    preSteer,
    noSteering,
    promptEndIndex,
    steerTarget,
    branchTaken,
    branchFromTarget,
    branchIndex,
    firstSteerTarget,
    slotCount: n,
    revealedCount: revealed,
  }
  if (chart.options.scales?.x?.ticks) {
    chart.options.scales.x.ticks.autoSkip = false
  }

  const regionPad = chartRegionLabelTopPad({
    preSteer,
    promptEndIndex,
    steerTarget,
    branchTaken,
    branchIndex,
  })
  applyChartLayoutPadding(chart, regionPad)
  configureYAxisTicks(chart)

  chart.update('none')
}

// ── Main component ────────────────────────────────────────────────────────────
export default function CATDemo() {
  const [controlMethod, setControlMethod] = useState(null) // null | '5' | '1' | 'none'
  const [steerTarget, setSteerTarget] = useState(null) // null until 5★ or 1★ is chosen
  const [activeTrace, setActiveTrace] = useState(null)
  const [branchTaken, setBranchTaken] = useState(false)
  const [branchFromTarget, setBranchFromTarget] = useState(null) // original path before branch switch
  const [firstSteerTarget, setFirstSteerTarget] = useState(null) // locked when 5★/1★ is first chosen
  const [chartPrefixSnapshot, setChartPrefixSnapshot] = useState(null)
  const [introStage, setIntroStage]   = useState('pre') // 'pre' | 'prefix' | 'live'
  const [playTokenCount, setPlayTokenCount] = useState(0)
  const [playPaused, setPlayPaused] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [sortCol, setSortCol]         = useState('prob')
  const [sortDir, setSortDir]         = useState('desc')
  const [tokenRevealMs, setTokenRevealMs] = useState(DEFAULT_TOKEN_REVEAL_MS)

  useEffect(() => {
    const { col, dir } = defaultTableSort(steerTarget)
    setSortCol(col)
    setSortDir(dir)
  }, [steerTarget, controlMethod])

  const canvasRef      = useRef(null)
  const chartRef       = useRef(null)
  const prefixTimerRef = useRef(null)
  const prefixTimeoutsRef = useRef([])
  const prefixRunIdRef = useRef(0)

  const isPreSteer = controlMethod == null
  const noSteerReady = STEPS_NO_STEERING.length > 0
  const traceSteps = activeTrace ?? EMPTY_TRACE
  const traceKey = controlMethod ?? 'pre'
  const pathForBranchEarly =
    branchTaken && branchFromTarget ? branchFromTarget : steerTarget
  const branchIndexEarly =
    pathForBranchEarly === '5'
      ? BRANCH_FROM_5_INDEX
      : pathForBranchEarly === '1'
        ? BRANCH_FROM_1_INDEX
        : null
  const steps = useMemo(() => {
    if (isPreSteer) return PROMPT_STEPS
    if (
      branchTaken &&
      branchFromTarget &&
      branchIndexEarly != null &&
      currentStep < branchIndexEarly
    ) {
      return branchFromTarget === '5' ? STEPS_5STAR : STEPS_1STAR
    }
    return traceSteps
  }, [
    isPreSteer,
    traceSteps,
    branchTaken,
    branchFromTarget,
    branchIndexEarly,
    currentStep,
  ])
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

  const chartPromptEndIndex = countPromptOnlySteps(steps)
  const pathForBranch = branchTaken && branchFromTarget ? branchFromTarget : steerTarget
  const chartBranchIndex =
    pathForBranch === '5'
      ? BRANCH_FROM_5_INDEX
      : pathForBranch === '1'
        ? BRANCH_FROM_1_INDEX
        : null
  const isNoSteering = controlMethod === 'none'
  const chartApplyOpts = useMemo(
    () => ({
      preSteer: isPreSteer,
      noSteering: isNoSteering,
      steerTarget,
      branchTaken,
      branchFromTarget,
      branchIndex: chartBranchIndex,
      promptEndIndex: chartPromptEndIndex,
      prefixSnapshot: chartPrefixSnapshot,
      firstSteerTarget,
    }),
    [
      isPreSteer,
      isNoSteering,
      steerTarget,
      branchTaken,
      branchFromTarget,
      chartBranchIndex,
      chartPromptEndIndex,
      chartPrefixSnapshot,
      firstSteerTarget,
    ]
  )
  const chartSlotCount = useMemo(
    () =>
      Math.max(
        STEPS_5STAR.length,
        STEPS_1STAR.length,
        STEPS_NO_STEERING.length,
        PROMPT_STEPS.length
      ),
    []
  )
  const chartMinWidth = Math.max(560, chartSlotCount * 44)
  const chartTopPad = useMemo(
    () =>
      chartRegionLabelTopPad({
        preSteer: isPreSteer,
        promptEndIndex: chartPromptEndIndex,
        steerTarget,
        branchTaken,
        branchIndex: chartBranchIndex,
      }),
    [isPreSteer, chartPromptEndIndex, steerTarget, branchTaken, chartBranchIndex]
  )
  const chartTotalHeight =
    CHART_PLOT_HEIGHT + chartTopPad + CHART_BOTTOM_PAD + CHART_WRAPPER_BOTTOM

  const fixedPrompt = useMemo(
    () => getFixedSteerPromptDisplay(steps).trimEnd(),
    [steps]
  )

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

  const initialSteerPlayCount = (_stepList, stepIndex) =>
    playCountForStepIndex(stepIndex)

  const resetIntro = useCallback(() => {
    prefixRunIdRef.current += 1
    if (prefixTimerRef.current) {
      clearInterval(prefixTimerRef.current)
      prefixTimerRef.current = null
    }
    for (const tid of prefixTimeoutsRef.current) clearTimeout(tid)
    prefixTimeoutsRef.current = []
    setControlMethod(null)
    setSteerTarget(null)
    setActiveTrace(null)
    setBranchTaken(false)
    setBranchFromTarget(null)
    setFirstSteerTarget(null)
    setChartPrefixSnapshot(null)
    setIntroStage('pre')
    setPlayTokenCount(0)
    setPlayPaused(false)
    setCurrentStep(0)
  }, [])

  const clearPlaybackTimers = () => {
    prefixRunIdRef.current += 1
    if (prefixTimerRef.current) {
      clearInterval(prefixTimerRef.current)
      prefixTimerRef.current = null
    }
    for (const tid of prefixTimeoutsRef.current) clearTimeout(tid)
    prefixTimeoutsRef.current = []
  }

  const onSteerChange = next => {
    clearPlaybackTimers()
    const targetSteps = next === '5' ? STEPS_5STAR : STEPS_1STAR
    const steerStart = countPromptOnlySteps(targetSteps)
    setControlMethod(next)
    setSteerTarget(next)
    setFirstSteerTarget(next)
    setActiveTrace(targetSteps)
    setBranchTaken(false)
    setBranchFromTarget(null)
    setChartPrefixSnapshot(null)
    setIntroStage('pre')
    setCurrentStep(steerStart)
    setPlayTokenCount(0)
    setPlayPaused(false)
  }

  const onNoSteerChange = () => {
    if (!noSteerReady) return
    clearPlaybackTimers()
    const targetSteps = STEPS_NO_STEERING
    const steerStart = countPromptOnlySteps(targetSteps)
    setControlMethod('none')
    setSteerTarget(null)
    setFirstSteerTarget(null)
    setActiveTrace(targetSteps)
    setBranchTaken(false)
    setBranchFromTarget(null)
    setChartPrefixSnapshot(null)
    setIntroStage('pre')
    setCurrentStep(steerStart)
    setPlayTokenCount(0)
    setPlayPaused(false)
  }

  const branchIndexForTarget = target =>
    target === '5' ? BRANCH_FROM_5_INDEX : target === '1' ? BRANCH_FROM_1_INDEX : null
  const revertBranch = useCallback(() => {
    const origin = branchFromTarget
    if (!origin) return
    setActiveTrace(origin === '5' ? STEPS_5STAR : STEPS_1STAR)
    setSteerTarget(origin)
    setBranchTaken(false)
    setBranchFromTarget(null)
    setChartPrefixSnapshot(null)
  }, [branchFromTarget])

  const stepBack = useCallback(() => {
    const branchIdx =
      branchTaken && branchFromTarget ? branchIndexForTarget(branchFromTarget) : null

    if (live) {
      setCurrentStep(s => {
        const next = Math.max(s - 1, 0)
        if (branchIdx != null && next < branchIdx) revertBranch()
        return next
      })
      return
    }
    if (isPausedAnim) {
      setPlayTokenCount(c => {
        const n = Math.max(0, c - 1)
        const nextStep = Math.max(0, n - 1)
        if (branchIdx != null && nextStep < branchIdx) revertBranch()
        setCurrentStep(nextStep)
        return n
      })
      return
    }
    setCurrentStep(s => {
      const minStep = countPromptOnlySteps(stepsRef.current)
      const next = Math.max(minStep, s - 1)
      if (branchIdx != null && next < branchIdx) revertBranch()
      return next
    })
  }, [branchTaken, branchFromTarget, live, isPausedAnim, revertBranch])

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
    setChartPrefixSnapshot(buildChartPrefixSnapshot(stepsRef.current, branchIdx))
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
    setCurrentStep(step)
    setPlayTokenCount(playCountForStepIndex(step))
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
    const capacity = chartSlotCount
    const idx = vizStepIndex
    let chart
    import('chart.js/auto').then(({ Chart }) => {
      if (!canvasRef.current) return
      registerSteerChartPlugin(Chart)
      chartRef.current?.destroy()
      chartRef.current = null
      try {
        chart = new Chart(canvasRef.current, {
          type: 'line',
          data: {
            labels: Array(capacity).fill(''),
            datasets: [
              {
                label: '5★ prob',
                data: Array(capacity).fill(null),
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
                data: Array(capacity).fill(null),
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
            animation: false,
            layout: {
              padding: {
                top: chartTopPad,
                bottom: CHART_BOTTOM_PAD,
                left: CHART_SIDE_PAD,
                right: CHART_SIDE_PAD,
              },
            },
            scales: {
              x: {
                ticks: {
                  color: '#000000',
                  maxRotation: 45,
                  autoSkip: false,
                  padding: 10,
                  showLabelBackdrop: false,
                  backdropPadding: 6,
                  font: { family: 'JetBrains Mono, monospace', size: 11 },
                  callback(_value, index) {
                    const label = this.chart?.data?.labels?.[index]
                    return label || ''
                  },
                },
                grid:  { display: false },
                border: { color: '#e5e7eb' },
              },
              y: {
                min: 0, max: 1,
                ticks: { color: '#000000', font: { size: 11 }, callback: v => (v * 100).toFixed(0) + '%' },
                grid:  { display: false },
                border: { color: '#e5e7eb' },
              },
            },
            plugins: {
              steerRegions: { enabled: false },
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
        applyChartStep(chart, steps, idx, chartVisibleCount, chartSlotCount, chartApplyOpts)
      } catch (err) {
        console.error('Chart init failed', err)
      }
    })
    return () => {
      chart?.destroy()
      if (chartRef.current === chart) chartRef.current = null
    }
  }, [vizActive, hasSteps, steps, chartSlotCount, chartTopPad])

  // ── Update chart when step / steer mode changes ──────────────────────────────
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !vizActive || chartVisibleCount <= 0) return
    applyChartStep(chart, steps, vizStepIndex, chartVisibleCount, chartSlotCount, chartApplyOpts)
  }, [vizStepIndex, vizActive, steps, chartVisibleCount, chartSlotCount, chartApplyOpts])

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
    const switchIdx = steer === '5' ? BRANCH_SWITCH_FROM_5_INDEX : BRANCH_SWITCH_FROM_1_INDEX
    const hasBranch = steer === '5' ? STEPS_5_THEN_1.length > 0 : STEPS_1_THEN_5.length > 0
    if (!hasBranch || switchIdx == null || count !== switchIdx + 1) return false
    if (runId !== prefixRunIdRef.current) return true
    prefixRunIdRef.current += 1
    for (const tid of prefixTimeoutsRef.current) clearTimeout(tid)
    prefixTimeoutsRef.current = []
    setPlayTokenCount(count)
    setCurrentStep(switchIdx)
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
    if (!step?.table?.length) return []
    const chosen = step.chosen_token
    const sorted = step.table
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const va = a.row[sortCol]
        const vb = b.row[sortCol]
        let cmp = 0
        if (typeof va === 'string') {
          cmp = va < vb ? -1 : va > vb ? 1 : 0
        } else {
          cmp = va - vb
        }
        if (cmp === 0) cmp = a.index - b.index
        return sortDir === 'asc' ? cmp : -cmp
      })
      .map(({ row }) => row)
    if (sorted.length <= TABLE_TOP_K) return sorted
    const top = sorted.slice(0, TABLE_TOP_K)
    if (top.some(r => r.token === chosen)) return top
    const chosenRow = sorted.find(r => r.token === chosen)
    return chosenRow ? [...top.slice(0, TABLE_TOP_K - 1), chosenRow] : top
  }, [step, sortCol, sortDir])

  const handleSort = col => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir(col === 'token' ? 'asc' : 'desc') }
  }

  const sortIcon = col => sortCol !== col ? '↕' : sortDir === 'asc' ? '↑' : '↓'
  const thClass  = col => `px-5 py-3 cursor-pointer select-none transition-colors hover:text-[#5278d9] ${sortCol === col ? 'text-[#648FFF]' : ''}`

  const playCommittedCount =
    isPlayingAnim || isPausedAnim
      ? playTokenCount
      : !isPreSteer && !live
        ? currentStep + 1
        : 0
  const playCommittedParts = useMemo(
    () => committedChosenParts(steps, playCommittedCount),
    [steps, playCommittedCount]
  )
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
  const steerAccent =
    steerTarget === '1' ? STAR1 : steerTarget === '5' ? STAR5 : '#6b7280'
  const steerAccentBorder =
    steerTarget === '1' ? STAR1_BORDER : steerTarget === '5' ? STAR5_BORDER : '#9ca3af'
  const branchIndex = chartBranchIndex
  const branchReady =
    pathForBranch === '5'
      ? STEPS_5_THEN_1.length > 0
      : pathForBranch === '1'
        ? STEPS_1_THEN_5.length > 0
        : false
  const branchSwitchStep =
    pathForBranch === '5'
      ? BRANCH_SWITCH_FROM_5_INDEX
      : pathForBranch === '1'
        ? BRANCH_SWITCH_FROM_1_INDEX
        : null
  const showBranchSwitch =
    !isPreSteer &&
    !branchTaken &&
    branchReady &&
    branchSwitchStep != null &&
    vizStepIndex === branchSwitchStep &&
    !steps[vizStepIndex]?.prompt_only

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="bg-gray-50 text-gray-900 min-h-screen flex flex-col">
      <div className="flex-1 max-w-6xl mx-auto px-6 py-10 w-full">

        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
            <h1 className="text-4xl sm:text-3xl font-extrabold tracking-tight text-gray-900 leading-[1.1]">
              Conditional Attribute Transformers (CAT)
            </h1>
            <a href={ARXIV_PAPER_URL} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-[#5278d9] hover:underline shrink-0">Paper on arXiv →</a>
          </div>

          <div className="text-gray-900 text-xs sm:text-sm w-full space-y-3 leading-relaxed">
            <p>
                  What if a language model could predict not only the next token, but also its consequences?
                </p>
            <p>
                  We introduce <span className='font-bold'>Conditional Attribute Transformers</span>, which jointly estimate the next token and, for each possible next token choice, sequence-level properties or outcomes.
                </p>
            <p>
                  This gives generative models three key capabilities in a single forward pass: (1) token-level attribution to downstream outcomes, (2) counterfactual reasoning about how an outcome would change under alternative next token choices, and (3) steering toward safer or more optimal outcomes through sequential next token selection.
                </p>
            <p>
                  We show that Conditional Attribute Transformers achieve <span className='font-bold'>state-of-the-art performance</span> in reinforcement learning tasks and language modeling. In medical foundation models, they enable dynamic, interpretable risk estimation for downstream clinical outcomes and elucidate the tokens that drive risk, while achieving a <span className='font-bold'>10<sup>8</sup>× speedup over traditional sampling-based approaches</span>. As an additional benefit, we find that this joint task <span className='font-bold'>improves next-token prediction</span> in baseline language models.
                </p>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-300">
            <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 shadow-sm text-gray-900 text-xs sm:text-sm leading-relaxed space-y-3">
              <div className="text-xs text-gray-900 uppercase tracking-widest mb-3 font-semibold">How to use</div>
              <p>
                The demo below shows how Conditional Attribute Transformers steer a language model toward 1★ or 5★ reviews and sample from next-token and attribute distributions. This is not a live demo — it uses precomputed trajectories you can step through.
              </p>
              <ol className="list-decimal list-inside space-y-2 pl-0.5">
                <li>
                  <span className="font-semibold">Choose a trajectory:</span> No steering, Steer to 1★, or Steer to 5★.
                </li>
                <li>
                  Use <span className="font-semibold">Next</span> to step through the trajectory one token at a time.
                </li>
                <li>
                  Look at the graph to see how the probabilities change over time.
                </li>
                <li>
                  Scroll down to the table to inspect the generated token, candidate next tokens, next-token probabilities, and attribute probabilities at each step.
                </li>
                <li>
                  Sort the table by next-token probability or by 1★ / 5★ likelihood to compare how steering changes the model's predictions.
                </li>
                <li>
                  At the end, select <span className="font-semibold">Reset</span> to explore a different trajectory.
                </li>
              </ol>
            </div>
          </div>
        </div>

        {/* Generated text */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6 shadow-sm">
          <div className="text-xs text-gray-900 uppercase tracking-widest mb-3 font-semibold">Generated text</div>
          <div className="text-lg leading-relaxed font-mono min-h-10 text-gray-900">
            <span className="inline rounded-md bg-gray-100 px-1.5 py-0 text-gray-600 ring-1 ring-gray-200/80 align-baseline leading-snug">
              {fixedPrompt}
            </span>
            {playCommittedParts.last ? (
              <GeneratedTokens prior={playCommittedParts.prior} last={playCommittedParts.last} />
            ) : null}
            {live && step && (
              <>
                {livePriorText ? <ContextText context={livePriorText} /> : null}
                {step.prompt_only ? (
                  <ContextText context={step.chosen_token_display} />
                ) : (
                  <LastAddedToken token={step.chosen_token_display} />
                )}
              </>
            )}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl px-5 py-4 mb-6 shadow-sm space-y-3">
          <p className="text-sm text-gray-900 leading-relaxed">
            <span className="font-semibold">Control:</span>{' '}
            {controlMethod == null ? (
              <>
                Choose 1★, 5★, or no steering to explore next-token and attribute probabilities.
                {!star1Ready && (
                  <>
                    {' '}
                    (1★ data: add <code className="text-[11px]">STEPS_1STAR</code> in{' '}
                    <code className="text-[11px]">lib/steps-data.js</code>.)
                  </>
                )}
              </>
            ) : controlMethod === 'none' ? (
              'No steering — tokens sampled from the next-token distribution without attribute steering.'
            ) : branchTaken && branchFromTarget ? (
              <>
                Steered toward {starLabel(branchFromTarget)}, now steering to{' '}
                <span style={{ color: steerAccent }}>{starLabel(steerTarget)}</span>.
              </>
            ) : (
              <>
                Steering toward <span style={{ color: steerAccent }}>{starLabel(steerTarget)}</span>.
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onSteerChange('1')}
                disabled={!star1Ready}
                title={!star1Ready ? 'Add STEPS_1STAR for the full 1★ walkthrough' : 'Steer toward 1★ reviews'}
                className={`px-4 py-1.5 rounded-lg border text-sm font-medium transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed ${
                  steerTarget === '1'
                    ? 'font-semibold text-white'
                    : 'border-gray-200 bg-white text-gray-900 hover:bg-gray-50'
                }`}
                style={
                  steerTarget === '1'
                    ? { background: STAR1, borderColor: STAR1_BORDER }
                    : undefined
                }
              >
                ★☆☆☆☆ 1-star
              </button>
              <button
                type="button"
                onClick={() => onSteerChange('5')}
                className={`px-4 py-1.5 rounded-lg border text-sm font-medium transition-colors shadow-sm ${
                  steerTarget === '5'
                    ? 'font-semibold text-white'
                    : 'border-gray-200 bg-white text-gray-900 hover:bg-gray-50'
                }`}
                style={
                  steerTarget === '5'
                    ? { background: STAR5, borderColor: STAR5_BORDER }
                    : undefined
                }
              >
                ★★★★★ 5-star
              </button>
              <button
                type="button"
                onClick={onNoSteerChange}
                disabled={!noSteerReady}
                title={!noSteerReady ? 'Add STEPS_NO_STEERING in lib/steps-data.js' : 'Sample without attribute steering'}
                className={`px-4 py-1.5 rounded-lg border text-sm font-medium transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed ${
                  controlMethod === 'none'
                    ? 'border-gray-400 bg-gray-100 text-gray-900 font-semibold'
                    : 'border-gray-200 bg-white text-gray-900 hover:bg-gray-50'
                }`}
              >
                No steering
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex shrink-0 items-center gap-2">
                {showBranchSwitch && (
                  <button
                    type="button"
                    onClick={onBranchSwitch}
                    className="absolute right-full top-1/2 z-10 mr-2 -translate-y-1/2 whitespace-nowrap px-4 py-1.5 rounded-md text-sm font-semibold text-white shadow-sm transition-colors"
                    style={{
                      background: steerTarget === '5' ? STAR1 : STAR5,
                      border: `1px solid ${steerTarget === '5' ? STAR1_BORDER : STAR5_BORDER}`,
                    }}
                  >
                    Steer back toward {steerTarget === '5' ? starLabel('1') : starLabel('5')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={resetIntro}
                  className="px-4 py-2 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg text-sm font-medium text-gray-900 transition-colors shadow-sm"
                >
                  ↺ Reset
                </button>
                <button
                  type="button"
                  onClick={stepBack}
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
              <span className="text-sm text-gray-900 font-mono font-medium shrink-0 ml-1">
              {vizActive
                ? `Step ${vizStepIndex + 1} / ${steps.length}${statusPaused}`
                : introStage === 'prefix'
                  ? `Playing…${statusPaused}`
                  : !hasSteps
                    ? 'No trace yet'
                    : controlMethod == null
                      ? 'At really · choose a control method'
                      : controlMethod === 'none'
                        ? 'No steering · use ← / → to step'
                        : 'Use ← / → to step'}
              </span>
            </div>
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
            <div
              className="relative overflow-x-auto overflow-y-visible"
              style={{
                height: chartTotalHeight,
                paddingBottom: CHART_WRAPPER_BOTTOM,
              }}
            >
              <div className="h-full" style={{ minWidth: chartMinWidth }}>
                <canvas ref={canvasRef} />
              </div>
            </div>
          </div>
        )}

        {/* Candidate table */}
        {vizActive && step && (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-visible">
            <SatisficingCriterionBar />
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="text-xs text-gray-900 uppercase tracking-widest font-semibold">
                Candidate tokens at current position
              </div>
              <div className="text-xs text-gray-900">
                Click column headers to sort · Column color = attribute intensity
              </div>
            </div>
            <div className="overflow-x-auto rounded-b-xl">
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
                    const isChosen = row.token === step.chosen_token
                    const bgProb = cellBg(colNorm(row.prob,  minProb, maxProb), YELLOW)
                    const bg1    = cellBg(colNorm(row.star1, min1,    max1),    STAR1)
                    const bg5    = cellBg(colNorm(row.star5, min5,    max5),    STAR5)
                    return (
                      <tr
                        key={`${row.token}-${i}`}
                        className="transition-colors hover:brightness-95"
                        style={{ background: 'white', outline: isChosen ? `2px solid ${steerAccent}` : 'none', outlineOffset: '-2px' }}
                      >
                        <td className="relative px-5 py-2.5 font-medium font-mono text-gray-800 border-b border-gray-50">
                          <div className="flex items-center gap-2">
                            {renderSpecial(row.token)}
                            {isChosen ? (
                              <span className="inline-flex items-center gap-2 shrink-0">
                                <span className="text-xs text-white px-1.5 py-0.5 rounded font-semibold" style={{ background: steerAccent }}>
                                  chosen
                                </span>
                                <SelectionReasonHint explanation={step.explanation} accent={steerAccent} />
                              </span>
                            ) : null}
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

      <footer className="border-t border-gray-200 bg-white/60">
        <div className="max-w-6xl mx-auto px-6 py-5 text-center text-sm text-gray-600 gap-10 flex items-center justify-center">
          <a
            href="https://lozalab.org"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[#5278d9] hover:underline"
          >
            Loza Lab
          </a>
          |
          <a
            href={ARXIV_PAPER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[#5278d9] hover:underline"
          >
            Paper on arXiv
          </a>
          |
          <a
            href="https://medicine.yale.edu/biomedical-informatics-data-science/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[#5278d9] hover:underline"
          >
            Yale BIDS
          </a>
        </div>
      </footer>
    </div>
  )
}
