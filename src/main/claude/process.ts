// Spawning `claude -p` as a child process: streaming stdout line by line,
// timeouts, and killing the whole process group (MCP servers included).
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

export type EndReason = 'exit' | 'timeout' | 'stopped' | 'spawn-error'

export interface ProcessResult {
  code: number | null
  reason: EndReason
  stderr: string
  error?: string
}

export interface ClaudeProcess {
  kill(reason: 'timeout' | 'stopped'): void
  done: Promise<ProcessResult>
}

const STDERR_LIMIT = 8_000

export function spawnClaude(opts: {
  bin: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  input: string
  timeoutMs: number
  onEvent: (event: Record<string, unknown>) => void
}): ClaudeProcess {
  let reason: EndReason = 'exit'
  let stderr = ''

  // detached = own process group, so we can kill claude and its MCP servers together.
  const child = spawn(opts.bin, opts.args, { cwd: opts.cwd, env: opts.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })

  const killGroup = (signal: NodeJS.Signals): void => {
    try {
      if (child.pid) process.kill(-child.pid, signal)
    } catch {
      child.kill(signal)
    }
  }

  const kill = (why: 'timeout' | 'stopped'): void => {
    if (child.exitCode !== null || child.signalCode !== null) return
    reason = why
    killGroup('SIGTERM')
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) killGroup('SIGKILL')
    }, 3000).unref()
  }

  const timer = setTimeout(() => kill('timeout'), opts.timeoutMs)

  child.stdin.on('error', () => undefined)
  child.stdin.end(opts.input)

  createInterface({ input: child.stdout }).on('line', (line) => {
    if (!line.trim()) return
    try {
      opts.onEvent(JSON.parse(line) as Record<string, unknown>)
    } catch {
      // Non-JSON output (warnings): keep it with stderr for diagnostics.
      stderr = (stderr + line + '\n').slice(-STDERR_LIMIT)
    }
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-STDERR_LIMIT)
  })

  const done = new Promise<ProcessResult>((resolve) => {
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ code: null, reason: 'spawn-error', stderr, error: err.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, reason, stderr })
    })
  })

  return { kill, done }
}
