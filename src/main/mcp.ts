// MCP servers are defined once in ~/NateBot/mcp.json. Each run gets a temp
// config containing only the servers that agent is assigned, and claude is
// started with --strict-mcp-config so nothing else leaks in.
//
// NateBot-specific keys on a server entry (stripped before claude sees them):
//   description       shown in the app
//   agent_notes       added to the system prompt of agents using the server
//   require_approval  tool names that are blocked in normal runs and only
//                     usable through the approval flow
import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentConfig, McpServerInfo } from '@shared/types'
import { MCP_FILE, TMP_DIR } from './paths'

export type ServerEntry = Record<string, unknown>

const NATEBOT_KEYS = ['description', 'agent_notes', 'require_approval']

/** Servers we know about and hint at even before they're configured. */
const SUGGESTED: Record<string, string> = {
  gmail: 'Read, search and draft Gmail',
  gcal: 'Read Google Calendar and find free time',
  gtasks: 'Read Google Tasks; changes need approval',
  gdrive: 'Search and read Google Drive and Docs'
}

const TEMPLATE = {
  mcpServers: {},
  _help:
    'Add MCP servers under "mcpServers" using the same format as Claude Code (command/args/env, or type/url). ' +
    'NateBot extras: "description", "agent_notes", "require_approval" (tool names only usable via Approve). See the README.'
}

export function ensureMcpFile(): void {
  if (!existsSync(MCP_FILE)) writeFileSync(MCP_FILE, JSON.stringify(TEMPLATE, null, 2) + '\n', { mode: 0o600 })
}

function readFile(): { mcpServers: Record<string, ServerEntry> } & Record<string, unknown> {
  try {
    const raw = JSON.parse(readFileSync(MCP_FILE, 'utf8')) as Record<string, unknown>
    const servers = raw['mcpServers']
    return { ...raw, mcpServers: servers && typeof servers === 'object' ? (servers as Record<string, ServerEntry>) : {} }
  } catch (e) {
    console.warn(`[mcp] could not read ${MCP_FILE}: ${(e as Error).message}`)
    return { mcpServers: {} }
  }
}

export function loadServers(): Record<string, ServerEntry> {
  return readFile().mcpServers
}

/** Adds or replaces one server entry. The file can hold secrets, so it stays owner-only. */
export function saveServer(name: string, entry: ServerEntry): void {
  const file = readFile()
  file.mcpServers[name] = entry
  writeFileSync(MCP_FILE, JSON.stringify(file, null, 2) + '\n', { mode: 0o600 })
  chmodSync(MCP_FILE, 0o600)
}

export function listServers(): McpServerInfo[] {
  const servers = loadServers()
  const out: McpServerInfo[] = Object.entries(servers).map(([name, entry]) => ({
    name,
    configured: true,
    description: typeof entry['description'] === 'string' ? entry['description'] : SUGGESTED[name]
  }))
  for (const [name, description] of Object.entries(SUGGESTED)) {
    if (!(name in servers)) out.push({ name, configured: false, description })
  }
  return out
}

/** The assigned servers that actually exist in mcp.json. */
export function configuredServersFor(agent: AgentConfig): string[] {
  const servers = loadServers()
  return agent.mcp_servers.filter((n) => n in servers)
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** Full tool names (mcp__server__tool) that need approval for this agent's servers. */
export function approvalOnlyTools(agent: AgentConfig): string[] {
  const servers = loadServers()
  return agent.mcp_servers.flatMap((name) => strings(servers[name]?.['require_approval']).map((t) => `mcp__${name}__${t}`))
}

/** Extra system-prompt lines from the agent's servers (e.g. which Gmail address to use). */
export function agentNotes(agent: AgentConfig): string[] {
  const servers = loadServers()
  return agent.mcp_servers.flatMap((name) => {
    const note = servers[name]?.['agent_notes']
    return typeof note === 'string' && note.trim() ? [`${name}: ${note.trim()}`] : []
  })
}

/**
 * Writes a per-run MCP config with only this agent's servers. The file can
 * contain credentials from mcp.json, so it is owner-only and deleted after use.
 */
export function writeRunConfig(
  agent: AgentConfig,
  skip: string[] = []
): { path: string; servers: string[]; cleanup: () => void } {
  const servers = loadServers()
  const subset: Record<string, ServerEntry> = {}
  for (const name of agent.mcp_servers) {
    const entry = servers[name]
    if (!entry || skip.includes(name)) continue
    subset[name] = Object.fromEntries(Object.entries(entry).filter(([k]) => !NATEBOT_KEYS.includes(k)))
  }
  mkdirSync(TMP_DIR, { recursive: true, mode: 0o700 })
  const path = join(TMP_DIR, `mcp-${agent.id}-${randomUUID()}.json`)
  writeFileSync(path, JSON.stringify({ mcpServers: subset }), { mode: 0o600 })
  return {
    path,
    servers: Object.keys(subset),
    cleanup: () => rmSync(path, { force: true })
  }
}
