// Sharing agents as files (.natebot.json), like a template: what the agent does, never what
// it knows about you. Memory, chat, read folders, extra tool permissions and Always allow
// rules stay behind, and an imported agent's routines, triggers and page watches start off.
import type { AgentConfig, AgentDraft } from '@shared/types'
import { normalize } from './agents'

const FORMAT = 'natebot-agent'
const VERSION = 1

/** The shareable file for an agent. */
export function shareFile(a: AgentConfig): string {
  const agent = {
    name: a.name,
    shape: a.shape,
    color: a.color,
    model: a.model,
    effort: a.effort,
    instructions: a.instructions,
    mcp_servers: a.mcp_servers,
    // Only restrictions travel: a shared file must never grant tools.
    disallowed_tools: a.disallowed_tools,
    quick_prompts: a.quick_prompts,
    routines: a.routines,
    email_triggers: a.email_triggers,
    web_watches: a.web_watches ?? []
  }
  return `${JSON.stringify({ format: FORMAT, version: VERSION, agent }, null, 2)}\n`
}

/** A new-agent draft from a shared file's contents. Throws with a readable reason if it isn't one. */
export function draftFromShare(text: string): AgentDraft {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error("That file isn't a NateBot agent (it isn't valid JSON).")
  }
  const file = raw as { format?: unknown; version?: unknown; agent?: unknown }
  if (!file || file.format !== FORMAT || !file.agent || typeof file.agent !== 'object') throw new Error("That file isn't a NateBot agent.")
  if (typeof file.version !== 'number' || file.version > VERSION) throw new Error('That agent was shared from a newer NateBot. Update NateBot first.')
  const a = normalize(file.agent, 'imported')
  return {
    name: a.name === 'imported' ? 'Imported agent' : a.name,
    shape: a.shape,
    color: a.color,
    model: a.model,
    effort: a.effort,
    instructions: a.instructions,
    mcp_servers: a.mcp_servers,
    allowed_tools: [],
    disallowed_tools: a.disallowed_tools,
    quick_prompts: a.quick_prompts,
    // Nothing runs on its own until you've looked at it and turned it on.
    routines: a.routines.map((r) => ({ ...r, enabled: false })),
    email_triggers: a.email_triggers.map((t) => ({ ...t, enabled: false })),
    web_watches: (a.web_watches ?? []).map((w) => ({ ...w, enabled: false })),
    read_folders: [],
    auto_approve: []
  }
}
