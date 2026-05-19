import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const DEFAULT_PROMPT_PREFIX = '<|sos|><|phones|><|sotitle|>Review<|sotext|>'
const DEMO_PROMPT = '[sos] I really '
const CHART_PREFIX_LABELS = ['I', 'really']
/** Match demo satisficing k — keep only top candidates per step in generated data. */
const TABLE_TOP_K = 20

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

function tokenFromFilename(csvFile, starKey, promptPrefix) {
  const base = csvFile.replace(/\.csv$/i, '')
  const marker = `_${starKey}_`
  const idx = base.lastIndexOf(marker)
  if (idx === -1) return { chosenToken: '', context: '' }
  const chosenToken = base.slice(idx + marker.length)
  let context = base.slice(0, idx)
  if (context.startsWith(promptPrefix)) context = context.slice(promptPrefix.length)
  return { chosenToken, context }
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
  const norm = t => t.trim()
  const target = norm(chosenToken)
  const byProb = [...table].sort((a, b) => b.prob - a.prob)
  const kept = []
  const seen = new Set()
  for (const row of byProb) {
    if (kept.length >= topK) break
    if (seen.has(row.token)) continue
    seen.add(row.token)
    kept.push(row)
  }
  const chosenRow =
    table.find(r => r.token === chosenToken) ||
    table.find(r => norm(r.token) === target)
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
    const csvPath = path.join(dir, row.csvFile)
    if (!fs.existsSync(csvPath)) {
      console.warn('Missing:', csvPath)
      continue
    }
    const { chosenToken, context } = tokenFromFilename(row.csvFile, starKey, promptPrefix)
    const fullTable = readStepTable(csvPath)
    const norm = t => t.trim()
    const chosenRow =
      fullTable.find(r => r.token === chosenToken) ||
      fullTable.find(r => norm(r.token) === norm(chosenToken)) ||
      fullTable[0]
    if (!chosenRow) continue
    const chosen_token = chosenRow.token
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

function emitSteps(name, steps) {
  return `export const ${name} = ${JSON.stringify(steps, null, 0)};\n`
}

/** First step index where main and branch traces diverge (shared prefix ends). */
function findBranchIndex(mainSteps, branchSteps) {
  const n = Math.min(mainSteps.length, branchSteps.length)
  for (let i = 0; i < n; i++) {
    if (mainSteps[i].chosen_token !== branchSteps[i].chosen_token) return i
  }
  return n
}

const steer5 = buildSteps(path.join(root, 'tempdata/steer_to_5'), '5')
const steer1 = buildSteps(path.join(root, 'tempdata/steer_to_1'), '1')
const steer5then1 = buildSteps(path.join(root, 'tempdata/steer_to_5_then_1'), '5_then_1')
const steer1then5 = buildSteps(path.join(root, 'tempdata/steer_to_1_then_5'), '1_then_5')
const noSteering = buildSteps(path.join(root, 'tempdata/no_steering'), '5_then_1')
const branchFrom5Index = findBranchIndex(steer5, steer5then1)
const branchFrom1Index = findBranchIndex(steer1, steer1then5)
const promptFrom5 = steer5.filter(s => s.prompt_only)
const promptFrom1 = steer1.filter(s => s.prompt_only)
const promptSteps = promptFrom1.length >= promptFrom5.length ? promptFrom1 : promptFrom5
if (promptSteps.length) promptSteps[0].fixed_prompt_display = DEMO_PROMPT

const out = `/** Generated by scripts/build-steps-data.mjs from tempdata/ */\n\n${emitSteps('PROMPT_STEPS', promptSteps)}${emitSteps('STEPS_5STAR', steer5)}${emitSteps('STEPS_1STAR', steer1)}${emitSteps('STEPS_5_THEN_1', steer5then1)}${emitSteps('STEPS_1_THEN_5', steer1then5)}${emitSteps('STEPS_NO_STEERING', noSteering)}export const STEPS = STEPS_5STAR;\n\n/** Step index where 5★ main path meets the steer_to_5_then_1 overlap (e.g. "but"). */\nexport const BRANCH_FROM_5_INDEX = ${branchFrom5Index};\n\n/** Step index where 1★ main path meets the steer_to_1_then_5 overlap (e.g. "at"). */\nexport const BRANCH_FROM_1_INDEX = ${branchFrom1Index};\n\n/** Labels for prompt-only steps (I, really) on the chart. */\nexport const CHART_PREFIX_LABELS = ${JSON.stringify(CHART_PREFIX_LABELS)};\n\n/** Shown in grey before steered decode; generation is appended after this. Override with \`fixed_prompt_display\` on \`steps[0]\`. */\nexport const FIXED_STEER_PROMPT_DISPLAY = '${DEMO_PROMPT}';\n\nexport function getFixedSteerPromptDisplay(steps) {\n  if (steps?.length && typeof steps[0].fixed_prompt_display === 'string')\n    return steps[0].fixed_prompt_display;\n  return FIXED_STEER_PROMPT_DISPLAY;\n}\n\nexport function countPromptOnlySteps(steps) {\n  if (!steps?.length) return 0;\n  let n = 0;\n  for (const s of steps) {\n    if (s.prompt_only) n++;\n    else break;\n  }\n  return n;\n}\n\nexport function mergeTraceAtBranch(mainSteps, branchSteps, branchIndex) {\n  return [...mainSteps.slice(0, branchIndex), ...branchSteps.slice(branchIndex)];\n}\n`

fs.writeFileSync(path.join(root, 'lib/steps-data.js'), out)
console.log(`STEPS_5STAR: ${steer5.length} steps`)
console.log(`STEPS_1STAR: ${steer1.length} steps`)
console.log(`STEPS_5_THEN_1: ${steer5then1.length} steps (branch from 5★ @ ${branchFrom5Index})`)
console.log(`STEPS_1_THEN_5: ${steer1then5.length} steps (branch from 1★ @ ${branchFrom1Index})`)
console.log(`STEPS_NO_STEERING: ${noSteering.length} steps`)
