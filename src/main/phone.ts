// Messages from your phone: NateBot listens on a private ntfy topic ("<your topic>-in")
// and passes what you send to an agent ("@planner move gym to 8", or your most recent
// agent). Replies come back through the usual phone notifications. Off by default; the
// topic name is the only key, and agents still can't do anything irreversible without
// your approval in NateBot.

/** "@planner move gym to 8" → { agent: "planner", text: "move gym to 8" } (agent matched by the caller). */
export function parsePhoneMessage(raw: string): { agent: string | null; text: string } {
  const m = /^@(\S+)\s+([\s\S]+)$/.exec(raw.trim())
  return m ? { agent: (m[1] ?? '').toLowerCase(), text: (m[2] ?? '').trim() } : { agent: null, text: raw.trim() }
}

export class PhoneInbox {
  private abort: AbortController | null = null
  private retry: NodeJS.Timeout | undefined
  private topic: string | null = null
  private lastId: string | null = null
  private backoff = 5_000

  constructor(
    private onMessage: (text: string) => void,
    private log: (line: string) => void
  ) {}

  /** Starts, switches or stops listening (null stops). */
  listen(topic: string | null): void {
    if (topic === this.topic) return
    this.stop()
    this.topic = topic
    this.lastId = null
    if (topic) void this.connect()
  }

  stop(): void {
    this.topic = null
    this.abort?.abort()
    this.abort = null
    clearTimeout(this.retry)
  }

  private async connect(): Promise<void> {
    const topic = this.topic
    if (!topic) return
    const abort = new AbortController()
    this.abort = abort
    // Only messages from now on (or after the last one seen), never a backlog from before NateBot started.
    const since = this.lastId ?? String(Math.floor(Date.now() / 1000))
    try {
      const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}/json?since=${encodeURIComponent(since)}`, { signal: abort.signal })
      if (!res.ok || !res.body) throw new Error(`ntfy returned ${res.status}`)
      this.backoff = 5_000
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl)
          buf = buf.slice(nl + 1)
          try {
            const ev = JSON.parse(line) as { event?: string; id?: string; message?: string }
            if (ev.event !== 'message' || !ev.message) continue
            if (ev.id) this.lastId = ev.id
            this.onMessage(ev.message.slice(0, 4000))
          } catch {
            // keepalive or partial line
          }
        }
      }
    } catch (e) {
      if (abort.signal.aborted) return
      this.log(`phone inbox: ${(e as Error).message}`)
    }
    if (this.topic !== topic || abort.signal.aborted) return
    // The stream ends now and then (or the network drops): reconnect, backing off up to 5 minutes.
    this.retry = setTimeout(() => void this.connect(), this.backoff)
    this.backoff = Math.min(this.backoff * 2, 5 * 60_000)
  }
}
