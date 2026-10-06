# Troubleshooting

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
