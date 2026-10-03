import { MODELS, type Routine } from '@shared/types'
import { describeCron } from '@shared/schedule'
import { useSelectedAgent, useStore } from '../lib/store'
import { clockTime } from '../lib/format'
import { AgentDrawer } from './AgentDrawer'
import { agentPicture } from '../lib/avatars'
import { Avatar } from './Avatar'
import { AvatarEditor } from './AvatarEditor'
import { Composer } from './Composer'
import { AlertIcon, SlidersIcon } from './icons'
import { MessageList } from './MessageList'
import { IconButton } from './ui'

export function UsageBanner() {
  const usage = useStore((s) => s.usage)
  if (!usage) return null
  if (usage.status === 'rejected') {
    const reset = usage.resetsAt ? ` Resets at ${clockTime(usage.resetsAt)}.` : ''
    return (
      <div className="mx-6 mt-2 flex items-center gap-2 rounded-xl bg-warn/12 px-3 py-2 text-[13px] text-warn">
        <AlertIcon size={15} className="shrink-0" />
        <span>
          <strong className="font-semibold">Usage limit reached.</strong>
          {reset} Messages will wait, and routines are paused until then.
        </span>
      </div>
    )
  }
  if ((usage.fiveHour.utilization ?? 0) >= 0.9) {
    return (
      <div className="mx-6 mt-2 rounded-xl bg-warn/10 px-3 py-1.5 text-center text-[12px] text-warn">
        {Math.round((usage.fiveHour.utilization ?? 0) * 100)}% of your 5-hour usage window used
      </div>
    )
  }
  return null
}

/** "Weekdays at 8:00 AM", or "Weekdays at 8:00 AM +1" with more routines on. */
function routineLabel(routines: Routine[]): string | null {
  const on = routines.filter((r) => r.enabled)
  if (!on[0]) return null
  return `${describeCron(on[0].cron)}${on.length > 1 ? ` +${on.length - 1}` : ''}`
}

export function ChatView() {
  const agent = useSelectedAgent()
  const messages = useStore((s) => (s.selectedId ? s.messages[s.selectedId] : undefined))
  const drawerOpen = useStore((s) => s.drawerOpen)
  const mcpServers = useStore((s) => s.mcpServers)

  if (!agent) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="drag h-[52px]" />
        <div className="flex flex-1 items-center justify-center text-[14px] text-muted">
          Add an agent with the + button to get started.
        </div>
      </div>
    )
  }

  const model = MODELS.find((m) => m.id === agent.model)?.label ?? agent.model
  const subtitle =
    agent.status === 'running'
      ? 'Working…'
      : [model, routineLabel(agent.routines)].filter(Boolean).join(' · ')
  const missing = agent.mcp_servers.filter((n) => !mcpServers.find((s) => s.name === n)?.configured)

  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      <header className="drag flex h-[52px] shrink-0 items-center gap-3 px-5">
        <AvatarEditor target={`agent:${agent.id}`} hasPicture={!!agent.avatarVersion} label={`Change ${agent.name}'s picture`}>
          <Avatar seed={agent.name} shape={agent.shape} color={agent.color} picture={agentPicture(agent.id, agent.avatarVersion)} size={30} running={agent.status === 'running'} />
        </AvatarEditor>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] leading-tight font-semibold">{agent.name}</div>
          <div className={`truncate text-[12px] leading-tight ${agent.status === 'running' ? 'text-accent' : 'text-muted'}`}>
            {subtitle}
          </div>
        </div>
        <IconButton label="Agent settings" onClick={() => useStore.getState().setDrawerOpen(true)}>
          <SlidersIcon size={17} />
        </IconButton>
      </header>

      <UsageBanner />
      {missing.length > 0 && (
        <button
          type="button"
          onClick={() =>
            missing.includes('gmail')
              ? useStore.getState().setGmailOpen(true)
              : missing.includes('gcal')
                ? useStore.getState().setCalendarOpen(true)
                : useStore.getState().setDrawerOpen(true)
          }
          className="mx-6 mt-2 rounded-xl bg-elev px-3 py-2 text-left text-[12px] text-muted hover:text-fg"
        >
          <span className="font-semibold text-warn">{missing.includes('gmail') ? 'Connect Gmail →' : missing.includes('gcal') ? 'Connect Calendar →' : `Set up ${missing.join(', ')}`}</span>
          {' · '}This agent needs {missing.join(', ')}, which isn't set up yet.
        </button>
      )}

      {messages === undefined ? (
        <div className="flex-1" />
      ) : messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <Avatar seed={agent.name} shape={agent.shape} color={agent.color} picture={agentPicture(agent.id, agent.avatarVersion)} size={72} />
          <div className="text-[17px] font-semibold">{agent.name}</div>
          <div className="max-w-[360px] text-[13px] text-muted">
            {agent.instructions.split('\n')[0] || 'Say hi to get started.'}
          </div>
        </div>
      ) : (
        <MessageList messages={messages} agentId={agent.id} />
      )}

      <Composer
        key={agent.id}
        chatId={agent.id}
        name={agent.name}
        running={agent.status === 'running'}
        queued={agent.queued}
        quickPrompts={agent.quick_prompts}
      />

      {drawerOpen && <AgentDrawer agent={agent} />}
    </div>
  )
}
