# NateBot

A personal multi-agent Mac app. Each "contact" is an AI agent with its own job, powered by the
locally installed Claude Code CLI and your Claude subscription (no API key, no API credits).

> **Status: M1 (UI with mock data).** Replies are simulated; real Claude integration lands in M2.
> The full README (Gmail setup, packaging, limitations) is completed in M6/M7.

## Requirements

- macOS on Apple Silicon
- Node 22+ (`nvm use` picks it up from `.nvmrc`)
- Claude Code installed and logged in (`claude auth status` should say `"loggedIn": true`)

## Run in development

```bash
nvm use
npm install
npm run dev
```

In dev builds the **Debug** menu can simulate a usage limit or a setup problem so you can see
those screens.

## Project layout

```
src/shared/     types, IPC contract, schedule <-> cron helpers
src/main/       Electron main process (window, menu, backend)
src/preload/    minimal contextBridge API (no Node access in the renderer)
src/renderer/   React + Tailwind UI
build/          app icon (SVG source, PNG, ICNS)
```
