// Reading replies aloud. Chromium's default voice on macOS is Albert (a novelty
// voice), so NateBot always picks one: the voice chosen in Settings, or the best
// natural English voice installed. Downloaded Premium/Enhanced voices win.

/** macOS novelty and character voices: never picked automatically, not offered in Settings. */
const NOVELTY = new Set(
  [
    'Albert', 'Bad News', 'Bahh', 'Bells', 'Boing', 'Bubbles', 'Cellos', 'Fred', 'Good News', 'Jester', 'Junior',
    'Kathy', 'Organ', 'Ralph', 'Superstar', 'Trinoids', 'Whisper', 'Wobble', 'Zarvox',
    // The Eloquence voices: robotic, and Grandma/Grandpa sound elderly on purpose.
    'Eddy', 'Flo', 'Grandma', 'Grandpa', 'Reed', 'Rocko', 'Sandy', 'Shelley'
  ].map((n) => n.toLowerCase())
)

/** The clearest of the standard voices macOS ships with, best first (used when no Premium voice is installed). */
const PREFERRED = ['daniel', 'moira', 'samantha', 'karen', 'tessa', 'rishi']

const baseName = (name: string): string => name.replace(/\s*\(.*$/, '').trim().toLowerCase()

export const isNovelty = (v: Pick<SpeechSynthesisVoice, 'name'>): boolean => NOVELTY.has(baseName(v.name))

function quality(v: Pick<SpeechSynthesisVoice, 'name' | 'lang'>): number {
  const name = v.name.toLowerCase()
  const tier = name.includes('premium') ? 0 : name.includes('enhanced') ? 1 : 2
  const known = PREFERRED.indexOf(baseName(v.name))
  // Within a tier: the preferred list, then Irish/British English, then any English.
  const local = /^en-(ie|gb)/i.test(v.lang) ? 0 : 1
  return tier * 10_000 + (known === -1 ? 100 : known) * 10 + local
}

/** Natural English voices, best first. */
export function goodVoices<V extends Pick<SpeechSynthesisVoice, 'name' | 'lang'>>(all: V[]): V[] {
  return all.filter((v) => /^en/i.test(v.lang) && !isNovelty(v)).sort((a, b) => quality(a) - quality(b) || a.name.localeCompare(b.name))
}

/** The saved voice if it's still installed, else the best natural one. */
export function pickVoice<V extends Pick<SpeechSynthesisVoice, 'name' | 'lang'>>(all: V[], saved: string | null): V | null {
  return (saved && all.find((v) => v.name === saved)) || goodVoices(all)[0] || null
}

/** Plain text for reading aloud: no Markdown, links, code, emoji or table rules. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, '')
    .replace(/\|/g, ', ')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    .replace(/[✓✔]/g, '')
    .replace(/[✗✘]/g, 'failed:')
    .replace(/\s*[→⟶·]\s*/g, ', ')
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/[*_#>~]/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

/**
 * Splits text into sentence-sized pieces. Chromium can cut off long utterances,
 * and short ones give natural pauses at line breaks.
 */
export function chunks(text: string, max = 220): string[] {
  const out: string[] = []
  for (const line of text.split(/\n+/)) {
    // A sentence ends at . ! ? ; : followed by a space, so file names, times and decimals stay whole.
    const sentences = line.match(/.+?(?:[.!?;:]+(?=\s|$)|$)/g) ?? []
    let cur = ''
    for (const s of sentences.map((x) => x.trim()).filter(Boolean)) {
      if (cur && cur.length + s.length + 1 > max) {
        out.push(cur)
        cur = ''
      }
      cur = cur ? `${cur} ${s}` : s
      while (cur.length > max) {
        const cut = cur.lastIndexOf(' ', max)
        const at = cut > max / 2 ? cut : max
        out.push(cur.slice(0, at).trim())
        cur = cur.slice(at).trim()
      }
    }
    if (cur) out.push(cur)
  }
  return out
}

/** Voices load asynchronously the first time; this waits for them (briefly). */
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const now = speechSynthesis.getVoices()
  if (now.length) return Promise.resolve(now)
  return new Promise((resolve) => {
    const done = (): void => resolve(speechSynthesis.getVoices())
    speechSynthesis.addEventListener('voiceschanged', done, { once: true })
    setTimeout(done, 1500)
  })
}

let session = 0
/** The reply being read now: stopping it (or starting another) calls its onEnd. */
let current: { id: number; onEnd?: () => void } | null = null

function finish(id: number): void {
  if (current?.id !== id) return
  const done = current.onEnd
  current = null
  done?.()
}

/** Reads text aloud with one consistent voice. Calls onEnd when it finishes, is stopped or is replaced. */
export async function speak(text: string, opts: { voice: string | null; rate: number; onEnd?: () => void }): Promise<void> {
  stopSpeaking()
  const id = ++session
  current = { id, onEnd: opts.onEnd }
  const voice = pickVoice(await loadVoices(), opts.voice)
  const parts = chunks(speakable(text))
  if (id !== session) return
  if (!parts.length) return finish(id)
  parts.forEach((part, i) => {
    const u = new SpeechSynthesisUtterance(part)
    if (voice) {
      u.voice = voice
      u.lang = voice.lang
    }
    u.rate = opts.rate
    if (i === parts.length - 1) u.onend = () => finish(id)
    u.onerror = () => finish(id)
    speechSynthesis.speak(u)
  })
}

export function stopSpeaking(): void {
  session++
  if (current) finish(current.id)
  speechSynthesis.cancel()
}
