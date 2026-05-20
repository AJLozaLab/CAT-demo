import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const DEFAULT_PROMPT_PREFIX = '<|sos|><|phones|><|sotitle|>Review<|sotext|>'
const DEMO_PROMPT = '[sos] I really'
const CHART_PREFIX_LABELS = ['I', 'really']
/** Match demo satisficing k — keep only top candidates per step in generated data. */
const TABLE_TOP_K = 50

function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i++
      } else inQuotes = !inQuotes
    } else if (c === ',' && !inQuotes) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

function detectPromptPrefix(dir) {
  const text = fs.readFileSync(path.join(dir, 'summary.csv'), 'utf8')
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return DEFAULT_PROMPT_PREFIX
  const [csv] = parseCsvLine(lines[1])
  const base = csv.replace(/\.csv$/i, '')
  const marker = base.match(/^(<\|sos\|><\|[^|]+\|><\|sotitle\|>Review<\|sotext\|>)/)
  return marker ? marker[1] : DEFAULT_PROMPT_PREFIX
}

function readSummary(dir, starKey) {
  const text = fs.readFileSync(path.join(dir, 'summary.csv'), 'utf8')
  const lines = text.trim().split(/\r?\n/)
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const [csv, token, explanation] = parseCsvLine(lines[i])
    if (!csv) continue
    const exp = (explanation || '').trim()
    const tok = (token || '').trim()
    if (exp === 'prompt') continue
    rows.push({ csvFile: csv.trim(), token: tok, explanation: exp })
  }
  return rows
}

function isPromptOnlyRow(row) {
  return row.explanation === '' && CHART_PREFIX_LABELS.includes(row.token)
}

const STAR_MARKERS = ['5_then_1', '1_then_5', '5', '1']

function normalizeChosenTokenFromFilename(token) {
  if (/^\.+$/.test(token)) return '.'
  return token
}

function tokenFromFilename(csvFile, starKey, promptPrefix) {
  const base = csvFile.replace(/\.csv$/i, '')
  const keys = [starKey, ...STAR_MARKERS.filter(k => k !== starKey)]
  for (const key of keys) {
    const marker = `_${key}_`
    const idx = base.lastIndexOf(marker)
    if (idx === -1) continue
    const chosenToken = normalizeChosenTokenFromFilename(base.slice(idx + marker.length))
    let context = base.slice(0, idx)
    if (context.startsWith(promptPrefix)) context = context.slice(promptPrefix.length)
    return { chosenToken, context, markerKey: key }
  }
  return { chosenToken: '', context: '', markerKey: starKey }
}

function listStepCsvFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.csv') && f !== 'summary.csv' && !f.includes('.ipynb_checkpoints'))
}

function contextLenForFile(csvPath, starKey, promptPrefix) {
  const { context } = tokenFromFilename(path.basename(csvPath), starKey, promptPrefix)
  return context.length
}

function resolveCsvPathWithMarker(dir, csvFile, starKey, token, promptPrefix) {
  const exact = path.join(dir, csvFile)
  if (fs.existsSync(exact)) return exact

  const marker = `_${starKey}_`
  const files = listStepCsvFiles(dir)
  const norm = t => t.trim()
  const target = norm(token)

  const byToken = files.filter(f => {
    const base = f.replace(/\.csv$/i, '')
    const idx = base.lastIndexOf(marker)
    if (idx === -1) return false
    const fileToken = base.slice(idx + marker.length)
    return fileToken === token || norm(fileToken) === target
  })

  if (byToken.length === 1) return path.join(dir, byToken[0])

  if (byToken.length > 1) {
    const summaryBase = csvFile.replace(/\.csv$/i, '')
    const summaryIdx = summaryBase.lastIndexOf(marker)
    const summarySuffix = summaryIdx === -1 ? '' : summaryBase.slice(summaryIdx)
    const suffixMatch = byToken.find(f => f.replace(/\.csv$/i, '').endsWith(summarySuffix))
    if (suffixMatch) return path.join(dir, suffixMatch)

    let bestPath = path.join(dir, byToken[0])
    let bestLen = contextLenForFile(bestPath, starKey, promptPrefix)
    for (const f of byToken) {
      const candidate = path.join(dir, f)
      const len = contextLenForFile(candidate, starKey, promptPrefix)
      if (len < bestLen) {
        bestLen = len
        bestPath = candidate
      }
    }
    return bestPath
  }

  return null
}

/** Resolve summary csv name to an on-disk file (handles phones vs appliances prefix drift). */
function resolveCsvPath(dir, csvFile, starKey, token, promptPrefix) {
  const direct = resolveCsvPathWithMarker(dir, csvFile, starKey, token, promptPrefix)
  if (direct) return direct
  if (starKey.includes('then')) {
    const fallback = resolveCsvPathWithMarker(dir, csvFile, '5', token, promptPrefix)
    if (fallback) return fallback
  }
  return null
}

const normToken = t => t.trim()

/** Among exact/trim-equivalent token rows, pick the one with highest next-token prob. */
function pickChosenRow(table, chosenToken) {
  if (!table?.length || chosenToken == null) return null
  const target = normToken(chosenToken)
  const candidates = table.filter(
    r => r.token === chosenToken || normToken(r.token) === target
  )
  if (!candidates.length) return null
  return candidates.reduce((best, row) => (row.prob > best.prob ? row : best))
}

function readStepTable(csvPath) {
  const text = fs.readFileSync(csvPath, 'utf8')
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const table = []
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i])
    if (cols.length < 4) continue
    const token = cols[0]
    const prob = parseFloat(cols[1])
    const star1 = parseFloat(cols[2])
    const star5 = parseFloat(cols[3])
    if (!Number.isFinite(prob)) continue
    table.push({
      token,
      prob,
      star1: Number.isFinite(star1) ? star1 : 0,
      star5: Number.isFinite(star5) ? star5 : 0,
    })
  }
  return table
}

function trimTableForDemo(table, chosenToken, topK = TABLE_TOP_K) {
  if (!table.length) return table
  const byProb = [...table].sort((a, b) => b.prob - a.prob)
  const kept = []
  const seen = new Set()
  for (const row of byProb) {
    if (kept.length >= topK) break
    if (seen.has(row.token)) continue
    seen.add(row.token)
    kept.push(row)
  }
  const chosenRow = pickChosenRow(table, chosenToken)
  if (chosenRow && !seen.has(chosenRow.token)) kept.push(chosenRow)
  return kept.sort((a, b) => b.prob - a.prob)
}

function displayForChosen(chosenToken, context) {
  if (!chosenToken) return ''
  if (chosenToken.startsWith(' ') || /^[<.,!?;:]/.test(chosenToken)) return chosenToken
  const needsSpace = context.length > 0 && !/\s$/.test(context)
  return needsSpace ? ` ${chosenToken}` : chosenToken
}

function buildSteps(dir, starKey) {
  const promptPrefix = detectPromptPrefix(dir)
  const summary = readSummary(dir, starKey)
  const steps = []
  for (const row of summary) {
    const csvPath = resolveCsvPath(dir, row.csvFile, starKey, row.token, promptPrefix)
    if (!csvPath) {
      console.warn('Missing:', path.join(dir, row.csvFile))
      continue
    }
    if (path.basename(csvPath) !== row.csvFile) {
      console.log(`  resolved ${row.csvFile} → ${path.basename(csvPath)}`)
    }
    let { chosenToken, context } = tokenFromFilename(path.basename(csvPath), starKey, promptPrefix)
    if (!chosenToken.trim()) chosenToken = row.token
    const fullTable = readStepTable(csvPath)
    const chosenRow = pickChosenRow(fullTable, chosenToken) ?? fullTable[0]
    if (!chosenRow) continue
    let chosen_token = chosenRow.token
    if (/^\.+$/.test(chosen_token.trim())) chosen_token = '.'
    const table = trimTableForDemo(fullTable, chosen_token)
    const promptOnly = isPromptOnlyRow(row)
    if (fullTable.length > table.length) {
      console.log(
        `  trimmed ${row.csvFile}: ${fullTable.length} → ${table.length} rows`
      )
    }
    steps.push({
      chosen_token,
      chosen_token_display: displayForChosen(chosenRow.token.trim() === chosenToken ? chosenRow.token : chosenToken, context),
      context,
      explanation: promptOnly
        ? 'Next-token probabilities before attribute steering begins.'
        : row.explanation,
      prompt_only: promptOnly,
      table,
      chosen_star1: chosenRow.star1,
      chosen_star5: chosenRow.star5,
    })
  }
  if (steps.length) steps[0].fixed_prompt_display = DEMO_PROMPT
  return steps
}

/**
 * Build branch trace: shared main-path prefix (through last matching steered token, e.g. recommend)
 * then the 1★/5★ alternate suffix from tempdata.
 */
function buildBranchSteps(mainSteps, dir, starKey) {
  const branchBody = buildSteps(dir, starKey)
  if (!mainSteps?.length || !branchBody.length) return branchBody
  const mainSkip = countPromptOnlySteps(mainSteps)
  let prefixEnd = findBranchIndex(mainSteps, branchBody)
  if (prefixEnd <= mainSkip) prefixEnd = Math.min(mainSkip + 1, mainSteps.length)
  const branchStart = branchTailStartIndex(branchBody, starKey)
  return [...mainSteps.slice(0, prefixEnd), ...branchBody.slice(branchStart)]
}

function emitSteps(name, steps) {
  return `export const ${name} = ${JSON.stringify(steps, null, 0)};\n`
}

function stepsMatchAtBranch(mainStep, branchStep) {
  if (!mainStep || !branchStep) return false
  if (mainStep.chosen_token === branchStep.chosen_token) return true
  if (mainStep.chosen_token.trim() === branchStep.chosen_token.trim()) return true
  if (
    (mainStep.chosen_token_display || '').trim() ===
    (branchStep.chosen_token_display || '').trim()
  ) {
    return true
  }
  return false
}

function countPromptOnlySteps(steps) {
  if (!steps?.length) return 0
  let n = 0
  for (const s of steps) {
    if (s.prompt_only) n++
    else break
  }
  return n
}

/** First main-path index where steered decode diverges from the branch trace. */
function findBranchIndex(mainSteps, branchSteps) {
  const mainSkip = countPromptOnlySteps(mainSteps)
  const branchSkip = countPromptOnlySteps(branchSteps)
  const alignShift = mainSkip - branchSkip
  for (let i = mainSkip; i < mainSteps.length; i++) {
    const j = i - alignShift
    if (j < branchSkip || j >= branchSteps.length) return i
    if (!stepsMatchAtBranch(mainSteps[i], branchSteps[j])) return i
  }
  return mainSteps.length
}

function branchTailStartIndex(branchSteps, starKey) {
  const towardTag = starKey.includes('5_then_1') ? '1-star' : '5-star'
  const byExplanation = branchSteps.findIndex(
    s => !s.prompt_only && (s.explanation || '').includes(towardTag)
  )
  if (byExplanation >= 0) return byExplanation
  const fallbackToken = starKey.includes('5_then_1') ? 'a' : 'dryer'
  const byToken = branchSteps.findIndex(
    s => !s.prompt_only && (s.chosen_token_display || '').trim() === fallbackToken
  )
  if (byToken >= 0) return byToken
  return countPromptOnlySteps(branchSteps)
}

function mergeTraceAtBranch(mainSteps, branchSteps, branchIndex) {
  const alignShift = countPromptOnlySteps(mainSteps) - countPromptOnlySteps(branchSteps)
  const branchStart = Math.max(0, branchIndex - alignShift)
  return [...mainSteps.slice(0, branchIndex), ...branchSteps.slice(branchStart)]
}

/** Main-path step where the branch button should appear (last shared token before the fork). */
function branchSwitchStepIndex(mainSteps, branchIndex) {
  if (branchIndex == null || !mainSteps?.length) return null
  const steerStart = countPromptOnlySteps(mainSteps)
  if (branchIndex <= steerStart) return branchIndex
  return branchIndex - 1
}

const steer5 = buildSteps(path.join(root, 'tempdata/steer_to_5'), '5')
const steer1 = buildSteps(path.join(root, 'tempdata/steer_to_1'), '1')
const steer5then1 = buildBranchSteps(
  steer5,
  path.join(root, 'tempdata/steer_to_5_then_1'),
  '5_then_1'
)
const steer1then5 = buildBranchSteps(
  steer1,
  path.join(root, 'tempdata/steer_to_1_then_5'),
  '1_then_5'
)
const promptFrom5 = steer5.filter(s => s.prompt_only)
const promptFrom1 = steer1.filter(s => s.prompt_only)
const promptSteps = promptFrom1.length >= promptFrom5.length ? promptFrom1 : promptFrom5
if (promptSteps.length) promptSteps[0].fixed_prompt_display = DEMO_PROMPT

const noSteeringBody = buildSteps(path.join(root, 'tempdata/no_steering'), '5_then_1').filter(
  s => s.prompt_only || (s.chosen_token || '').trim()
)
const noSteering = [...promptSteps, ...noSteeringBody]
if (noSteering.length) noSteering[0].fixed_prompt_display = DEMO_PROMPT

const branchFrom5Index = findBranchIndex(steer5, steer5then1)
const branchFrom1Index = findBranchIndex(steer1, steer1then5)
const branchSwitchFrom5Index = branchSwitchStepIndex(steer5, branchFrom5Index)
const branchSwitchFrom1Index = branchSwitchStepIndex(steer1, branchFrom1Index)

const out = `/** Generated by scripts/build-steps-data.mjs from tempdata/ */\n\n${emitSteps('PROMPT_STEPS', promptSteps)}${emitSteps('STEPS_5STAR', steer5)}${emitSteps('STEPS_1STAR', steer1)}${emitSteps('STEPS_5_THEN_1', steer5then1)}${emitSteps('STEPS_1_THEN_5', steer1then5)}${emitSteps('STEPS_NO_STEERING', noSteering)}export const STEPS = STEPS_5STAR;\n\n/** First main-path step index where the branch trace diverges (fork token, e.g. "this" vs "a"). */\nexport const BRANCH_FROM_5_INDEX = ${branchFrom5Index};\n\n/** Main-path step index where the 5★→1★ switch button is shown (last shared token before the fork). */\nexport const BRANCH_SWITCH_FROM_5_INDEX = ${branchSwitchFrom5Index};\n\n/** First main-path step index where the branch trace diverges. */\nexport const BRANCH_FROM_1_INDEX = ${branchFrom1Index};\n\n/** Main-path step index where the 1★→5★ switch button is shown. */\nexport const BRANCH_SWITCH_FROM_1_INDEX = ${branchSwitchFrom1Index};\n\n/** Labels for prompt-only steps (I, really) on the chart. */\nexport const CHART_PREFIX_LABELS = ${JSON.stringify(CHART_PREFIX_LABELS)};\n\n/** Shown in grey before steered decode; generation is appended after this. Override with \`fixed_prompt_display\` on \`steps[0]\`. */\nexport const FIXED_STEER_PROMPT_DISPLAY = '${DEMO_PROMPT}';\n\nexport function getFixedSteerPromptDisplay(steps) {\n  if (steps?.length && typeof steps[0].fixed_prompt_display === 'string')\n    return steps[0].fixed_prompt_display;\n  return FIXED_STEER_PROMPT_DISPLAY;\n}\n\nexport function countPromptOnlySteps(steps) {\n  if (!steps?.length) return 0;\n  let n = 0;\n  for (const s of steps) {\n    if (s.prompt_only) n++;\n    else break;\n  }\n  return n;\n}\n\nexport function branchSwitchStepIndex(mainSteps, branchIndex) {\n  if (branchIndex == null || !mainSteps?.length) return null;\n  const steerStart = countPromptOnlySteps(mainSteps);\n  if (branchIndex <= steerStart) return branchIndex;\n  return branchIndex - 1;\n}\n\nexport function mergeTraceAtBranch(mainSteps, branchSteps, branchIndex) {\n  const alignShift = countPromptOnlySteps(mainSteps) - countPromptOnlySteps(branchSteps);\n  const branchStart = Math.max(0, branchIndex - alignShift);\n  return [...mainSteps.slice(0, branchIndex), ...branchSteps.slice(branchStart)];\n}\n`

fs.writeFileSync(path.join(root, 'lib/steps-data.js'), out)
console.log(`STEPS_5STAR: ${steer5.length} steps`)
console.log(`STEPS_1STAR: ${steer1.length} steps`)
console.log(`STEPS_5_THEN_1: ${steer5then1.length} steps (branch from 5★ @ ${branchFrom5Index})`)
console.log(`STEPS_1_THEN_5: ${steer1then5.length} steps (branch from 1★ @ ${branchFrom1Index})`)
console.log(`STEPS_NO_STEERING: ${noSteering.length} steps`)
