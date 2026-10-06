# How it works

How NateBot uses your Claude Code subscription, keeps agents isolated, keeps usage down, and where your data lives.

## Your subscription, not the API

- NateBot never imports the Anthropic SDK or calls the API. The Electron main process starts
  `claude -p --output-format stream-json …` as a child process for each agent turn and streams the events to
  the chat window.
- Before starting `claude` it **removes** `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`
  and any other `ANTHROPIC_*` / `CLAUDE*` variables from the child's environment. Claude Code therefore uses
  your claude.ai login, and every run counts against your subscription's usage limits.
- On startup NateBot checks `claude --version` and `claude auth status`. If `claude` is missing, not logged in,
  or logged in with an API key, it shows a setup screen instead.
- Apps opened from Finder don't get your shell's `PATH`. NateBot asks your login shell for it once at startup
  (so nvm, Homebrew and `~/.local/bin` work). You can also set the full path to `claude` in **Settings**.
- Each agent has its own Claude Code session (`--session-id`, then `--resume`), so it remembers the
  conversation. **Reset memory** starts a new session. Instructions you edit apply from the next message.
- **Lasting notes:** each agent keeps `memory.md` in its workspace with what it has learned about you (people,
  preferences, recurring commitments). It updates the file itself, and every fresh session (after **Reset memory**,
  or if a session is lost) starts by being shown it, so resets no longer wipe everything. Read or edit the notes
  under **Agent settings → Memory & removal → Lasting notes**. Agents are told never to store secrets there.
- Agents are isolated from your normal Claude Code setup:
  - `--setting-sources project,local` ignores your user settings, hooks and plugins.
  - `--strict-mcp-config` means an agent sees only the MCP servers it is assigned.
  - The working directory is `~/NateBot/workspaces/<agent>/`, and file edits are only auto-accepted inside it.
  - Only a small set of built-in tools is enabled (Read/Write/Edit/Glob/Grep/WebSearch/WebFetch).
  - `--permission-prompts none` means anything that would need permission is refused, never left waiting.
- Usage limits: NateBot reads Claude Code's `rate_limit_event` during runs and polls `claude -p /usage`
  (answered locally, no tokens). The sidebar shows how much of your 5-hour and weekly limits you've used. When the limit is hit, a banner shows the reset time, messages wait in the queue and
  send themselves after the reset, and routines are skipped until then.

### Keeping usage down

- **Light routines** (Settings → Usage, on by default): routines and reminder tasks run on Haiku at low effort, in a
  throwaway session that starts from the agent's lasting notes and its latest reply, instead of growing the chat
  session. Afterwards the chat gets a short note of what was reported, so you can ask about it.
- **Fresh sessions for long chats:** once a chat's conversation passes about 60k tokens per call, the next message
  starts a new session, carrying across the lasting notes and the last few messages. Each reply then stops
  re-reading weeks of history.
- **Pause routines when the week reaches** 50%, 70% (default) or 90%: routines and reminder tasks are skipped above
  that. Message reminders still arrive.

## Where your data lives

Everything stays on this Mac:

| Path | What |
|---|---|
| `~/NateBot/agents/<id>.yaml` | Agent configs (human-readable; edit them by hand if you like, NateBot reloads live) |
| `~/NateBot/mcp.json` | MCP server definitions (may contain OAuth client secrets; owner-only file) |
| `~/NateBot/data.db` | Chat history and run log (SQLite) |
| `~/NateBot/settings.json` | App settings |
| `~/NateBot/workspaces/<id>/` | Each agent's private working folder; attachments go in `attachments/` |
| `~/NateBot/workspaces/<id>/memory.md` | The agent's lasting notes about you (editable in agent settings) |
| `~/NateBot/credentials/google/` | Gmail OAuth token (after connecting Gmail) |
| `~/NateBot/skills/` | Skills installed from the Marketplace (a small Claude Code plugin) |
| `~/NateBot/skill-sources.json` | GitHub repos the Marketplace browses |
| `~/NateBot/usage.json` | Last known usage numbers (so the widget works at launch) |
| `~/NateBot/backups/<date>/` | Daily backup (last 7 kept): the database, agent files, settings and lasting notes. Not `mcp.json`, which can hold secrets |
| `~/Library/Application Support/NateBot/avatars/` | Uploaded profile pictures (256px PNGs) |
| `~/Library/Logs/NateBot/main.log` | Diagnostic log (no prompts, replies or secrets) |

Deleting an agent moves its workspace to the Trash.

## Known limitations

- **Routines only run while NateBot is running** (window open or in the menu bar) **and the Mac is awake.**
  A run missed in the last 12 hours is caught up once on launch or wake; older ones are skipped. Turn on
  Launch at login. To run at exact times with the lid closed, schedule a wake: `sudo pmset repeat wakeorpoweron MTWRF 07:55:00`.
- **Shared usage limit.** Agents use the same 5-hour and weekly limits as your own Claude Code use. Haiku uses
  the least. Several agents can run at once (up to 3), which uses the limit faster.
- **Personal use only.** NateBot drives your personal Claude subscription on your own Mac. Don't share it with
  others or run it as a service for other people.
- **Unsigned app.** It is signed ad hoc, not with an Apple Developer ID and not notarised (see [Install](../README.md#install)).
- **Gmail token.** The Gmail sign-in expires weekly while your Google app is in Testing (see [Connecting Gmail](connections.md#connecting-gmail)).
- Remote (HTTP) MCP servers that need their own OAuth login may not work in headless runs. Prefer local (stdio)
  servers.
