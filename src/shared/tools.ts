// Friendly names for tools, shared by the chat (tool lines, action cards) and notifications.

const SERVER_NAMES: Record<string, string> = {
  gmail: 'Gmail',
  gcal: 'Calendar',
  gdrive: 'Drive',
  github: 'GitHub',
  slack: 'Slack',
  notion: 'Notion'
}

const BUILTIN_NAMES: Record<string, string> = {
  WebSearch: 'Web search',
  WebFetch: 'Read web page',
  Read: 'Read file',
  Write: 'Write file',
  Edit: 'Edit file',
  Bash: 'Run command',
  Glob: 'Find files',
  Grep: 'Search files',
  TodoWrite: 'Update checklist'
}

/** "mcp__gmail__search_threads" → { source: "Gmail", action: "search_threads" } */
export function describeTool(name: string): { source: string; action: string | null } {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name)
  if (mcp) {
    const server = mcp[1] ?? ''
    const pretty = SERVER_NAMES[server] ?? server.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    return { source: pretty, action: mcp[2] ?? null }
  }
  return { source: BUILTIN_NAMES[name] ?? name, action: null }
}
