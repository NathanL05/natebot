// MCP servers are defined once in ~/NateBot/mcp.json. Each run gets a temp
// config containing only the servers that agent is assigned, and claude is
// started with --strict-mcp-config so nothing else leaks in.
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentConfig, McpServerInfo } from '@shared/types'
import { MCP_FILE, TMP_DIR } from './paths'

type ServerEntry = Record<string, unknown>

/** Servers we know about and hint at even before they're configured. */
const SUGGESTED: Record<string, string> = {
  gmail: 'Read, search and draft Gmail'
}

const TEMPLATE = {
  mcpServers: {},
  _help:
    'Add MCP servers under "mcpServers" using the same format as Claude Code (command/args/env, or type/url). ' +
    'Optional "description" is shown in NateBot. See the README section "Adding MCP servers".'
}

export function ensureMcpFile(): void {
  if (!existsSync(MCP_FILE)) writeFileSync(MCP_FILE, JSON.stringify(TEMPLATE, null, 2) + '\n')
}

export function loadServers(): Record<string, ServerEntry> {
  try {
    const raw = JSON.parse(readFileSync(MCP_FILE, 'utf8')) as { mcpServers?: Record<string, ServerEntry> }
    const servers = raw.mcpServers
    return servers && typeof servers === 'object' ? servers : {}
  } catch (e) {
    console.warn(`[mcp] could not read ${MCP_FILE}: ${(e as Error).message}`)
    return {}
  }
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

/**
 * Writes a per-run MCP config with only this agent's servers. The file can
 * contain credentials from mcp.json, so it is owner-only and deleted after use.
 */
export function writeRunConfig(agent: AgentConfig): { path: string; servers: string[]; cleanup: () => void } {
  const servers = loadServers()
  const subset: Record<string, ServerEntry> = {}
  for (const name of agent.mcp_servers) {
    const entry = servers[name]
    if (!entry) continue
    const { description: _description, ...rest } = entry
    subset[name] = rest
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
