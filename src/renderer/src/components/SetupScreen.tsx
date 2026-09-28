import { useState, type ReactNode } from 'react'
import type { EnvStatus } from '@shared/types'
import { api, useStore } from '../lib/store'
import { Avatar } from './Avatar'
import { RefreshIcon } from './icons'
import { Button, inputClass } from './ui'

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-elev-2 text-[12px] font-semibold">{n}</span>
      <div className="min-w-0 flex-1 pt-0.5 text-[13px] leading-relaxed">{children}</div>
    </li>
  )
}

function Code({ children }: { children: string }) {
  return <code className="selectable mt-1 block rounded-lg bg-sidebar px-3 py-2 font-mono text-[12px]">{children}</code>
}

/** Shown instead of the app when `claude` is missing or not logged in. */
export function SetupScreen({ env }: { env: EnvStatus }) {
  const [path, setPath] = useState('')
  const [checking, setChecking] = useState(false)

  const recheck = async (): Promise<void> => {
    setChecking(true)
    try {
      if (path.trim()) await useStore.getState().patchSettings({ claudePath: path.trim() })
      useStore.setState({ env: await api.recheckEnv() })
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="drag h-[52px] shrink-0" />
      <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 pb-10">
        <div className="w-full max-w-[520px]">
          <div className="mb-6 text-center">
            <div className="mb-3 flex justify-center">
              <Avatar seed="NateBot" shape="blob" color="#6A5CFF" size={64} />
            </div>
            <h1 className="text-[22px] font-bold">Let's get NateBot running</h1>
            <p className="mt-2 text-[13px] text-muted">
              NateBot uses the Claude Code app on this Mac and your Claude subscription. No API key needed.
            </p>
          </div>

          <div className="mb-5 rounded-xl bg-warn/10 px-4 py-3 text-[13px] text-warn">
            {env.error ?? (env.claudeFound ? 'Claude Code is not logged in.' : "Couldn't find Claude Code on this Mac.")}
          </div>

          <ol className="space-y-4 rounded-2xl bg-elev/60 p-5">
            {!env.claudeFound && (
              <Step n={1}>
                Install Claude Code. Open Terminal and run:
                <Code>curl -fsSL https://claude.ai/install.sh | bash</Code>
              </Step>
            )}
            <Step n={env.claudeFound ? 1 : 2}>
              Log in with your Claude account (Pro or Max):
              <Code>claude auth login</Code>
            </Step>
            <Step n={env.claudeFound ? 2 : 3}>
              Already installed somewhere unusual? Paste the full path to <code className="font-mono">claude</code>{' '}
              (find it with <code className="font-mono">which claude</code> in Terminal):
              <input
                className={`${inputClass} mt-2 font-mono text-[12px]`}
                value={path}
                placeholder={env.claudePath ?? '/Users/you/.local/bin/claude'}
                onChange={(e) => setPath(e.target.value)}
              />
            </Step>
          </ol>

          <div className="mt-5 flex justify-center">
            <Button variant="primary" onClick={() => void recheck()} disabled={checking}>
              <RefreshIcon size={14} className={checking ? 'spin' : ''} /> Check again
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
