// Everything NateBot can do, with short steps for each. Shown on the Guide screen.
// Steps use **bold** for things you click or see, and `code` for keys and text you type.
// When a feature is added or changed, add or update its entry here.

/** A screen or dialog the Guide's "Take me there" button can open. */
export type GuideTarget = 'today' | 'jobs' | 'routines' | 'settings' | 'marketplace' | 'newAgent' | 'newRoom' | 'palette'

export interface GuideFeature {
  id: string
  title: string
  /** One line: what it is and why you'd use it. */
  summary: string
  steps: string[]
  /** Optional extra worth knowing (cost, limits, a shortcut). */
  tip?: string
  go?: GuideTarget
  /** Extra words people might search for. */
  keywords?: string
}

export interface GuideCategory {
  id: string
  title: string
  features: GuideFeature[]
}

export const GUIDE: GuideCategory[] = [
  {
    id: 'start',
    title: 'Getting started',
    features: [
      {
        id: 'chat',
        title: 'Chat with an agent',
        summary: 'Each contact in the sidebar is an AI agent with its own job. Talk to it like a messaging app.',
        steps: [
          'Click an agent in the sidebar.',
          'Type in the message box at the bottom.',
          'Press `Enter` to send, or `Shift+Enter` for a new line.',
          'Send more while it works: messages wait their turn.'
        ],
        keywords: 'message send talk ask'
      },
      {
        id: 'new-agent',
        title: 'Create an agent',
        summary: 'Start from a ready-made template (Straight Talk, Study Buddy, Budget Buddy…) or a blank agent.',
        steps: [
          'Click **+** at the top of the sidebar, or press `⌘N`.',
          'Pick a template, or **Blank**.',
          'Give it a name and say what it does under **Instructions**.',
          'Click **Create agent**.'
        ],
        tip: 'Templates are set up to be light on your limit: Haiku or low effort, and only the tools they need.',
        go: 'newAgent',
        keywords: 'add template blank new'
      },
      {
        id: 'edit-agent',
        title: 'Change an agent’s settings',
        summary: 'Rename it, change what it does, or pick a different model.',
        steps: [
          'Open the agent’s chat.',
          'Click the **sliders** button in the chat header.',
          'Change anything, then click **Save**.'
        ],
        tip: 'New instructions apply from the next message.',
        keywords: 'edit rename instructions configure drawer'
      },
      {
        id: 'model-effort',
        title: 'Pick a model and effort',
        summary: 'Haiku uses the least of your limit, Opus the most. Lower effort thinks less and costs less.',
        steps: [
          'Open the agent’s settings (**sliders** button).',
          'Choose **Model**: Haiku, Sonnet or Opus.',
          'Choose **Effort**: low to max.',
          'Click **Save**.'
        ],
        tip: 'Set the defaults for new agents in **Settings → Defaults**.',
        keywords: 'haiku sonnet opus thinking cheap'
      },
      {
        id: 'about-you',
        title: 'Tell every agent about you',
        summary: 'A short profile all agents read: what you do, where you live, goals, how you like answers.',
        steps: [
          'Open **Settings**.',
          'Under **General**, fill in **Your name** and **About you**.',
          'It saves as you type.'
        ],
        tip: 'Up to 1,200 characters.',
        go: 'settings',
        keywords: 'profile name bio personal'
      },
      {
        id: 'avatars',
        title: 'Change a picture or mascot',
        summary: 'Give an agent (or yourself) a photo, or pick a different mascot shape and colour.',
        steps: [
          'Click any avatar: in the chat header, in agent settings, or yours at the bottom of the sidebar.',
          'Choose **Choose picture…** and pick a PNG, JPG or GIF.',
          'For a mascot instead, pick a shape and colour in the agent’s settings.',
          '**Reset to default** brings back the mascot or your initials.'
        ],
        keywords: 'photo image avatar shape colour color'
      },
      {
        id: 'import-agent',
        title: 'Import a shared agent',
        summary: 'Add an agent someone saved as a .natebot.json file.',
        steps: [
          'Click **+** at the top of the sidebar.',
          'Click **Import file…** and choose the file.',
          'Check the settings it filled in, then click **Create agent**.'
        ],
        tip: 'Imported agents never get tools by themselves, and their routines, triggers and page watches start off.',
        go: 'newAgent',
        keywords: 'share json file load'
      }
    ]
  },
  {
    id: 'chats',
    title: 'In a chat',
    features: [
      {
        id: 'attach',
        title: 'Attach files',
        summary: 'Send PDFs, images or documents for the agent to read.',
        steps: ['Click **+** next to the message box.', 'Pick one or more files.', 'Type your question and press `Enter`.'],
        tip: 'Files are copied into the agent’s own folder. Up to 50 MB each.',
        keywords: 'pdf image document upload paperclip'
      },
      {
        id: 'quick-prompts',
        title: 'Quick prompts',
        summary: 'One-click buttons for messages you send often, like “Give me a summary of my emails”.',
        steps: [
          'Open the agent’s settings (**sliders** button).',
          'Under **Quick prompts**, write one per line (up to 6).',
          'Click **Save**.',
          'Click a prompt button above the empty message box to send it.'
        ],
        tip: 'They’re also in the menu-bar menu and ⌘K, where the reply arrives as a notification.',
        keywords: 'shortcut button saved message'
      },
      {
        id: 'reply-to',
        title: 'Reply to a specific message',
        summary: 'Point the agent at one earlier reply, so it knows exactly what you mean.',
        steps: ['Hover over the agent’s reply.', 'Click **Reply**.', 'Type your message and press `Enter`.'],
        tip: 'Press `Esc` to cancel the reply.',
        keywords: 'quote thread respond'
      },
      {
        id: 'copy',
        title: 'Copy a reply',
        summary: 'Copy an agent’s answer to paste somewhere else.',
        steps: ['Hover over the reply.', 'Click **Copy**.'],
        keywords: 'clipboard paste'
      },
      {
        id: 'listen',
        title: 'Listen to a reply',
        summary: 'Have a reply read aloud.',
        steps: ['Hover over the reply.', 'Click **Listen**.', 'Click **Stop** to end it early.'],
        tip: 'Pick the voice and speed in **Settings → Voice**.',
        keywords: 'speak read aloud voice audio tts'
      },
      {
        id: 'save-reply',
        title: 'Save a reply as a file',
        summary: 'Keep a cover letter, plan or summary as a Markdown file.',
        steps: ['Hover over the reply.', 'Click **Save…**.', 'Choose where to save it.'],
        keywords: 'export markdown download file'
      },
      {
        id: 'notes',
        title: 'Add a reply to Apple Notes',
        summary: 'Send a reply straight into the Notes app.',
        steps: [
          'Connect **Apple Reminders & Notes** first (see Connections).',
          'Hover over the reply.',
          'Click **Notes**.'
        ],
        keywords: 'apple notes save'
      },
      {
        id: 'pin',
        title: 'Pin replies',
        summary: 'Keep important replies one click away. Pinned replies survive Clear chat.',
        steps: [
          'Hover over the reply and click **Pin**.',
          'Click the **pin** button in the chat header to see pinned replies.',
          'Click one to jump to it.'
        ],
        keywords: 'bookmark save favourite'
      },
      {
        id: 'stop',
        title: 'Stop an agent',
        summary: 'End the current run and cancel anything queued.',
        steps: ['While the agent is working, click the **stop** button where Send usually is.'],
        tip: 'Runs also time out by themselves after 15 minutes.',
        keywords: 'cancel abort halt queue'
      },
      {
        id: 'older',
        title: 'Load older messages',
        summary: 'See further back in a long chat.',
        steps: ['Scroll to the top of the chat.', 'Click **Load older messages**.'],
        keywords: 'history scroll back'
      },
      {
        id: 'clear-chat',
        title: 'Clear a chat',
        summary: 'Start a chat over. Pinned replies and lasting notes stay.',
        steps: ['Open the chat.', 'Click the **eraser** button in the chat header.', 'Confirm with **Clear chat**.'],
        tip: 'Also in ⌘K. You can’t clear a chat while the agent is working.',
        keywords: 'erase delete reset wipe empty'
      },
      {
        id: 'tokens',
        title: 'Add your agenda or inbox to a message',
        summary: 'Write {{today}} or {{inbox}} and NateBot fills in your day or recent Gmail before sending.',
        steps: [
          'Type `{{today}}` for today’s calendar, tasks, reminders and deadlines.',
          'Type `{{inbox}}` for your recent Gmail.',
          'Send as usual. The chat shows a small tag instead of the placeholder.'
        ],
        tip: 'Works in messages, quick prompts, routines and reminder tasks, and saves the agent fetching it with tools.',
        keywords: 'placeholder variable template calendar email'
      },
      {
        id: 'search',
        title: 'Search chats and messages',
        summary: 'Find any chat by name, or any message by its text.',
        steps: [
          'Type in the search box at the top of the sidebar (at least 2 characters).',
          'Click a result to open that chat at the message.'
        ],
        keywords: 'find filter look up'
      }
    ]
  },
  {
    id: 'organise',
    title: 'Getting around',
    features: [
      {
        id: 'launcher',
        title: 'Open the sidebar menu',
        summary: 'Today, Jobs, Marketplace and this Guide sit in a menu at the bottom of the sidebar.',
        steps: [
          'Click the **four-squares** button next to your name.',
          'Pick a tile.',
          'Click the button again, or press `Esc`, to tuck it away.'
        ],
        tip: 'A dot on the button means approvals are waiting on Today.',
        keywords: 'menu hamburger navigation tiles'
      },
      {
        id: 'palette',
        title: 'Command palette',
        summary: 'Jump to any chat or screen, start a new agent, or send a quick prompt from the keyboard.',
        steps: ['Press `⌘K` anywhere.', 'Type to filter.', 'Use `↑` `↓` and `Enter` to pick, `Esc` to close.'],
        go: 'palette',
        keywords: 'keyboard jump search command'
      },
      {
        id: 'folders',
        title: 'Sort chats into folders',
        summary: 'Group agents and group chats in the sidebar.',
        steps: [
          'Click the **folder** button at the top of the sidebar and name it.',
          'Drag chats onto it, or right-click a chat → **Move to**.',
          'Click a folder’s name to collapse it.',
          'Use **…** on a folder to rename or delete it, or **+** to create an agent inside.'
        ],
        tip: 'Deleting a folder keeps its chats: they move to No folder.',
        keywords: 'group organise organize sidebar'
      },
      {
        id: 'shortcuts',
        title: 'Keyboard shortcuts',
        summary: 'The quickest ways around NateBot.',
        steps: [
          '`⌘K` command palette · `⌘N` new agent · `⇧⌘N` new group chat',
          '`⇧⌘T` Today · `⇧⌘J` Jobs · `⇧⌘R` Routines · `⌘,` Settings',
          '`⌘/` this Guide · `⌥Space` quick capture from any app'
        ],
        keywords: 'keys hotkeys keyboard'
      }
    ]
  },
  {
    id: 'groups',
    title: 'Group chats',
    features: [
      {
        id: 'new-group',
        title: 'Start a group chat',
        summary: 'Put 2–6 agents in one room and let them talk to each other.',
        steps: [
          'Click the **people** button at the top of the sidebar, or press `⇧⌘N`.',
          'Name the group and pick its members.',
          'Choose the **max replies per message**.',
          'Click **Create group**, then send a message: everyone replies in turn.'
        ],
        tip: 'Every agent reply is one run, so pick Haiku agents for chatty groups.',
        go: 'newRoom',
        keywords: 'room team multiple agents'
      },
      {
        id: 'mention',
        title: 'Ask one member first',
        summary: '@mention an agent in a group so it answers first.',
        steps: [
          'In a group chat, type `@`.',
          'Pick a member from the list.',
          'Finish your message and send. Others only chime in if they can add something.'
        ],
        keywords: 'mention at tag'
      },
      {
        id: 'edit-group',
        title: 'Change a group',
        summary: 'Add or remove members, rename it, or change how many replies it may make.',
        steps: ['Open the group chat.', 'Click the **settings** button in its header.', 'Make your changes and save.'],
        keywords: 'members edit room'
      },
      {
        id: 'career-board',
        title: 'Career Board',
        summary: 'A ready-made group of four brutally honest advisers who judge decisions against your career plan.',
        steps: [
          'Click the **people** button at the top of the sidebar.',
          'Under **Career Board**, click **Set up**.',
          'Pick your plan folder if asked.',
          'Bring it a decision and read each verdict.'
        ],
        tip: 'Skeptic, Recruiter, Staff Engineer and Auditor only ever read your plan folder, never change it.',
        go: 'newRoom',
        keywords: 'advisers board career plan'
      }
    ]
  },
  {
    id: 'approvals',
    title: 'Approvals & safety',
    features: [
      {
        id: 'approve',
        title: 'Approve, edit or reject an action',
        summary: 'Agents never send, delete or pay on their own. They propose it and wait for you.',
        steps: [
          'An agent’s reply shows a card with the proposed action.',
          'Click **Edit** to change the details if you need to.',
          'Click **Approve** to do it, or **Reject** to tell the agent not to.'
        ],
        tip: 'An approved action can only use that one tool, with exactly the details you saw.',
        keywords: 'proposal permission confirm send email'
      },
      {
        id: 'always-allow',
        title: 'Always allow a tool',
        summary: 'Stop being asked for a tool you trust, for one agent.',
        steps: [
          'On an action card, click **Always allow** and confirm.',
          'To undo it, open the agent’s settings.',
          'Under **Approved without asking**, remove the tool.'
        ],
        keywords: 'auto approve trust skip'
      },
      {
        id: 'approve-notification',
        title: 'Approve from a notification',
        summary: 'Say yes or no without opening the app.',
        steps: [
          'When **Needs your approval** pops up, hover over it.',
          'Click **Approve** or **Reject**.',
          'Click the notification itself to read the full card first.'
        ],
        tip: 'Buttons only appear for a single action whose details fit in the notification.',
        keywords: 'notification macos banner'
      },
      {
        id: 'approve-all',
        title: 'Approve everything at once',
        summary: 'Clear every waiting approval across all agents in one go.',
        steps: ['Open **Today**.', 'Under **Needs your OK**, click **Approve all**.', 'Check the list and confirm.'],
        go: 'today',
        keywords: 'bulk batch all'
      },
      {
        id: 'handoff',
        title: 'Hand a task to another agent',
        summary: 'An agent can suggest passing work on, like the Email Agent asking the Planner to block time.',
        steps: [
          'A **Hand off** card shows who gets the task and exactly what they’ll be told.',
          'Click **Hand off** to send it, or **Dismiss**.',
          'The other agent works on it in its own chat.'
        ],
        keywords: 'delegate pass transfer'
      },
      {
        id: 'advanced-tools',
        title: 'Allow or block specific tools',
        summary: 'Fine-tune exactly which tools an agent may or may never use.',
        steps: [
          'Open the agent’s settings.',
          'Click **Advanced tool permissions**.',
          'Fill in **Always allowed tools** or **Never allowed tools**, then **Save**.'
        ],
        keywords: 'permissions bash block deny'
      }
    ]
  },
  {
    id: 'automation',
    title: 'Routines & automation',
    features: [
      {
        id: 'routines',
        title: 'Run an agent on a schedule',
        summary: 'Routines run an agent automatically, like a weekday-morning inbox sweep.',
        steps: [
          'Open the agent’s settings.',
          'Under **Routines**, click **Add**.',
          'Pick when (for example weekdays at 8:00) and say what it should do.',
          'Click **Save**.'
        ],
        tip: 'Up to 20 per agent. When there’s nothing to report, the reply arrives quietly, with no notification.',
        keywords: 'schedule cron recurring automatic'
      },
      {
        id: 'routines-screen',
        title: 'See and run all routines',
        summary: 'One list of every routine and reminder, with next run, last result and history.',
        steps: [
          'Click the **clock** button next to your name, or press `⇧⌘R`.',
          'Use the switch to turn a routine on or off.',
          'Click **Run now** to run it straight away.',
          'Click a routine’s last result to see its recent runs.'
        ],
        go: 'routines',
        keywords: 'history run now toggle'
      },
      {
        id: 'missed',
        title: 'Missed routines catch up',
        summary: 'If your Mac was asleep or NateBot was closed, the latest missed run happens when it’s back.',
        steps: [
          'Nothing to do: it happens by itself within 12 hours of the missed time.',
          'Turn on **Settings → General → Launch at login** so NateBot is always running.'
        ],
        tip: 'Only the latest missed time runs, never a backlog.',
        go: 'settings',
        keywords: 'sleep asleep offline catch up'
      },
      {
        id: 'reminders',
        title: 'Set a reminder',
        summary: 'Ask any agent to remind you, or to do something later.',
        steps: [
          'Tell an agent, e.g. “remind me at 7pm to call Mum”.',
          'A **reminder card** shows the time.',
          'Click **Cancel** on the card (or in Routines) to stop it.'
        ],
        tip: 'Plain reminders cost nothing. “Check at 8:30 whether Sarah replied” runs the agent at that time.',
        keywords: 'remind alarm later task'
      },
      {
        id: 'repeating',
        title: 'Repeating reminders',
        summary: 'Reminders that repeat daily, on weekdays or weekly.',
        steps: [
          'Tell an agent, e.g. “every weekday at 10pm remind me to prep tomorrow”.',
          'It moves to its next time after each one.',
          'Click **Cancel** to end the series.'
        ],
        keywords: 'recurring daily weekly'
      },
      {
        id: 'email-triggers',
        title: 'React to new email',
        summary: 'Run an agent when matching email arrives, like an interview invite. Waiting costs nothing.',
        steps: [
          'Connect Gmail and give it to the agent.',
          'In the agent’s settings, under **Email triggers**, click **Add** or pick a preset.',
          'Write a Gmail search (e.g. `subject:interview`) and what it should do.',
          'Click **Save**.'
        ],
        tip: 'Presets: Security alerts, Interviews & assessments, Bills & renewals. Checked every 5 minutes.',
        keywords: 'gmail trigger watch inbox alert'
      },
      {
        id: 'page-watches',
        title: 'Watch a web page',
        summary: 'Get told when a page changes, like a careers page posting new roles.',
        steps: [
          'In the agent’s settings, under **Page watches**, click **Add**.',
          'Paste the **Page address** and choose how often to check.',
          'Optionally list words it must mention, and say what to do.',
          'Click **Save**.'
        ],
        tip: 'NateBot checks the page itself, so waiting costs nothing. The first check only records what’s there.',
        keywords: 'website monitor change rss jobs'
      }
    ]
  },
  {
    id: 'daily',
    title: 'Your day',
    features: [
      {
        id: 'today',
        title: 'Today',
        summary: 'Everything that needs you: approvals, what’s coming up, and what routines found.',
        steps: ['Open the sidebar menu and click **Today**, or press `⇧⌘T`.', 'Work through **Needs your OK** first.'],
        tip: 'Opening Today uses no Claude usage.',
        go: 'today',
        keywords: 'dashboard home overview'
      },
      {
        id: 'your-day',
        title: 'See your calendar and tasks',
        summary: 'Today’s events and tasks due, from Google Calendar, Google Tasks and Apple Reminders.',
        steps: [
          'Connect Google Calendar, Google Tasks or Apple Reminders (see Connections).',
          'Open **Today**: they’re under **Your day**.'
        ],
        go: 'today',
        keywords: 'agenda events schedule'
      },
      {
        id: 'inbox',
        title: 'Check your inbox',
        summary: 'Your last three days of Gmail on Today, people first, newsletters and alerts folded into one row.',
        steps: [
          'Connect Gmail.',
          'Open **Today** and scroll to **Inbox**.',
          'Click an email to open it in Gmail, or hover for **Mark read**, **Archive** or **Ask**.',
          'Open the folded row for newsletters and alerts, with **Mark all read**.'
        ],
        tip: '**Ask** starts a message about that email in your email agent’s chat. Reading the inbox costs nothing.',
        go: 'today',
        keywords: 'gmail email mail unread archive'
      },
      {
        id: 'morning-brief',
        title: 'Get a morning brief',
        summary: 'A short daily brief at 7:30: your day, tasks, deadlines, emails that need you, one suggestion.',
        steps: ['Open **Today**.', 'Under **Get a morning brief**, click **Set up**.', 'Read it at the top of Today each morning.'],
        go: 'today',
        keywords: 'brief summary daily morning'
      },
      {
        id: 'jobs',
        title: 'Track job applications',
        summary: 'Roles and applications by stage: to apply, applied, interviewing, offer, closed.',
        steps: [
          'Open the sidebar menu and click **Jobs**, or press `⇧⌘J`.',
          'Click **Create Job Hunter** to have it filled from your Gmail.',
          'Change a status or deadline right in the list, or remove an entry.'
        ],
        tip: 'Roles “to apply” with a deadline get free reminders 2 days before and on the day.',
        go: 'jobs',
        keywords: 'career applications tracker hunter'
      }
    ]
  },
  {
    id: 'connections',
    title: 'Connections',
    features: [
      {
        id: 'gmail',
        title: 'Connect Gmail',
        summary: 'Let agents read, search and draft email. Sending always needs your approval.',
        steps: [
          'Install uv (`brew install uv`) and make a Google OAuth client (see the README).',
          'Open **Settings → Connected tools → Connect Gmail…**.',
          'Enter your address, client ID and secret, then click **Connect**.',
          'Sign in to Google in the browser and allow access.'
        ],
        tip: 'Publish your Google app (Google Auth Platform → Audience) or the sign-in expires every week.',
        go: 'settings',
        keywords: 'google email oauth connect'
      },
      {
        id: 'calendar',
        title: 'Connect Google Calendar',
        summary: 'Let agents read events and free time. Creating or changing events needs your approval.',
        steps: [
          'Connect Gmail first.',
          'Enable the Google Calendar API in your Google Cloud project.',
          'Click **Settings → Connected tools → Connect Calendar…** and allow access.',
          'Tick **Google Calendar** in the agents that should use it.'
        ],
        go: 'settings',
        keywords: 'gcal events google'
      },
      {
        id: 'tasks',
        title: 'Connect Google Tasks',
        summary: 'Let agents read your task lists. Adding or completing tasks needs your approval.',
        steps: [
          'Connect Gmail first, and enable the Google Tasks API.',
          'Click **Settings → Connected tools → Connect Tasks…**.',
          'Tick it in the agents that should use it.'
        ],
        go: 'settings',
        keywords: 'todo google tasks'
      },
      {
        id: 'drive',
        title: 'Connect Google Drive & Docs',
        summary: 'Let agents search and read your files, like lecture notes or your CV.',
        steps: [
          'Connect Gmail first, and enable the Drive and Docs APIs.',
          'Click **Settings → Connected tools → Connect Drive…**.',
          'Tick it in the agents that should use it.'
        ],
        go: 'settings',
        keywords: 'files docs google drive'
      },
      {
        id: 'apple',
        title: 'Connect Apple Reminders & Notes',
        summary: 'Let agents read your reminders and notes. Creating them needs your approval.',
        steps: [
          'Click **Settings → Connected tools → Apple Reminders & Notes → Connect…**.',
          'Click **Allow** when macOS asks.',
          'Tick **apple** in the agents that should use it.'
        ],
        tip: 'Clicked Don’t Allow? Turn it on in System Settings → Privacy & Security → Automation → NateBot.',
        go: 'settings',
        keywords: 'icloud reminders notes mac'
      },
      {
        id: 'give-tools',
        title: 'Give an agent a connection',
        summary: 'An agent only sees the connections you tick for it.',
        steps: [
          'Open the agent’s settings.',
          'Under **Connected tools**, tick the ones it should use.',
          'Click **Save**.'
        ],
        keywords: 'mcp server tools assign'
      },
      {
        id: 'read-folders',
        title: 'Let an agent read a folder',
        summary: 'Read-only access to a folder on your Mac, like your career plans. It can never change it.',
        steps: [
          'Open the agent’s settings.',
          'Under **Folders it can read**, click **Add folder…**.',
          'Pick the folder, then click **Save**.'
        ],
        keywords: 'files folder access read only'
      },
      {
        id: 'mcp',
        title: 'Add other tools (MCP servers)',
        summary: 'Plug in any MCP server, the same way Claude Code does.',
        steps: [
          'Choose **File → Show Data Folder**.',
          'Add the server to `mcp.json`.',
          'Tick it in the agents that should use it.'
        ],
        tip: 'NateBot reloads mcp.json by itself.',
        keywords: 'mcp server json custom integration'
      },
      {
        id: 'skills',
        title: 'Install skills',
        summary: 'Add Agent Skills from the Marketplace. Every agent can use them.',
        steps: [
          'Open the sidebar menu and click **Marketplace**.',
          'Click **Add** on a skill. Hover over **Added** and click **Remove** to take it off.',
          'Use **+ Source** to browse another GitHub repo of skills.'
        ],
        tip: 'Skills are written by other people, so only add sources you trust.',
        go: 'marketplace',
        keywords: 'marketplace plugins install github'
      }
    ]
  },
  {
    id: 'mac',
    title: 'Anywhere on your Mac',
    features: [
      {
        id: 'capture',
        title: 'Quick capture',
        summary: 'Message an agent from any app without switching to NateBot.',
        steps: [
          'Press `⌥Space` in any app.',
          'Press `Tab` to switch agent, or start with `@planner`.',
          'Click **+ Clipboard** to send copied text or a screenshot along.',
          'Press `Enter` to send. The reply arrives as a notification.'
        ],
        tip: 'Change or turn off the shortcut in Settings → General → Quick capture.',
        keywords: 'shortcut global hotkey option space'
      },
      {
        id: 'menu-bar',
        title: 'Use the menu-bar icon',
        summary: 'NateBot keeps running in the menu bar when you close the window, so routines keep going.',
        steps: [
          'Click the little blob face in the menu bar.',
          'Open an agent, Today or Routines, or click a quick prompt to send it.',
          'Choose **Quit NateBot** to stop it completely.'
        ],
        keywords: 'tray menubar status bar'
      },
      {
        id: 'share',
        title: 'Send to NateBot from the Share menu',
        summary: 'Share text or a web page from Safari, Mail and other apps into quick capture.',
        steps: [
          'In the Shortcuts app, make a shortcut with **Show in Share Sheet** on.',
          'Add **URL Encode**, then **Open URLs** with `natebot://capture?text=` and the encoded text.',
          'Share something and pick your shortcut, then press `Enter` in NateBot.'
        ],
        tip: 'Add `&agent=job-hunter` to the link to pick an agent. It never sends by itself.',
        keywords: 'shortcuts share sheet safari link url'
      },
      {
        id: 'phone',
        title: 'Get notifications on your phone',
        summary: 'Every NateBot notification also reaches your phone through the free ntfy app.',
        steps: [
          'Open **Settings → General → Phone notifications** and click **Set up**.',
          'Install ntfy on your phone and subscribe to the topic shown.',
          'Click **Send test** to check it works.'
        ],
        tip: 'Only titles are sent unless you turn on Include message text. Keep the topic name private.',
        go: 'settings',
        keywords: 'ntfy iphone android push mobile'
      },
      {
        id: 'phone-in',
        title: 'Message agents from your phone',
        summary: 'Text your agents from ntfy and get the reply back as a notification.',
        steps: [
          'Set up phone notifications first.',
          'Turn on **Message agents from your phone**.',
          'In ntfy, subscribe to your topic with `-in` on the end and send to it.',
          'Start with `@planner` to pick an agent, or plain text goes to the last one you used.'
        ],
        go: 'settings',
        keywords: 'ntfy phone text remote'
      },
      {
        id: 'quiet-hours',
        title: 'Quiet hours',
        summary: 'Hold notifications overnight and get one “While you were away” summary in the morning.',
        steps: ['Open **Settings → General**.', 'Turn on **Quiet hours** and pick the times.'],
        tip: 'Reminders you set still ring on time.',
        go: 'settings',
        keywords: 'do not disturb night sleep notifications'
      },
      {
        id: 'launch-login',
        title: 'Launch at login',
        summary: 'Start NateBot quietly in the menu bar when you log in, so routines never miss.',
        steps: ['Open **Settings → General**.', 'Turn on **Launch at login**.'],
        go: 'settings',
        keywords: 'startup boot autostart'
      }
    ]
  },
  {
    id: 'memory',
    title: 'Memory & usage',
    features: [
      {
        id: 'lasting-notes',
        title: 'See what an agent remembers',
        summary: 'Each agent keeps lasting notes about you (people, preferences, commitments) across conversations.',
        steps: [
          'Open the agent’s settings.',
          'Scroll to **Memory & removal → Lasting notes**.',
          'Edit them if you like, then click **Save notes**.'
        ],
        tip: 'Or just tell the agent “remember that…”.',
        keywords: 'memory notes remember'
      },
      {
        id: 'reset-memory',
        title: 'Reset an agent’s memory',
        summary: 'Start a fresh conversation. Chat history and lasting notes stay.',
        steps: ['Open the agent’s settings.', 'Under **Memory & removal**, click **Reset** and confirm.'],
        keywords: 'forget fresh session'
      },
      {
        id: 'usage-rings',
        title: 'Check your usage',
        summary: 'The rings at the top of the sidebar show your 5-hour (outer) and weekly (inner) limits.',
        steps: [
          'Look at the rings next to **+**: they turn amber at 60% and red at 85%.',
          'Click them for exact numbers, reset times and a refresh button.'
        ],
        tip: 'Checking usage never uses tokens.',
        keywords: 'limit rings quota percent'
      },
      {
        id: 'usage-agents',
        title: 'See which agents use the most',
        summary: 'Runs, tokens and share of usage per agent, over 5 hours or the week.',
        steps: ['Open **Settings → Usage**.', 'Look under **By agent**.'],
        go: 'settings',
        keywords: 'tokens cost stats breakdown'
      },
      {
        id: 'light-routines',
        title: 'Keep routines light',
        summary: 'Run routines and reminder tasks on Haiku in a short fresh session, using far less of your limit.',
        steps: ['Open **Settings → Usage**.', 'Turn on **Light routines** (on by default).'],
        go: 'settings',
        keywords: 'cheap haiku save usage'
      },
      {
        id: 'pause-routines',
        title: 'Pause routines near your weekly limit',
        summary: 'Stop routines from using up your week.',
        steps: ['Open **Settings → Usage**.', 'Pick a level under **Pause routines when the week reaches**.'],
        tip: 'Plain reminders still arrive.',
        go: 'settings',
        keywords: 'limit weekly pause skip'
      }
    ]
  },
  {
    id: 'settings',
    title: 'Settings & data',
    features: [
      {
        id: 'appearance',
        title: 'Theme and accent colour',
        summary: 'Light or dark, and one of 18 accent colours.',
        steps: ['Open **Settings → Appearance**.', 'Pick a **Theme** and an **Accent colour**.'],
        go: 'settings',
        keywords: 'dark light colour color look'
      },
      {
        id: 'voice',
        title: 'Choose a voice',
        summary: 'The voice and speed Listen uses.',
        steps: [
          'Open **Settings → Voice**.',
          'Pick a **Voice** and **Speed**.',
          'For a more natural voice, click **Open Read & Speak** and download a Premium one.'
        ],
        go: 'settings',
        keywords: 'speech speak siri premium'
      },
      {
        id: 'share-agent',
        title: 'Share an agent as a file',
        summary: 'Save an agent’s instructions, routines and watches to import in another NateBot.',
        steps: ['Open the agent’s settings.', 'Under **Memory & removal**, click **Save…**.', 'Send the file to whoever wants it.'],
        tip: 'Never includes its memory, chats or folders.',
        keywords: 'export json send'
      },
      {
        id: 'delete-agent',
        title: 'Delete an agent',
        summary: 'Remove an agent with its routines and chat history.',
        steps: ['Open the agent’s settings.', 'Under **Memory & removal**, click **Delete** and confirm.'],
        tip: 'Its working folder goes to the Trash.',
        keywords: 'remove trash'
      },
      {
        id: 'data',
        title: 'Find your data and backups',
        summary: 'Everything stays on your Mac in ~/NateBot, with a daily backup (last 7 kept).',
        steps: ['Choose **File → Show Data Folder**.', 'Backups are in `backups/`, one folder per day.'],
        keywords: 'folder files backup restore privacy'
      },
      {
        id: 'claude-setup',
        title: 'Fix the Claude Code connection',
        summary: 'NateBot runs on your Claude Code login. If it can’t find it, point it there.',
        steps: [
          'Open **Settings → Claude Code**.',
          'Paste the result of `which claude` (from Terminal) into **Path to the claude program**.',
          'Click **Re-check**.'
        ],
        tip: 'Says “Not logged in”? Run `claude auth login` in Terminal.',
        go: 'settings',
        keywords: 'setup login path error troubleshoot'
      }
    ]
  }
]

export const GUIDE_FEATURES: GuideFeature[] = GUIDE.flatMap((c) => c.features)

/** Categories with only the features where every word of the query starts a word in the feature. */
export function searchGuide(query: string): GuideCategory[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return GUIDE
  // "older" shouldn't find "folders": match from the start of a word.
  const patterns = words.map((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  const text = (f: GuideFeature): string =>
    [f.title, f.summary, f.keywords ?? '', f.tip ?? '', ...f.steps].join(' ').toLowerCase().replace(/[*`’]/g, '')
  return GUIDE.map((c) => ({ ...c, features: c.features.filter((f) => patterns.every((p) => p.test(text(f)))) })).filter(
    (c) => c.features.length > 0
  )
}
