# Features

The full reference. For short click-by-click steps, open **Guide** in the app (sidebar menu, or ⌘/).

## Agents

Add agents with **+** in the sidebar. You can start from a template (Straight Talk, Study Buddy, Weekly Review, Budget
Buddy, Fitness Coach, Travel Planner), each set up to be light on your limit (Haiku or low effort, only the tools it
needs), or from blank. Straight Talk is a brutally honest mentor, manager and sounding board: verdict first, reasoning
you can check, one next step, and a log of your commitments in its memory.md. It starts with the folders your other
agents read, and drops the bluntness and points you to Samaritans (116 123) if you mention a crisis. Edit one with the sliders button in the chat header. Each agent is a YAML
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
quick_prompts:         # one-click messages (up to 6): buttons above the message box and in the menu bar
  - Give me a summary of my emails
routines:              # up to 20, each with its own schedule
  - id: main
    enabled: true
    cron: "0 8 * * 1-5"
    prompt: "Do my morning inbox sweep."
  - id: evening
    enabled: true
    cron: "0 19 * * 1-5"
    prompt: "Anything new since this morning that needs me?"
session_id: null       # managed by NateBot (memory)
```

Models are pinned to full names (Sonnet 5.5, Opus 5.5, Haiku 4.5; see `MODEL_IDS` in `src/shared/types.ts`), so an
agent doesn't change model when an alias moves on. Effort defaults to medium for new agents and can be changed
per agent or in Settings → Defaults. Agents without an `effort` line in their YAML run at medium.

**Settings → General → About you** is a short profile (up to 1,200 characters) every agent reads, along with your
name: what you study or do, where you live, goals, how you like answers. It doesn't change between messages, so it
stays in the prompt cache; editing it costs one cache miss per agent.

Every agent also gets a shared NateBot house style: be concise, use ✓ checklists for status, and never take
irreversible actions without approval.

- **Folders it can read:** in an agent's settings, **Add folder…** gives it read-only access to a folder on your Mac,
  for example a career-plans folder. NateBot passes it with `--add-dir` and denies Edit/Write inside it, so the agent can
  read and search it but never change it. The agent is told to start with the folder's README and read only what it
  needs. A newly created Job Hunter or Morning Brief gets the folders your other agents already read.
- **Folders:** group agents and group chats in the sidebar. Create one with the folder button at the top, then
  drag chats onto it or right-click a chat → **Move to**. Click a folder's name to collapse it, **+** to create an
  agent inside it, and **…** to rename or delete it (its chats move to *No folder*).
- **Sidebar menu:** Today, Jobs, Marketplace and the Guide live in a tray at the bottom of the sidebar. Click the
  four-squares button next to your name to unfold it; it folds away again once you pick something, click elsewhere or
  press Esc. A dot on the button means approvals are waiting.
- **Guide:** every feature with a few short steps, searchable (sidebar menu → **Guide**, or **⌘/**). Many have a button
  that opens the right screen. Typing in ⌘K also lists matching how-tos. The content is in
  `src/renderer/src/lib/guide.ts`; add an entry there when you add a feature.
- **Command palette:** press **⌘K** anywhere in the window to jump to a chat or screen, start a new agent or group
  chat, or send any agent's quick prompt. Type to filter, use ↑/↓ and Enter, and Esc to close.
- **Quick capture:** press **⌥ Space** in any app (or choose **Message an agent…** in the menu-bar menu) to open a
  small box over what you're doing. Type and press Enter to send it to the agent shown. **Tab** switches agent, or
  start with `@planner`. If you've copied text or an image (like a screenshot), click **+ Clipboard** to send it along. Esc closes the box,
and you're back in the app you were using. The reply arrives as a
  notification. Change or turn off the shortcut in **Settings → General → Quick capture**. If another app already
  uses the shortcut, Settings says so.
- **Share to NateBot:** `natebot://capture?text=…&agent=…` opens the quick-capture box pre-filled. It never sends by
  itself; you press Enter. To get **Send to NateBot** in the Share menu of Safari, Mail and other apps, make a shortcut in
  the Shortcuts app: turn on *Show in Share Sheet* (receiving Text, URLs and Safari web pages), add **URL Encode**
  (Shortcut Input), then **Open URLs** with `natebot://capture?text=` followed by the encoded text. Add `&agent=job-hunter`
  to pick an agent.
- **Reply tools:** hover over a reply to **Copy** it, **Listen** to it (read aloud in the voice and speed set in **Settings → Voice**, which skips macOS's novelty voices and prefers downloaded Premium voices), **Save…** it as a
  Markdown file (a cover letter, a plan), add it to Apple **Notes** (once connected), or **Pin** it. Pinned replies are listed under
  the pin button in the chat header; click one to jump to it.
- **Search:** the search box at the top of the sidebar filters chats by name and also searches the text of every
  message (yours and the agents', at least 2 characters). Click a result to open that chat at the message.
- **Composer:** Enter sends, Shift+Enter adds a new line, and **+** attaches one or more files: PDFs, images,
  documents (copied into the agent's workspace).
- **Quick prompts:** messages you send often (*"Give me a summary of my emails"*) can be saved in the agent's
  settings, one per line. They show as buttons above an empty message box, and under **Quick prompts** in the
  menu-bar icon's menu, where one click sends it without opening the window and the reply arrives as a notification.
- **Queueing:** messages sent while an agent is busy wait their turn.
- **Stop:** ends the current run and cancels anything queued.
- **Timeout:** runs time out after 15 minutes.
- **Reply to a message:** hover over a reply and click **Reply** to point the agent at it. It gets a short note quoting
  that message. Esc cancels.
- **Load older messages:** a chat shows its latest messages; scroll to the top and click **Load older messages**.
- **Clear chat:** the eraser button in a chat or group header (or ⌘K) empties it and starts a fresh session. Pinned
  replies and lasting notes stay. It's refused while the agent is working or an approved action is running.
- **Share an agent:** **Agent settings → Memory & removal → Share as a file** saves a `.natebot.json` with its
  instructions, routines and watches (never its memory, chats or folders). **+ → Import file…** adds one. An imported
  agent never gets tools by itself, and its routines, triggers and page watches start switched off.

## Today

**Today** (in the sidebar menu, ⇧⌘T, or the menu-bar menu) gathers what needs you across every agent:
proposed actions and handoffs waiting for your OK (with **Approve all** when there are several, after a confirmation
listing each one), reminders and routines due in the next day, and what routines found in the last day. At the top, **Your day** lists today's Google Calendar events and the tasks due from Google Tasks and Apple Reminders,
once those are connected. NateBot reads them directly, so this uses no Claude usage.

Below it, **Inbox** lists your Gmail conversations from the last three days (promotions and social left out), unread
ones marked with a dot. Mail from people comes first. Newsletters, job alerts, receipts and notifications (spotted from
mailing-list headers, no-reply style senders and Gmail's Updates tab) fold into one row you can open, with
**Mark all read**. Security alerts (sign-ins, password or phone changes) are never folded away. Click one to open it in Gmail, or hover for **Mark read**, **Archive** and **Ask** (opens your
email agent's chat with a message about that email started for you). NateBot reads Gmail with the Connect Gmail
sign-in, so the Inbox uses no Claude usage; Mark read and Archive are changes you click yourself. A badge
shows how many approvals are waiting. It's built from what NateBot already stores, so opening it uses no tokens.

## Morning brief

On **Today**, **Get a morning brief → Set up** creates a Morning Brief agent (Haiku, low effort, Gmail if connected,
one web search for the weather). Every day at 7:30 it writes a short brief: your day at a glance, schedule, tasks,
deadlines, emails that need you, and one suggestion. The brief shows at the top of Today.

Its routine prompt contains `{{today}}`, which NateBot fills in, just before the run, with today's calendar, tasks,
reminders, job deadlines and waiting approvals, so the agent doesn't spend tool calls fetching them, and `{{inbox}}`,
your recent Gmail (the same list as Today's Inbox). The brief reads email only from that list, so it doesn't load the
Gmail connector at all.

`{{today}}` and `{{inbox}}` work in any message, quick prompt, routine or reminder task. In the chat they show as a
small "+ Today's agenda" / "+ Inbox" tag instead of the placeholder.

**Email questions are cheaper automatically.** When you ask an agent that has Gmail about your email (a message or
routine mentioning email, mail, inbox or unread), NateBot attaches the inbox list itself. The agent answers in one turn
instead of paging through Gmail with tool calls, each of which re-reads the whole conversation: a typical "Give me a
summary of my emails" went from 90k–120k tokens to about 28k. It can still open a message (by its id) when it needs the
full text.

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

### Career Board

A ready-made group for your long-term career plan. In **New group chat**, **Career Board → Set up** creates four
agents and a group that holds them:

| Member | Lens |
|---|---|
| **Skeptic** | Attacks the premise: destination, route, weakest assumption, the strongest alternative |
| **Recruiter** | Reads you as a future CV for the plan's target companies and city: would they interview and sponsor you? |
| **Staff Engineer** | Technical substance: real depth or a tool tour, and skills AI can't already replicate |
| **Auditor** | What your logs show against what you say: hours, gaps that haven't moved, deadlines at risk |

They read (never change) the folders your other agents already read, or the board asks you to pick your plan folder.
They're told to be brutally honest: verdict first, weakest point first, no praise, and not to agree with each
other to be polite. Bring them a decision and each judges it against the plan (what it builds or costs, a verdict,
and what evidence would change it), and they keep a short decision log in their `memory.md`. They run on Sonnet at
low effort with up to 6 replies per message, so each message costs about four to six runs. The members are in
`src/main/board.ts`; edit them like any other agent afterwards.

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
  A check runs just before the tool call: if anything differs from what you approved (another recipient, a reworded
  body) or the tool is called a second time, NateBot blocks the call and the card says why
  (`resources/approval-guard.cjs`).
- **Edit** lets you change the details before you approve.
- **Reject** tells the agent not to do it.

You don't have to open the app: the **Needs your approval** notification has **Approve** and **Reject** buttons
when there's a single action. It names the tool and shows the key details (recipients, subject, date), never the
message body, so click it to read or edit the full card first. If the action has any other detail the
notification can't show, or there are several actions, it has no buttons and just opens the chat. Approving or rejecting in the app removes the notification, and you get a **Done** or
**Action failed** notification when an approved action finishes while NateBot isn't in front. Buttons only work
while NateBot is still running from when the notification arrived.

**Always allow:** if you trust a tool for one agent (say, adding Google Tasks), click **Always allow** on its card.
Its later proposals for that tool are approved automatically. They're listed in the agent's settings under **Approved
without asking**, where you can remove one to be asked again.

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

Add a routine under **Routines** in an agent's settings. Pick "Weekdays at 8:00 AM" (or write your own cron) and
say what it should do. An agent can have up to 20, for example a morning and an evening inbox sweep. The
**Routines & reminders** view (clock icon, ⇧⌘R) lists every routine with its next run, last result, an on/off
toggle and **Run now**. Older agent files with a single `routine:` key still work and are rewritten as
`routines:` the next time NateBot saves them. You get a macOS notification when a routine finishes or an agent needs your approval. When a routine (or a task
reminder) finds nothing that needs you, like an inbox sweep with nothing new, the agent marks its reply quiet: it
still appears in the chat, but there's no notification and no unread badge.

Routines fire while NateBot is running and the Mac is awake. If one was missed in the last 12 hours (the Mac was
asleep or NateBot was quit), it runs once when NateBot starts or the Mac wakes, and the chat says so: *Routine ran
at 9:14 AM (it was due at 8:00 AM)*. Only the latest missed time runs, never a backlog. A time missed by more than 12 hours
is skipped, and the chat says so (*Routine didn't run on Friday 7:00 PM…*), so you can run it from Routines. A new or changed schedule
starts counting from when you save it.

## Reminders

Ask any agent to remind you about something: *"remind me at 7pm to call Mum"*, *"tomorrow at 8:30 check
whether Sarah replied"*. The agent confirms in a sentence and its reply shows a **reminder card** with the time.
Reminders are set straight away. Click **Cancel** on the card (or in **Routines & reminders**) to stop one.

- **Message reminders** post the agent's text in the chat at that time, with a notification. They don't run
  Claude, so they cost nothing.
- **Task reminders** run the agent at that time with the task as its prompt (for example checking your inbox),
  using the same tools and approvals as any other message. The agent picks this kind only when the moment needs
  fresh work.
- **Repeating reminders:** "every weekday at 10pm remind me to prep tomorrow" sets a reminder that repeats daily, on
  weekdays or weekly. After going off it moves to its next time, and Cancel ends the series. For repeating work that
  needs more than a nudge, use a routine.
- Like routines, they go off while NateBot is running and the Mac is awake. A message reminder that was missed
  shows up as soon as NateBot starts or the Mac wakes. A task more than 12 hours late is skipped and the chat says so; a repeating one carries on from its next time.
- Limits: 5 per reply, 20 waiting per agent, up to a year ahead. Group chats can't set reminders.

Reminders are stored in `~/NateBot/data.db` (table `reminders`). The logic is in `src/main/reminders.ts`.

## Email triggers

An agent with Gmail can react to new email instead of waiting for its routine. In its settings, under **Email
triggers**, add a Gmail search (for example `subject:(interview OR assessment)`) and say what it should do. NateBot
checks Gmail itself every 5 minutes through the Gmail API, using your Connect Gmail sign-in, so **waiting costs no
Claude usage**. Only when new mail matches does the agent run once, in a light session, with the sender, subject and
preview of the matching emails, which are framed as data, never instructions. You get a **New email** notification
with its answer.

- One-click presets: **Security alerts** (Google, Microsoft and Instagram sign-in warnings), **Interviews &
  assessments**, **Bills & renewals**.
- A trigger's first check only records what's already there, so turning one on never fires on old mail. Changing
  the search starts it over.
- At most 10 runs a day per trigger, up to 3 triggers per agent, and the weekly pause in Settings → Usage applies.
- Checks only happen while NateBot is running.

## Page watches

An agent can watch a web page, for example a careers page, and run only when it changes. In its settings, under **Page
watches**, add the address, how often to check, optional words the new text must mention, and what to do. NateBot fetches
the page itself, so **waiting costs no Claude usage**. The first check only records what's there. At most 4 runs a day
per watch, and the weekly pause in Settings → Usage applies.

## Jobs

**Jobs** (sidebar, ⇧⌘J) tracks roles and applications: to apply, applied, interviewing, offer, closed. Click
**Create Job Hunter** to add an agent on Haiku that checks Gmail each weekday at 8:30 and straight away when an
interview or assessment email arrives (an email trigger). It adds or updates entries with a ` ```jobs ` block, which
any agent can use. You can change a status or deadline, or remove an entry, on the Jobs screen. Roles still "to apply"
with a deadline get message reminders 2 days before and on the day at 9:00, which cost nothing.

## Avatars

Each agent gets a mascot (a coloured shape with a small face) generated from its name, so it always looks
the same. You can pick a different shape and colour in the agent's settings.

To use a photo instead, click any avatar (in the chat header, in agent settings, or your own at the bottom of the
sidebar) and choose **Choose picture…**. PNG, JPG and GIF work; the image is cropped to a square and resized to
256px, and a GIF keeps its first frame. **Reset to default** goes back to the mascot (or your initials).

## Skills marketplace

**Marketplace** (in the sidebar menu) lets you browse [Agent Skills](https://github.com/anthropics/skills)
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

## Quiet hours

**Settings → General → Quiet hours** (for example 22:30–07:30) holds notifications overnight, phone ones included.
When quiet hours end you get one **While you were away** summary ("2 replies · routine finished · 1 needs your
approval"), and clicking it opens Today. Reminders you set still ring on time.

## Phone notifications

**Settings → General → Phone notifications → Set up** makes a private topic name. Install the free
[ntfy](https://ntfy.sh) app on your phone and subscribe to that topic: every NateBot notification (replies, routines,
reminders, approvals, new email) then also reaches your phone through ntfy.sh. By default only the title is sent
(for example "Planner · Reminder"). Turn on **Include message text** for the full text. Anyone who knows the topic
name can read it, so keep it private. **Send test** checks the setup.

**Message agents from your phone** (same settings row, off by default): NateBot listens on `<your topic>-in`. In ntfy,
subscribe to that topic too and send messages to it: `@planner move gym to 8` goes to the Planner, and plain text goes to
the agent you used most recently. The reply comes back as a phone notification (message text is turned on for this).
Anyone with the topic name could message your agents, so keep it private. Agents still can't send, delete or pay
without your approval in NateBot.

NateBot also checks the Gmail sign-in every few hours (no tokens) and warns you, once a day, if it has expired.
