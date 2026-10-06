import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GoogleToken } from './google-api'

function tokenFile(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'gtok-')), 'me.json')
  writeFileSync(path, JSON.stringify({ token: 'old', expiry: '2020-01-01T00:00:00', refresh_token: 'r', client_id: 'c', client_secret: 's' }))
  return path
}

const reply = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status })

describe('GoogleToken', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reports an expired sign-in only for invalid_grant', async () => {
    const path = tokenFile()
    const expired = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => reply(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })))
    await expect(new GoogleToken(() => path, expired).get()).rejects.toThrow(/expired or was revoked/)
    expect(expired).toHaveBeenCalledWith(path)
  })

  it('keeps the sign-in on other refresh errors', async () => {
    const path = tokenFile()
    const expired = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => reply(400, { error: 'invalid_request' })))
    await expect(new GoogleToken(() => path, expired).get()).rejects.toThrow(/refresh failed \(400\)/)
    vi.stubGlobal('fetch', vi.fn(async () => reply(503, 'busy')))
    await expect(new GoogleToken(() => path, expired).get()).rejects.toThrow(/refresh failed \(503\)/)
    expect(expired).not.toHaveBeenCalled()
  })

  it('refreshes a stale access token', async () => {
    const path = tokenFile()
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { access_token: 'new', expires_in: 3600 })))
    await expect(new GoogleToken(() => path).get()).resolves.toBe('new')
  })
})
