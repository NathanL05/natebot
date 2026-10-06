// Direct Google API access with a Connect sign-in's token file, for things NateBot
// shows or checks itself (no Claude run): the email-trigger watcher and Today's agenda.
// Access tokens are refreshed in memory only; the file is never rewritten.
import { readFileSync } from 'node:fs'

/** A Google call that hangs must not stall the trigger watcher or the Today screen for good. */
const TIMEOUT_MS = 30_000

interface TokenFile {
  token?: string
  expiry?: string
  refresh_token?: string
  client_id?: string
  client_secret?: string
  token_uri?: string
}

export class GoogleToken {
  private access: { token: string; until: number } | null = null

  constructor(
    private path: () => string | null,
    /** The sign-in at this token file can no longer be refreshed (expired or revoked). */
    private onExpired: (path: string) => void = () => undefined
  ) {}

  /** Whether a sign-in exists at all. */
  available(): boolean {
    return this.path() !== null
  }

  async get(): Promise<string> {
    if (this.access && this.access.until > Date.now() + 60_000) return this.access.token
    const path = this.path()
    if (!path) throw new Error('not connected')
    const f = JSON.parse(readFileSync(path, 'utf8')) as TokenFile
    const expiry = f.expiry ? Date.parse(/Z|[+-]\d\d:?\d\d$/.test(f.expiry) ? f.expiry : `${f.expiry}Z`) : 0
    if (f.token && expiry > Date.now() + 60_000) {
      this.access = { token: f.token, until: expiry }
      return f.token
    }
    if (!f.refresh_token || !f.client_id || !f.client_secret) throw new Error('the sign-in has no refresh token; reconnect it')
    const res = await fetch(f.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: new URLSearchParams({ client_id: f.client_id, client_secret: f.client_secret, refresh_token: f.refresh_token, grant_type: 'refresh_token' })
    })
    if (!res.ok) {
      // Only invalid_grant means the refresh token itself is dead (Google expires it after 7 days
      // while the OAuth app is in Testing). Other errors may be passing, so keep the sign-in.
      const error = await res.json().then((b) => (b as { error?: unknown }).error, () => undefined)
      if (error === 'invalid_grant') {
        this.access = null
        this.onExpired(path)
        throw new Error('the Google sign-in expired or was revoked; reconnect it in Settings')
      }
      throw new Error(`Google sign-in refresh failed (${res.status}); reconnect if this keeps happening`)
    }
    const body = (await res.json()) as { access_token: string; expires_in: number }
    this.access = { token: body.access_token, until: Date.now() + body.expires_in * 1000 }
    return body.access_token
  }

  /** GET a Google API URL as JSON. */
  async fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${await this.get()}` }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (res.status === 401) this.access = null
    if (!res.ok) throw new Error(`Google returned ${res.status}`)
    return (await res.json()) as T
  }

  /** POST JSON to a Google API URL (only for changes the user clicked themselves). */
  async postJson<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.get()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (res.status === 401) this.access = null
    if (!res.ok) throw new Error(`Google returned ${res.status}`)
    return (await res.json()) as T
  }
}
