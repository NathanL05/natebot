import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { userInfo } from 'node:os'
import { DEFAULT_EFFORT, DEFAULT_QUICK_CAPTURE, EFFORTS, MAX_ABOUT_ME, PAUSE_LEVELS, QUICK_CAPTURE_SHORTCUTS, type AppSettings, type EffortLevel, type ModelId, type Theme } from '@shared/types'
import { DEFAULT_ACCENT, isAccentId } from '@shared/accents'
import { SETTINGS_FILE } from './paths'

function fullName(): string {
  try {
    return execFileSync('/usr/bin/id', ['-F'], { encoding: 'utf8', timeout: 2000 }).trim() || userInfo().username
  } catch {
    return userInfo().username
  }
}

const MODELS: ModelId[] = ['sonnet', 'haiku', 'opus']
const THEMES: Theme[] = ['dark', 'light']

export function sanitize(raw: Partial<AppSettings>, fallback: AppSettings): AppSettings {
  return {
    claudePath: typeof raw.claudePath === 'string' && raw.claudePath.trim() ? raw.claudePath.trim() : null,
    defaultModel: MODELS.includes(raw.defaultModel as ModelId) ? (raw.defaultModel as ModelId) : fallback.defaultModel,
    defaultEffort: EFFORTS.some((e) => e.id === raw.defaultEffort) ? (raw.defaultEffort as EffortLevel) : fallback.defaultEffort,
    theme: THEMES.includes(raw.theme as Theme) ? (raw.theme as Theme) : fallback.theme,
    accent: isAccentId(raw.accent) ? raw.accent : fallback.accent,
    launchAtLogin: typeof raw.launchAtLogin === 'boolean' ? raw.launchAtLogin : fallback.launchAtLogin,
    userName: typeof raw.userName === 'string' && raw.userName.trim() ? raw.userName.trim() : fallback.userName,
    quickCapture:
      raw.quickCapture === null
        ? null
        : QUICK_CAPTURE_SHORTCUTS.some((s) => s.id === raw.quickCapture)
          ? (raw.quickCapture as string)
          : fallback.quickCapture,
    lightRuns: typeof raw.lightRuns === 'boolean' ? raw.lightRuns : fallback.lightRuns,
    pauseRoutinesAt:
      raw.pauseRoutinesAt === null ? null : PAUSE_LEVELS.includes(raw.pauseRoutinesAt as number) ? (raw.pauseRoutinesAt as number) : fallback.pauseRoutinesAt,
    aboutMe: typeof raw.aboutMe === 'string' ? raw.aboutMe.trim().slice(0, MAX_ABOUT_ME) : fallback.aboutMe
  }
}

export class SettingsStore {
  private value: AppSettings

  constructor() {
    const defaults: AppSettings = {
      claudePath: null,
      defaultModel: 'sonnet',
      defaultEffort: DEFAULT_EFFORT,
      theme: 'dark',
      accent: DEFAULT_ACCENT,
      launchAtLogin: false,
      userName: fullName(),
      quickCapture: DEFAULT_QUICK_CAPTURE,
      lightRuns: true,
      pauseRoutinesAt: 0.7,
      aboutMe: ''
    }
    let raw: Partial<AppSettings> = {}
    try {
      raw = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) as Partial<AppSettings>
    } catch {
      // First launch or unreadable file: use defaults.
    }
    this.value = sanitize(raw, defaults)
  }

  get(): AppSettings {
    return this.value
  }

  update(patch: Partial<AppSettings>): AppSettings {
    this.value = sanitize({ ...this.value, ...patch }, this.value)
    // claudePath may be cleared explicitly.
    if ('claudePath' in patch && !patch.claudePath) this.value.claudePath = null
    writeFileSync(SETTINGS_FILE, JSON.stringify(this.value, null, 2) + '\n')
    return this.value
  }
}
