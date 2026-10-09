// Guards an approved action while it's carried out (see executeAction in src/main/engine.ts).
// Claude Code runs this as a PreToolUse hook just before the tool call, under NateBot's own
// executable in Node mode: `approval-guard.cjs <approved.json>`, the call on stdin. It lets
// through exactly one call of the approved tool whose inputs agree with what the user
// approved, and blocks anything else (exit 2, the reason on stderr and in <approved>.denied).
'use strict'
const fs = require('node:fs')

/** A value as compared: case, spacing and the spacing around commas don't count. */
function norm(v) {
  const flat = (x) => (x !== null && typeof x === 'object' ? JSON.stringify(x) : String(x))
  const s = Array.isArray(v) ? v.map(flat).join(',') : flat(v)
  return s.toLowerCase().replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim()
}

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)

/**
 * The first approved detail the tool's input contradicts ("to", "event.start"), or null.
 * Details the tool doesn't take under that name (descriptions, notes) can't be compared and are skipped.
 */
function mismatch(approved, input, path = '') {
  if (!isObject(approved) || !isObject(input)) return null
  const keys = Object.keys(input)
  for (const [k, v] of Object.entries(approved)) {
    if (v === null || v === undefined) continue
    const key = keys.includes(k) ? k : keys.find((x) => x.toLowerCase() === k.toLowerCase())
    if (key === undefined) continue
    const got = input[key]
    if (isObject(v) && isObject(got)) {
      const inner = mismatch(v, got, `${path}${k}.`)
      if (inner) return inner
    } else if (norm(v) !== norm(got)) {
      return `${path}${k}`
    }
  }
  return null
}

/** Why this call must not run, or null to let it through (and count it as the one call). */
function check(file, call) {
  const { tool, details } = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (call.tool_name !== tool) return `only ${tool} was approved.`
  if (fs.existsSync(`${file}.used`)) return 'it was already carried out once.'
  const wrong = mismatch(details, call.tool_input)
  if (wrong) return `"${wrong}" isn't what you approved.`
  fs.writeFileSync(`${file}.used`, '')
  return null
}

function main(file, stdin) {
  let reason
  try {
    reason = check(file, JSON.parse(stdin))
  } catch (e) {
    // Fail closed: a call NateBot can't check doesn't run.
    reason = `NateBot couldn't check this call (${e.message}).`
  }
  if (reason === null) return 0
  try {
    fs.writeFileSync(`${file}.denied`, reason)
  } catch {
    // The reason still goes to stderr.
  }
  process.stderr.write(`Blocked by NateBot: ${reason} Don't try again; reply with ✗ and this reason.\n`)
  return 2
}

if (require.main === module) {
  let stdin = ''
  try {
    stdin = fs.readFileSync(0, 'utf8')
  } catch {
    // Empty input fails the check below.
  }
  process.exit(main(process.argv[2], stdin))
}

module.exports = { norm, mismatch, main }
