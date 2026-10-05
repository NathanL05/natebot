import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDLE_MS, parsePhoneMessage, PhoneInbox } from './phone'

describe('phone messages', () => {
  it('reads an @agent prefix, or none', () => {
    expect(parsePhoneMessage('@Planner move gym to 8')).toEqual({ agent: 'planner', text: 'move gym to 8' })
    expect(parsePhoneMessage('  anything urgent?  ')).toEqual({ agent: null, text: 'anything urgent?' })
    expect(parsePhoneMessage('@planner')).toEqual({ agent: null, text: '@planner' })
  })
})

describe('phone inbox connection', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** A stream that stays open and sends nothing, like a connection that died during sleep. */
  const silentStream = (signal: AbortSignal): Response => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
      }
    })
    return new Response(body, { status: 200 })
  }

  it('reconnects when the stream goes quiet, asking from when it started listening', async () => {
    vi.useFakeTimers()
    const urls: string[] = []
    vi.stubGlobal('fetch', (url: string, init: { signal: AbortSignal }) => {
      urls.push(url)
      return Promise.resolve(silentStream(init.signal))
    })
    const lines: string[] = []
    const inbox = new PhoneInbox(() => undefined, (l) => lines.push(l))
    inbox.listen('my-private-topic-in')
    await vi.advanceTimersByTimeAsync(IDLE_MS + 6_000)
    expect(urls).toHaveLength(2)
    expect(new URL(urls[1] ?? '').searchParams.get('since')).toBe(new URL(urls[0] ?? '').searchParams.get('since'))
    expect(lines.at(-1)).toMatch(/no keepalive/)
    inbox.stop()
    await vi.advanceTimersByTimeAsync(IDLE_MS * 3)
    expect(urls).toHaveLength(2)
  })

  it('reconnect() replaces the connection without a second loop', async () => {
    vi.useFakeTimers()
    let calls = 0
    vi.stubGlobal('fetch', (_url: string, init: { signal: AbortSignal }) => {
      calls++
      return Promise.resolve(silentStream(init.signal))
    })
    const inbox = new PhoneInbox(() => undefined, () => undefined)
    inbox.listen('my-private-topic-in')
    await vi.advanceTimersByTimeAsync(10)
    inbox.reconnect()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toBe(2)
    inbox.stop()
  })
})
