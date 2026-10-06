# Connections

How to connect Gmail, Google Calendar, Tasks and Drive, Apple Reminders & Notes, and any other MCP server. Every connection is per agent: an agent only sees the ones you tick in its settings.

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

## Connecting Google Calendar

Calendar uses the same Google address and OAuth client as Gmail, so connect Gmail first. Then:

1. In the same Google Cloud project, enable the **Google Calendar API**
   ([direct link](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com)).
2. In NateBot: **Settings → Connected tools → Connect Calendar…** and approve Calendar access in the browser.
3. Give **Google Calendar** to the agents that should use it (the Planner is a good fit) in their settings.

Calendar gets its own sign-in token (in `~/NateBot/credentials/google-calendar/`), so connecting or
reconnecting it never touches the Gmail sign-in. Agents can read events, list calendars and check free time.
Creating, changing, deleting or answering an event (`manage_event`, plus out-of-office, focus time and new
calendars) is blocked in normal runs and only happens through **Approve**. The approval notification shows the
event, start and end times, and guests.

## Connecting Google Tasks and Drive

Like Calendar, these reuse Gmail's Google address and OAuth client but get their own sign-in, so connecting them
never touches Gmail. In the same Google Cloud project, enable the
[Google Tasks API](https://console.cloud.google.com/apis/library/tasks.googleapis.com) or the
[Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com) and
[Google Docs API](https://console.cloud.google.com/apis/library/docs.googleapis.com), then click **Connect Tasks…** or
**Connect Drive…** in **Settings → Connected tools** and give the server to the agents that should use it.

- **Tasks** (`gtasks`): agents read your task lists, which sync to Google Calendar and the Tasks app on your phone.
  Adding, completing or deleting a task (`manage_task`) only happens through **Approve**.
- **Drive & Docs** (`gdrive`): agents search Drive and read files and Docs, for example lecture notes for the Study
  Buddy or your CV for cover letters. Creating, importing or editing files only happens through **Approve**. It
  loads only the smaller core tool set, to keep each message light.

## Connecting Apple Reminders & Notes

**Settings → Connected tools → Apple Reminders & Notes → Connect…** adds NateBot's own small connector (no install
needed). macOS asks once whether NateBot may control Reminders and Notes; click **Allow**. Then give **apple** to the
agents that should use it.

- Agents can list your reminder lists and open reminders, and search and read your notes. These sync with your iPhone
  through iCloud.
- Creating or completing a reminder, and creating a note, only happen through **Approve**.
- If you clicked Don't Allow, turn it on in **System Settings → Privacy & Security → Automation → NateBot**.
- The connector is `resources/apple-mcp.cjs`. It talks to the apps through `osascript` and passes your text to
  scripts as data, never as code.

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
