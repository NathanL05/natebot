// natebot:// links: natebot://capture?text=…&agent=… pre-fills the quick-capture box.

const MAX_TEXT = 8000

/** The text and agent a natebot:// link asks for, or null if it isn't one NateBot understands. */
export function parseShareLink(url: string): { text?: string; agent?: string } | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'natebot:') return null
  const action = (u.hostname || u.pathname.replace(/^\/+/, '')).toLowerCase()
  if (action !== 'capture' && action !== 'share') return null
  const text = (u.searchParams.get('text') ?? '').trim().slice(0, MAX_TEXT)
  const agent = (u.searchParams.get('agent') ?? '').trim().toLowerCase().slice(0, 64)
  return { ...(text ? { text } : {}), ...(/^[a-z0-9-]+$/.test(agent) ? { agent } : {}) }
}
