import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './ui'

/**
 * Catches a rendering error so one broken message or screen doesn't blank the whole
 * window. `resetKey` clears the error when it changes (e.g. switching chats).
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('NateBot render error', error, info.componentStack)
  }

  override componentDidUpdate(prev: { resetKey?: string }): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="drag flex h-full flex-1 items-center justify-center p-8">
        <div className="no-drag w-full max-w-[420px] rounded-2xl bg-elev/60 p-5 text-center">
          <div className="text-[15px] font-semibold">Something went wrong showing this</div>
          <p className="mt-1.5 text-[13px] text-muted">Your chats and agents are safe. Try again, or reload the window.</p>
          <pre className="selectable mt-3 max-h-24 overflow-auto rounded-lg bg-elev-2 px-3 py-2 text-left font-mono text-[11px] whitespace-pre-wrap text-muted">
            {error.message || String(error)}
          </pre>
          <div className="mt-4 flex justify-center gap-2">
            <Button onClick={() => this.setState({ error: null })}>Try again</Button>
            <Button variant="primary" onClick={() => location.reload()}>
              Reload
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
