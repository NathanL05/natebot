import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/** Everything NateBot stores lives under ~/NateBot (human-readable, easy to back up). */
export const ROOT = join(homedir(), 'NateBot')
export const AGENTS_DIR = join(ROOT, 'agents')
export const WORKSPACES_DIR = join(ROOT, 'workspaces')
export const MCP_FILE = join(ROOT, 'mcp.json')
export const DB_FILE = join(ROOT, 'data.db')
export const SETTINGS_FILE = join(ROOT, 'settings.json')

/** Per-run MCP configs are written here and deleted after each run. */
export const TMP_DIR = join(tmpdir(), 'natebot')

export const workspaceOf = (agentId: string): string => join(WORKSPACES_DIR, agentId)
