import { describe, expect, it } from 'vitest'
import type { AppSettings } from '@shared/types'
import { DEFAULT_ACCENT } from '@shared/accents'
import { sanitize } from './settings'

const defaults: AppSettings = {
  claudePath: null,
  defaultModel: 'sonnet',
  defaultEffort: 'medium',
  theme: 'dark',
  accent: DEFAULT_ACCENT,
  launchAtLogin: false,
  userName: 'Nathan',
  quickCapture: 'Alt+Space',
  lightRuns: true,
  pauseRoutinesAt: 0.7,
  aboutMe: '',
  pushTopic: null,
  pushDetails: false,
  phoneInbox: false,
  quietHours: null,
  voice: null,
  voiceRate: 1,
  confirmQuit: true
}

describe('settings sanitising', () => {
  it('uses the fallback for a missing or empty file', () => {
    expect(sanitize({}, defaults)).toEqual(defaults)
  })

  it('keeps valid values', () => {
    const next = sanitize(
      { claudePath: ' /opt/bin/claude ', defaultModel: 'opus', defaultEffort: 'low', theme: 'light', launchAtLogin: true, userName: ' Nate ' },
      defaults
    )
    expect(next).toMatchObject({
      claudePath: '/opt/bin/claude',
      defaultModel: 'opus',
      defaultEffort: 'low',
      theme: 'light',
      launchAtLogin: true,
      userName: 'Nate'
    })
  })

  it('keeps a chosen voice and a known speed only', () => {
    expect(sanitize({ voice: ' Daniel ', voiceRate: 1.15 }, defaults)).toMatchObject({ voice: 'Daniel', voiceRate: 1.15 })
    expect(sanitize({ voice: '', voiceRate: 7 }, { ...defaults, voice: 'Moira' })).toMatchObject({ voice: 'Moira', voiceRate: 1 })
    expect(sanitize({ voice: null }, { ...defaults, voice: 'Moira' }).voice).toBeNull()
  })

  it('ignores invalid values from a hand-edited file', () => {
    const raw = {
      claudePath: '   ',
      defaultModel: 'gpt',
      defaultEffort: 'turbo',
      theme: 'sepia',
      accent: 'not-a-colour',
      launchAtLogin: 'yes',
      userName: '',
      quickCapture: 'F13',
      lightRuns: 'yes',
      pauseRoutinesAt: 0.42,
      pushTopic: 'short',
      pushDetails: 1
    } as unknown as Partial<AppSettings>
    expect(sanitize(raw, defaults)).toEqual(defaults)
  })

  it('keeps a known quick-capture shortcut, or off', () => {
    expect(sanitize({ quickCapture: 'Control+Alt+Space' }, defaults).quickCapture).toBe('Control+Alt+Space')
    expect(sanitize({ quickCapture: null }, defaults).quickCapture).toBeNull()
  })
})
