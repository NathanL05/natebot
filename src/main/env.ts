// Finding and health-checking the `claude` CLI, and building the environment
// it runs in. Apps launched from Finder/Dock don't inherit the shell PATH, so
// we ask the user's login shell for it once at startup.
import { execFile } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import type { EnvStatus } from '@shared/types'

const execFileP = promisify(execFile)
const home = homedir()

const EXTRA_DIRS = [
  join(home, '.local/bin'),
  join(home, '.claude/local'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  join(home, '.npm-global/bin'),
  '/usr/bin',
  '/bin'
]

let resolvedPath: string = [process.env['PATH'] ?? '', ...EXTRA_DIRS].filter(Boolean).join(delimiter)

/** Ask the login shell for its PATH (covers nvm, Homebrew, custom installs). */
export async function resolveShellPath(): Promise<string> {
  const shell = process.env['SHELL'] || '/bin/zsh'
  let shellPath = ''
  try {
    const { stdout } = await execFileP(shell, ['-ilc', 'printf "__NB__%s__NB__" "$PATH"'], {
      timeout: 8000,
      env: { ...process.env, DISABLE_AUTO_UPDATE: 'true', ZSH_DISABLE_COMPFIX: 'true' }
    })
    shellPath = /__NB__(.*?)__NB__/s.exec(stdout)?.[1] ?? ''
  } catch {
    // Slow or broken shell config: fall back to well-known locations.
  }
  const dirs = [...shellPath.split(delimiter), ...(process.env['PATH'] ?? '').split(delimiter), ...EXTRA_DIRS]
  resolvedPath = [...new Set(dirs.filter(Boolean))].join(delimiter)
  return resolvedPath
}

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function findClaude(override: string | null): string | null {
  if (override) return isExecutable(override) ? override : null
  for (const dir of resolvedPath.split(delimiter)) {
    const candidate = join(dir, 'claude')
    if (isExecutable(candidate)) return candidate
  }
  return null
}

/**
 * The environment every claude child process gets. API keys and variables
 * from any parent Claude Code session are removed, so the CLI always uses the
 * subscription login and behaves like a fresh top-level session.
 */
export function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('ANTHROPIC_')) continue // ANTHROPIC_API_KEY, _AUTH_TOKEN, _BASE_URL…
    if (key.startsWith('CLAUDE') && key !== 'CLAUDE_CONFIG_DIR') continue // CLAUDECODE, CLAUDE_CODE_*…
    if (key.startsWith('ELECTRON_')) continue
    env[key] = value
  }
  env['PATH'] = resolvedPath
  return env
}

function firstJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function checkEnv(override: string | null): Promise<EnvStatus> {
  const claudePath = findClaude(override)
  if (!claudePath) {
    return {
      claudeFound: false,
      claudePath: null,
      version: null,
      loggedIn: false,
      subscriptionType: null,
      error: override
        ? `No runnable claude program at ${override}.`
        : "Couldn't find Claude Code on this Mac."
    }
  }

  const opts = { timeout: 15_000, env: childEnv(), cwd: home }
  let version: string | null = null
  try {
    const { stdout } = await execFileP(claudePath, ['--version'], opts)
    version = /(\d+\.\d+\.\d+)/.exec(stdout)?.[1] ?? stdout.trim()
  } catch (e) {
    return { claudeFound: true, claudePath, version: null, loggedIn: false, subscriptionType: null, error: `Found claude but it failed to run: ${(e as Error).message}` }
  }

  try {
    const { stdout } = await execFileP(claudePath, ['auth', 'status'], opts).catch((e: { stdout?: string }) => ({ stdout: e.stdout ?? '' }))
    const status = firstJsonObject(stdout)
    const loggedIn = status?.['loggedIn'] === true
    const method = String(status?.['authMethod'] ?? '')
    const subscriptionType = typeof status?.['subscriptionType'] === 'string' ? (status['subscriptionType'] as string) : null
    let error: string | null = null
    if (!loggedIn) error = 'Claude Code is installed but not logged in.'
    else if (/api.?key/i.test(method)) {
      error = `Claude Code is logged in with "${method}", not a Claude subscription. Run "claude auth login" and choose your Claude account.`
    }
    return { claudeFound: true, claudePath, version, loggedIn: loggedIn && !error, subscriptionType, error }
  } catch (e) {
    return { claudeFound: true, claudePath, version, loggedIn: false, subscriptionType: null, error: `Couldn't check the login: ${(e as Error).message}` }
  }
}
