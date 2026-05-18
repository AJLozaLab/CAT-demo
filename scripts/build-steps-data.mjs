import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const DEFAULT_PROMPT_PREFIX = '<|sos|><|phones|><|sotitle|>Review<|sotext|>'
const DEMO_PROMPT = '[sos] I really '
const CHART_PREFIX_LABELS = ['I', 'really']

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
    const table = readStepTable(csvPath)
    const norm = t => t.trim()
    const chosenRow =
      table.find(r => norm(r.token) === norm(chosenToken)) ||
      table.find(r => r.token === chosenToken) ||
      table[0]
    if (!chosenRow) continue
    const chosen_token = chosenRow.token.trim() === chosenToken.trim()
      ? chosenRow.token.trim()
      : chosenToken
    const promptOnly = isPromptOnlyRow(row)
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

const steer5 = buildSteps(path.join(root, 'tempdata/steer_to_5'), '5')
const steer1 = buildSteps(path.join(root, 'tempdata/steer_to_1'), '1')
const promptFrom5 = steer5.filter(s => s.prompt_only)
const promptFrom1 = steer1.filter(s => s.prompt_only)
const promptSteps = promptFrom1.length >= promptFrom5.length ? promptFrom1 : promptFrom5
if (promptSteps.length) promptSteps[0].fixed_prompt_display = DEMO_PROMPT

const out = `/** Generated by scripts/build-steps-data.mjs from tempdata/steer_to_5 and tempdata/steer_to_1 */\n\n${emitSteps('PROMPT_STEPS', promptSteps)}${emitSteps('STEPS_5STAR', steer5)}${emitSteps('STEPS_1STAR', steer1)}export const STEPS = STEPS_5STAR;\n\n/** Labels for prompt-only steps (I, really) on the chart. */\nexport const CHART_PREFIX_LABELS = ${JSON.stringify(CHART_PREFIX_LABELS)};\n\n/** Shown in grey before steered decode; generation is appended after this. Override with \`fixed_prompt_display\` on \`steps[0]\`. */\nexport const FIXED_STEER_PROMPT_DISPLAY = '${DEMO_PROMPT}';\n\nexport function getFixedSteerPromptDisplay(steps) {\n  if (steps?.length && typeof steps[0].fixed_prompt_display === 'string')\n    return steps[0].fixed_prompt_display;\n  return FIXED_STEER_PROMPT_DISPLAY;\n}\n\nexport function countPromptOnlySteps(steps) {\n  if (!steps?.length) return 0;\n  let n = 0;\n  for (const s of steps) {\n    if (s.prompt_only) n++;\n    else break;\n  }\n  return n;\n}\n`

fs.writeFileSync(path.join(root, 'lib/steps-data.js'), out)
console.log(`STEPS_5STAR: ${steer5.length} steps`)
console.log(`STEPS_1STAR: ${steer1.length} steps`)
