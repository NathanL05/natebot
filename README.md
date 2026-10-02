# NateBot

A personal multi-agent Mac app that looks like a messaging app. Each "contact" in the sidebar is an AI agent
with its own job (an Email Agent that reviews your inbox, a Planner, a Research Helper…). You chat with them,
give them recurring routines, and approve anything irreversible they want to do.

NateBot runs entirely on your **Claude Code subscription**. It drives the `claude` CLI that is already installed
and logged in on your Mac. There is **no API key and no API billing**.

## Contents

- [Requirements](#requirements)
- [Install the app](#install-the-app)
- [Run in development](#run-in-development)
- [Build the .app and .dmg](#build-the-app-and-dmg)
- [Rebuild after changes](#rebuild-after-changes)
- [Development workflow](#development-workflow)
- [How the subscription (not API) setup works](#how-the-subscription-not-api-setup-works)
- [Where your data lives](#where-your-data-lives)
- [Agents](#agents)
- [Group chats](#group-chats)
- [Approvals](#approvals)
- [Routines](#routines)
- [Avatars](#avatars)
- [Skills marketplace](#skills-marketplace)
- [Usage widget](#usage-widget)
- [Connecting Gmail](#connecting-gmail)
- [Adding MCP servers](#adding-mcp-servers)
- [Known limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)

## Requirements

- A Mac with Apple Silicon (for Intel, build with `npm run dist:universal`)
- [Claude Code](https://code.claude.com) installed and logged in with a Claude **Pro or Max** account.
  Check in Terminal: `claude auth status` should show `"loggedIn": true` and `"authMethod": "claude.ai"`.
- To build from source: Node 22+ (`nvm use` reads `.nvmrc`)
- For Gmail: [uv](https://docs.astral.sh/uv/) (`brew install uv`) and a free Google Cloud OAuth client (see below)

## Install the app

1. Build it (see below) or use an existing `dist/NateBot-<version>-arm64.dmg`.
2. Double-click the `.dmg` and drag **NateBot** onto **Applications**.
3. Launch it from Applications, Launchpad, Spotlight or the Dock.

**First launch.** NateBot is signed ad hoc, not with a paid Apple Developer ID. A copy you built yourself opens
normally. A copy that was downloaded or AirDropped may be blocked the first time:

- Right-click (or Control-click) **NateBot** in Applications → **Open** → **Open**.
- On newer macOS versions where that isn't offered: try to open it once, then go to **System Settings →
  Privacy & Security**, scroll down and click **Open Anyway**.

You only need to do this once. After that, closing the window keeps NateBot in the menu bar (the little blob face) so
routines keep running. Quit from the menu-bar icon or with ⌘Q. Turn on **Settings → Launch at login** to
have it start quietly in the menu bar when you log in.

## Run in development

```bash
nvm use
npm install
npm run dev
```

Dev builds add a **Debug** menu that can simulate a usage limit or a setup problem.

## Build the .app and .dmg

```bash
npm run dist
```

This type-checks, builds, and writes:

- `dist/mac-arm64/NateBot.app`
- `dist/NateBot-<version>-arm64.dmg`

`npm run dist:universal` builds an Intel + Apple Silicon version instead. The production app loads its bundled
UI files, never a localhost URL, and needs no terminal or dev server.

## Changing the app icon

The icon's source is `build/icon.svg` (the menu-bar icon is `build/trayTemplate.svg`); `npm run icons` rebuilds
every size from them. To use your own art, run `npm run icons -- path/to/art.png` with any 1024×1024 PNG or SVG.
It regenerates `build/icon.icns` and the PNGs, and rebuilds the dev app.

The current icon is a white-to-silver metallic bubble bot on a black tile. The UI's accent colour is separate:
pick one of 18 in **Settings → Appearance → Accent colour** (defined in `src/shared/accents.ts`).

**macOS caches app icons aggressively.** After changing the icon, to see it everywhere:

1. Build and install the new app (`npm run dist`, then replace `/Applications/NateBot.app`).
2. Unpin the old Dock icon (right-click → Options → uncheck *Keep in Dock*).
3. Refresh the icon caches:
   ```bash
   touch /Applications/NateBot.app && killall Dock && killall Finder
   ```
4. Open NateBot and pin it again (right-click its Dock icon → Options → *Keep in Dock*).

If the old icon still shows, clear the system icon cache (asks for your password) and restart the Mac:

```bash
sudo rm -rf /Library/Caches/com.apple.iconservices.store
``` `npm install` sets up dev mode automatically: `npm run dev` launches a
NateBot-branded copy of Electron (`node_modules/electron/dist/NateBot.app`), so the Dock and menu bar show NateBot.
To keep NateBot in your Dock, pin the installed `/Applications/NateBot.app` (pinning the dev copy would open a
blank Electron window when clicked).

## Rebuild after changes

```bash
git pull            # or make your own edits
npm install
npm run dist
```

Then quit NateBot (menu-bar icon → Quit, or ⌘Q), drag the new `NateBot.app` from `dist/mac-arm64/` (or the
new `.dmg`) into Applications, replace the old one, and open it. Your agents, chats and settings live in
`~/NateBot`, so they carry over.

## Development workflow

- **Branches:** `main` only accepts pull requests. Work on a short-lived branch, open a PR, and squash-merge it
  once CI is green.
- **Checks:** `npm test` runs the unit tests (Vitest, `src/**/*.test.ts`). CI (`.github/workflows/ci.yml`) runs
  typecheck, tests and build on every PR and push to `main`. Tests never start Electron or `claude`.
- **Releases:** bump the version in a PR (`npm version minor --no-git-tag-version`), merge it, then tag `main`
  (`git tag v0.2.0 && git push origin v0.2.0`). `.github/workflows/release.yml` builds the `.dmg` on macOS and
  attaches it to a draft GitHub release. The app is ad-hoc signed and not notarised: a downloaded copy needs
  right-click → Open on first launch, and it can't auto-update.

## How the subscription (not API) setup works

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
- Agents are isolated from your normal Claude Code setup:
  - `--setting-sources project,local` ignores your user settings, hooks and plugins.
  - `--strict-mcp-config` means an agent sees only the MCP servers it is assigned.
  - The working directory is `~/NateBot/workspaces/<agent>/`, and file edits are only auto-accepted inside it.
  - Only a small set of built-in tools is enabled (Read/Write/Edit/Glob/Grep/WebSearch/WebFetch/TodoWrite).
  - `--permission-prompts none` means anything that would need permission is refused, never left waiting.
- Usage limits: NateBot reads Claude Code's `rate_limit_event` during runs and polls `claude -p /usage`
  (answered locally, no tokens). The sidebar shows how much of your 5-hour and weekly limits you've used. When the limit is hit, a banner shows the reset time, messages wait in the queue and
  send themselves after the reset, and routines are skipped until then.

## Where your data lives

Everything stays on this Mac:

| Path | What |
|---|---|
| `~/NateBot/agents/<id>.yaml` | Agent configs (human-readable; edit them by hand if you like, NateBot reloads live) |
| `~/NateBot/mcp.json` | MCP server definitions (may contain OAuth client secrets; owner-only file) |
| `~/NateBot/data.db` | Chat history and run log (SQLite) |
| `~/NateBot/settings.json` | App settings |
| `~/NateBot/workspaces/<id>/` | Each agent's private working folder; attachments go in `attachments/` |
| `~/NateBot/credentials/google/` | Gmail OAuth token (after connecting Gmail) |
| `~/NateBot/skills/` | Skills installed from the Marketplace (a small Claude Code plugin) |
| `~/NateBot/skill-sources.json` | GitHub repos the Marketplace browses |
| `~/NateBot/usage.json` | Last known usage numbers (so the widget works at launch) |
| `~/Library/Application Support/NateBot/avatars/` | Uploaded profile pictures (256px PNGs) |
| `~/Library/Logs/NateBot/main.log` | Diagnostic log (no prompts, replies or secrets) |

Deleting an agent moves its workspace to the Trash.

## Agents

Add agents with **+** in the sidebar. Edit one with the sliders button in the chat header. Each agent is a YAML
file:

```yaml
id: email-agent
name: Email Agent
shape: hexagon         # blob | circle | square | hexagon | triangle | pill | cloud, or null = from the name
color: "#F5A524"
model: sonnet          # sonnet | haiku | opus (haiku uses the least of your limit)
effort: medium         # low | medium | high | xhigh | max (how hard it thinks; lower uses less of your limit)
instructions: |
  You review my Gmail inbox. Flag anything urgent, summarise the rest in a
  short ✓ checklist, and draft replies. NEVER send an email yourself.
mcp_servers: [gmail]   # names from ~/NateBot/mcp.json
allowed_tools: []      # extra tools, e.g. WebSearch WebFetch, or mcp__server__tool
disallowed_tools: []   # tools this agent may never use
routine:
  enabled: true
  cron: "0 8 * * 1-5"
  prompt: "Do my morning inbox sweep."
session_id: null       # managed by NateBot (memory)
```

Models are pinned to full names (Sonnet 5.5, Opus 5.5, Haiku 4.5; see `MODEL_IDS` in `src/shared/types.ts`), so an
agent doesn't change model when an alias moves on. Effort defaults to medium for new agents and can be changed
per agent or in Settings → Defaults. Agents without an `effort` line in their YAML run at medium.

Every agent also gets a shared NateBot house style: be concise, use ✓ checklists for status, and never take
irreversible actions without approval.

- **Folders:** group agents and group chats in the sidebar. Create one with the folder button at the top, then
  drag chats onto it or right-click a chat → **Move to**. Click a folder's name to collapse it, **+** to create an
  agent inside it, and **…** to rename or delete it (its chats move to *No folder*).
- **Composer:** Enter sends, Shift+Enter adds a new line, and **+** attaches one or more files: PDFs, images,
  documents (copied into the agent's workspace).
- **Queueing:** messages sent while an agent is busy wait their turn.
- **Stop:** ends the current run and cancels anything queued.
- **Timeout:** runs time out after 15 minutes.

## Group chats

Put several agents in one room and let them talk to each other. Create one with the people button at the top of
the sidebar (or **⇧⌘N**), pick 2–6 agents, and choose how many replies the group may make before it pauses.

- **Turn order:** after your message, every member replies once, each seeing what the others just said. Type
  **@** to pick a member: agents you @mention answer first, and the others only chime in if they can genuinely
  add something (otherwise they stay quiet). Each of those optional turns is still a short run.
- **Agents talk to each other:** an agent that @mentions another member hands it the next turn, so they can ask
  each other questions and build on each other's answers. An agent with nothing to add replies `PASS` and stays
  quiet.
- **Pacing:** the group usually finishes on its own, once nobody has anything to add or a question for anyone.
  Each group also has a **max replies per message** (4–20, a guardrail). Agents are told how many replies are
  left so they converge, and the last one wraps up with a summary or a question for you. To keep the discussion
  going, just reply. Stop ends it immediately.
- **Memory:** each agent has a separate Claude session for each group, so group chats never mix with its
  one-on-one memory. Each turn only sends what the agent hasn't seen yet, which keeps the prompt cache warm.
- **Files:** the **+** attaches PDFs, images or any other file (up to 50 MB each). Every member gets a copy in
  its own working folder so any of them can read it.
- **Limits:** group chats can't propose actions for approval. Ask the agent
  in its own chat for that. Every agent reply is one normal run, so a lively group uses your limit faster.
  Pick Haiku agents for chatty groups.

Groups are stored in `~/NateBot/data.db` (table `rooms`). The turn logic is in `src/main/rooms.ts`.

## Approvals

Agents never send, delete, post or pay on their own. Instead they end a reply with a block like this:

````
```proposed_actions
[{"type": "send_email", "summary": "Reply to Sarah re: deadline",
  "tool": "mcp__gmail__send_gmail_message",
  "details": {"to": "sarah@example.com", "subject": "Re: Deadline", "body": "…"}}]
```
````

NateBot shows the proposal as a card with **Approve / Edit / Reject**:

- **Approve** starts a separate one-off `claude -p` run that allows **only that one tool**, from one of the
  agent's own MCP servers. It carries out exactly the approved details and then reports "✓ Sent reply to Sarah".
- **Edit** lets you change the details before you approve.
- **Reject** tells the agent not to do it.

You don't have to open the app: the **Needs your approval** notification has **Approve** and **Reject** buttons
when there's a single action. It names the tool and shows the key details (recipients, subject, date), never the
message body, so click it to read or edit the full card first. If the action has any other detail the
notification can't show, or there are several actions, it has no buttons and just opens the chat. Approving or rejecting in the app removes the notification, and you get a **Done** or
**Action failed** notification when an approved action finishes while NateBot isn't in front. Buttons only work
while NateBot is still running from when the notification arrived.

For extra safety, tools listed under `require_approval` in `mcp.json` are blocked in every normal run, whatever
an agent's YAML says. The Gmail setup lists `send_gmail_message` there, along with filter and label changes.

## Handoffs

In a one-on-one chat, an agent can suggest passing a task to another agent, for example the Email Agent asking
the Planner to block out Friday afternoon for a deadline. It appears as a **Hand off** card showing who gets it
and exactly what they'll be told. Nothing is sent until you click **Hand off**; **Dismiss** tells the agent not
to send it again. When you hand off, the other agent starts working in its own chat (so you'll see a "Handed off
from…" line there), using its own tools and permissions, and it's told the task came from another agent, not
from you. Its reply can propose a further handoff, which again needs your click, so agents can't chain
themselves.

Agents only learn about each other through a short list of names and one-line roles in their system prompt
(about 25 tokens per other agent, and nothing at all if you have a single agent). Group chats don't support
handoffs.

## Routines

Turn on a routine in an agent's settings. Pick "Weekdays at 8:00 AM" (or write your own cron) and say what it
should do. The **Routines** view (clock icon, ⇧⌘R) lists every routine with its next run, last result, an on/off
toggle and **Run now**. You get a macOS notification when a routine finishes or an agent needs your approval.

Routines fire while NateBot is running and the Mac is awake. If one was missed in the last 12 hours (the Mac was
asleep or NateBot was quit), it runs once when NateBot starts or the Mac wakes, and the chat says so: *Routine ran
at 9:14 AM (it was due at 8:00 AM)*. Only the latest missed time runs, never a backlog. A new or changed schedule
starts counting from when you save it.

## Avatars

Each agent gets a mascot (a coloured shape with a small face) generated from its name, so it always looks
the same. You can pick a different shape and colour in the agent's settings.

To use a photo instead, click any avatar (in the chat header, in agent settings, or your own at the bottom of the
sidebar) and choose **Choose picture…**. PNG, JPG and GIF work; the image is cropped to a square and resized to
256px, and a GIF keeps its first frame. **Reset to default** goes back to the mascot (or your initials).

## Skills marketplace

**Marketplace** (above your profile in the sidebar) lets you browse [Agent Skills](https://github.com/anthropics/skills)
and install or remove them with one click. It starts with Anthropic's official `anthropics/skills` repo. Use
**+ Source** to add any GitHub repo that contains `SKILL.md` folders (`owner/repo` or its URL).

- Installed skills go into `~/NateBot/skills`, a NateBot-owned Claude Code plugin. Every agent run loads it with
  `--plugin-dir` and gets the `Skill` tool, so any agent can use them.
- You can also copy a skill folder (containing `SKILL.md`) into `~/NateBot/skills/skills/` by hand. It shows up as
  a local skill.
- Skills marked **scripts** ship helper programs. Agents can read them but can't run them, because agents don't
  have Bash unless you allow it for that agent under *Advanced tool permissions*.
- Claude Code *plugins* from plugin marketplaces aren't used. They can include hooks and MCP servers that run
  code automatically, which would bypass NateBot's approval model.
- Skills are instructions written by other people, so only add sources you trust. Removing a skill moves it to
  the Trash.

## Usage widget

At the top of the sidebar, next to **+**, two nested rings show your usage: the outer ring is the **5-hour
session**, the inner one the **week**, and the number is the session % used. They turn amber from 60% and red
from 85% or when a limit is hit. Click them for exact numbers, reset times and a refresh button.

The numbers come from `claude -p /usage`, which Claude Code answers locally without using any tokens. They cover
all your usage (Claude Code and claude.ai too), not just NateBot's. NateBot checks at launch, every 5 minutes,
whenever you open the panel, and after each agent run. **Settings → Usage** shows the same numbers.

**Settings → Usage → By agent** shows which agents used the most over the current 5-hour window or week: runs,
tokens in and out, and a share bar. Every run (chats, routines, approved actions and group-chat turns) records
the token counts Claude Code reports. The share is based on Claude's API-price estimate for each run, so Opus
counts for more than Haiku and cached reads for less than fresh input. It covers NateBot's own runs only, so it
won't add up to the rings above, which include Claude Code and claude.ai. Stopped or timed-out runs report no
tokens and are counted separately; runs from before this was added have no numbers.

## Connecting Gmail

NateBot uses the open-source [Google Workspace MCP server](https://github.com/taylorwilsdon/google_workspace_mcp)
(`workspace-mcp`, MIT licence, pinned to v1.29.0), run locally with `uvx` and limited to its Gmail tools. It is
actively maintained and can read, search, draft and label mail.

Google's own Gmail MCP server is not used. It is currently a Developer Preview that needs an invitation, and it
cannot send, so approved replies wouldn't be possible.

Your mail goes directly between your Mac and Google. Nothing passes through any other server.

### 1. Install uv

```bash
brew install uv
```

(Or `curl -LsSf https://astral.sh/uv/install.sh | sh`.)

### 2. Create a Google OAuth client (one time, ~5 minutes)

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project (e.g. "NateBot").
2. **APIs & Services → Library** → search **Gmail API** → **Enable**.
3. **Google Auth Platform** (or **OAuth consent screen**):
   - **Branding:** app name "NateBot", your email as the support and contact email.
   - **Audience:** User type **External**. Under **Test users**, add your own Gmail address.
4. **Clients** (or **Credentials → Create credentials → OAuth client ID**):
   - Application type: **Desktop app**, name "NateBot" → **Create**.
   - Copy the **Client ID** (ends in `.apps.googleusercontent.com`) and the **Client secret**.

### 3. Connect in NateBot

**Settings → Connected tools → Connect Gmail…** (or click "Connect Gmail" in the Email Agent chat):

1. Enter your Gmail address, the client ID and the client secret, then click **Connect**.
2. The first time, the connector downloads (about a minute). Your browser then opens Google's sign-in page.
3. Choose your account. Google warns that the app isn't verified, because it's your own private app: click
   **Continue**.
4. Allow the requested Gmail access.
5. Back in NateBot you'll see **✓ Connected**.

Then open the **Email Agent** and try: *"Do my morning inbox sweep."*

The consent screen lists sending among the permissions. That's what makes **Approve** work. In normal runs NateBot
blocks the send, filter and label tools, so they only ever run after you approve a specific action.

**Staying signed in.** While your Google app is in *Testing* status, Google expires the sign-in about once a
week, so you'd need to click **Connect Gmail** again. To avoid that, go to **Google Auth Platform → Audience →
Publish app**. It's still private to you (it just stays unverified). If Google changes these rules, reconnecting
is always a one-click fix.

The resulting entry in `~/NateBot/mcp.json` looks like this (written for you by the Connect button):

```json
{
  "mcpServers": {
    "gmail": {
      "command": "uvx",
      "args": ["workspace-mcp==1.29.0", "--single-user", "--tools", "gmail", "--tool-tier", "extended"],
      "env": {
        "GOOGLE_OAUTH_CLIENT_ID": "…apps.googleusercontent.com",
        "GOOGLE_OAUTH_CLIENT_SECRET": "…",
        "USER_GOOGLE_EMAIL": "you@gmail.com",
        "OAUTHLIB_INSECURE_TRANSPORT": "1",
        "WORKSPACE_MCP_CREDENTIALS_DIR": "/Users/you/NateBot/credentials/google"
      },
      "description": "Gmail (you@gmail.com): read, search, draft. Sending needs your approval.",
      "agent_notes": "The Gmail account is you@gmail.com. …",
      "require_approval": ["send_gmail_message", "manage_gmail_filter", "manage_gmail_label",
                           "modify_gmail_message_labels", "batch_modify_gmail_message_labels"]
    }
  }
}
```

(`OAUTHLIB_INSECURE_TRANSPORT=1` only allows the sign-in redirect to `http://localhost` on your own Mac.)

## Adding MCP servers

Add servers to `~/NateBot/mcp.json` in the same format Claude Code uses (`command`/`args`/`env` for local
servers, or `type`/`url` for remote ones). NateBot reloads the file automatically. Each server then appears
as a checkbox in every agent's settings, and an agent only ever sees the servers it has ticked.

NateBot adds three optional keys of its own, which are stripped before Claude Code sees the config:

| Key | Meaning |
|---|---|
| `description` | Shown next to the checkbox in the app |
| `agent_notes` | Added to the system prompt of agents using the server (e.g. which account to use) |
| `require_approval` | Tool names that are blocked in normal runs and can only run via **Approve** |

If a server needs an interactive login, do that once outside NateBot so its token is stored, as the Gmail
Connect button does.

## Known limitations

- **Routines only run while NateBot is running** (window open or in the menu bar) **and the Mac is awake.**
  A run missed in the last 12 hours is caught up once on launch or wake; older ones are skipped. Turn on
  Launch at login. To run at exact times with the lid closed, schedule a wake: `sudo pmset repeat wakeorpoweron MTWRF 07:55:00`.
- **Shared usage limit.** Agents use the same 5-hour and weekly limits as your own Claude Code use. Haiku uses
  the least. Several agents can run at once (up to 3), which uses the limit faster.
- **Personal use only.** NateBot drives your personal Claude subscription on your own Mac. Don't share it with
  others or run it as a service for other people.
- **Unsigned app.** It is signed ad hoc, not with an Apple Developer ID and not notarised (see Install).
- **Gmail token.** The Gmail sign-in expires weekly while your Google app is in Testing (see above).
- Remote (HTTP) MCP servers that need their own OAuth login may not work in headless runs. Prefer local (stdio)
  servers.

## Troubleshooting

- **Setup screen says Claude Code wasn't found.** Run `which claude` in Terminal and paste the path in
  **Settings → Path to the claude program** (or on the setup screen), then **Re-check**.
- **"Not logged in."** Run `claude auth login` in Terminal and choose your Claude account.
- **An agent errors immediately.** The error text appears in the chat. There's more detail in
  `~/Library/Logs/NateBot/main.log`.
- **Gmail connect fails.** Check that uv is installed (`uvx --version`), that you created a *Desktop app*
  client, and that your address is listed as a test user. Then try again.
- **Start completely fresh.** Quit NateBot and move `~/NateBot` to the Trash. The starter agents come back on
  next launch.

## Project layout

```
src/shared/     types, IPC contract, schedule <-> cron helpers
src/main/       Electron main process
  claude/         prompt, process spawning, stream-json parsing
  engine.ts       per-agent queues, runs, approvals, group chat turns
  rooms.ts        group chats: turn order, @mentions, per-room sessions
  backend.ts      API used by the UI
  agents.ts       YAML agent store       db.ts       SQLite (node:sqlite)
  mcp.ts          mcp.json + per-run configs   gmail.ts   Connect Gmail flow
  env.ts          PATH / claude detection      scheduler.ts, tray.ts, usage.ts
src/preload/    minimal contextBridge API (no Node access in the UI)
src/renderer/   React + Tailwind UI
build/          icon sources, .icns
```

Tech: Electron 44, React 19, TypeScript (strict), Vite via electron-vite, Tailwind 4, node:sqlite, node-cron,
electron-builder.
