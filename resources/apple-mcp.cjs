// NateBot's Apple Reminders & Notes connector: a tiny MCP server (JSON-RPC over
// stdio, newline-delimited) that talks to Reminders and Notes on this Mac through
// osascript (JavaScript for Automation). Run by NateBot's own executable with
// ELECTRON_RUN_AS_NODE=1, so it needs nothing installed. Data from tools is passed
// to scripts as arguments, never pasted into script text.
'use strict'
const { execFile } = require('node:child_process')
const readline = require('node:readline')

const TIMEOUT_MS = 60_000

/** Runs a JXA script whose run(argv) gets one JSON argument; resolves with its JSON result. */
function jxa(source, input) {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', source, JSON.stringify(input ?? {})],
      { timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = String(stderr || err.message)
          if (/-1743|not authori[sz]ed|not allowed/i.test(msg)) {
            reject(new Error('NateBot is not allowed to control this app. Allow it in System Settings → Privacy & Security → Automation → NateBot.'))
          } else reject(new Error(msg.trim().slice(0, 400)))
          return
        }
        try {
          resolve(JSON.parse(stdout || 'null'))
        } catch {
          resolve(stdout.trim())
        }
      }
    )
  })
}

const short = (s, n) => (typeof s === 'string' && s.length > n ? `${s.slice(0, n - 1)}…` : s || '')

const SCRIPTS = {
  list_reminder_lists: `function run(argv) {
    const app = Application('Reminders')
    return JSON.stringify(app.lists().map((l) => ({ name: l.name(), open: l.reminders.whose({ completed: false })().length })))
  }`,
  list_reminders: `function run(argv) {
    const a = JSON.parse(argv[0])
    const app = Application('Reminders')
    const lists = a.list ? app.lists.whose({ name: a.list })() : app.lists()
    const out = []
    for (const l of lists) {
      const items = a.include_completed ? l.reminders() : l.reminders.whose({ completed: false })()
      for (const r of items) {
        if (out.length >= a.limit) break
        const due = r.dueDate()
        out.push({ id: r.id(), title: r.name(), list: l.name(), due: due ? due.toISOString() : null, completed: r.completed(), notes: (r.body() || '').slice(0, 200) })
      }
    }
    return JSON.stringify(out)
  }`,
  create_reminder: `function run(argv) {
    const a = JSON.parse(argv[0])
    const app = Application('Reminders')
    const list = a.list ? app.lists.whose({ name: a.list })()[0] : app.defaultList()
    if (!list) throw new Error('No reminder list called ' + a.list)
    const props = { name: a.title }
    if (a.notes) props.body = a.notes
    if (a.due) props.dueDate = new Date(a.due)
    const r = app.Reminder(props)
    list.reminders.push(r)
    return JSON.stringify({ id: r.id(), title: r.name(), list: list.name() })
  }`,
  complete_reminder: `function run(argv) {
    const a = JSON.parse(argv[0])
    const app = Application('Reminders')
    const r = app.reminders.byId(a.id)
    r.completed = true
    return JSON.stringify({ id: a.id, title: r.name(), completed: true })
  }`,
  search_notes: `function run(argv) {
    const a = JSON.parse(argv[0])
    const app = Application('Notes')
    const q = (a.query || '').toLowerCase()
    const out = []
    for (const n of app.notes()) {
      if (out.length >= a.limit) break
      const name = n.name()
      const text = q ? n.plaintext() : ''
      if (q && !name.toLowerCase().includes(q) && !text.toLowerCase().includes(q)) continue
      out.push({ id: n.id(), title: name, modified: n.modificationDate().toISOString(), preview: (text || n.plaintext()).slice(0, 160) })
    }
    return JSON.stringify(out)
  }`,
  read_note: `function run(argv) {
    const a = JSON.parse(argv[0])
    const n = Application('Notes').notes.byId(a.id)
    return JSON.stringify({ id: a.id, title: n.name(), modified: n.modificationDate().toISOString(), text: n.plaintext().slice(0, 20000) })
  }`,
  create_note: `function run(argv) {
    const a = JSON.parse(argv[0])
    const app = Application('Notes')
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const html = '<h1>' + esc(a.title) + '</h1>' + esc(a.body || '').split('\\n').map((l) => '<div>' + (l || '<br>') + '</div>').join('')
    const folder = a.folder ? app.folders.whose({ name: a.folder })()[0] : app.defaultAccount().defaultFolder()
    if (!folder) throw new Error('No Notes folder called ' + a.folder)
    const n = app.Note({ body: html })
    folder.notes.push(n)
    return JSON.stringify({ id: n.id(), title: a.title })
  }`
}

const str = (description) => ({ type: 'string', description })
const TOOLS = [
  { name: 'list_reminder_lists', description: 'List the Apple Reminders lists and how many open reminders each has.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'list_reminders',
    description: 'List open reminders (all lists, or one list). Due dates are ISO times.',
    inputSchema: { type: 'object', properties: { list: str('Reminders list name (optional)'), include_completed: { type: 'boolean' }, limit: { type: 'number', description: 'Default 50' } } }
  },
  {
    name: 'create_reminder',
    description: 'Create an Apple reminder (syncs to the user\'s iPhone). Needs the user\'s approval.',
    inputSchema: {
      type: 'object',
      properties: { title: str('What to be reminded of'), due: str('Local time like 2026-10-05T09:00 (optional)'), list: str('List name (optional, default list otherwise)'), notes: str('Extra details (optional)') },
      required: ['title']
    }
  },
  { name: 'complete_reminder', description: 'Mark a reminder done. Needs the user\'s approval.', inputSchema: { type: 'object', properties: { id: str('Reminder id from list_reminders') }, required: ['id'] } },
  {
    name: 'search_notes',
    description: 'Search Apple Notes by title and text (or list recent notes with no query).',
    inputSchema: { type: 'object', properties: { query: str('Words to look for (optional)'), limit: { type: 'number', description: 'Default 10' } } }
  },
  { name: 'read_note', description: 'Read one Apple note as plain text.', inputSchema: { type: 'object', properties: { id: str('Note id from search_notes') }, required: ['id'] } },
  {
    name: 'create_note',
    description: 'Create an Apple note. Needs the user\'s approval.',
    inputSchema: { type: 'object', properties: { title: str('Note title'), body: str('Note text'), folder: str('Folder name (optional)') }, required: ['title'] }
  }
]

/** Checks and fills in a tool's arguments before they reach a script. */
function argsFor(name, a) {
  const args = a && typeof a === 'object' ? a : {}
  const limit = (d, max) => Math.max(1, Math.min(max, Number.isFinite(args.limit) ? Math.floor(args.limit) : d))
  switch (name) {
    case 'list_reminders':
      return { list: args.list ? String(args.list) : null, include_completed: args.include_completed === true, limit: limit(50, 200) }
    case 'create_reminder': {
      if (!args.title) throw new Error('title is required')
      if (args.due && Number.isNaN(new Date(String(args.due)).getTime())) throw new Error('due must be a time like 2026-10-05T09:00')
      return { title: short(String(args.title), 300), due: args.due ? String(args.due) : null, list: args.list ? String(args.list) : null, notes: args.notes ? short(String(args.notes), 2000) : null }
    }
    case 'complete_reminder':
    case 'read_note':
      if (!args.id) throw new Error('id is required')
      return { id: String(args.id) }
    case 'search_notes':
      return { query: args.query ? String(args.query) : '', limit: limit(10, 50) }
    case 'create_note':
      if (!args.title) throw new Error('title is required')
      return { title: short(String(args.title), 200), body: args.body ? short(String(args.body), 20000) : '', folder: args.folder ? String(args.folder) : null }
    default:
      return {}
  }
}

async function callTool(name, args) {
  if (!SCRIPTS[name]) return { content: [{ type: 'text', text: `Unknown tool ${name}` }], isError: true }
  try {
    const result = await jxa(SCRIPTS[name], argsFor(name, args))
    return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 1) }] }
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true }
  }
}

function reply(id, result, error) {
  process.stdout.write(JSON.stringify(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result }) + '\n')
}

async function handle(msg) {
  const { id, method, params } = msg
  if (id === undefined || id === null) return // a notification
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: (params && params.protocolVersion) || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'natebot-apple', version: '1.0.0' }
      })
    case 'ping':
      return reply(id, {})
    case 'tools/list':
      return reply(id, { tools: TOOLS })
    case 'tools/call':
      return reply(id, await callTool(params && params.name, params && params.arguments))
    default:
      return reply(id, undefined, { code: -32601, message: `Method not found: ${method}` })
  }
}

if (require.main === module) {
  const rl = readline.createInterface({ input: process.stdin })
  rl.on('line', (line) => {
    if (!line.trim()) return
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    handle(msg).catch((e) => reply(msg.id, undefined, { code: -32603, message: String(e && e.message) }))
  })
  rl.on('close', () => process.exit(0))
}

module.exports = { TOOLS, argsFor, handle, SCRIPTS }
