# Development

**Adding a feature?** Add an entry for it to the in-app Guide in `src/renderer/src/lib/guide.ts` (and to
[features.md](features.md) if it needs more than a few steps).

Building NateBot from source, changing the icon, the PR workflow and the project layout.

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

## Rebuild after changes

```bash
git pull            # or make your own edits
npm install
npm run dist
```

Then quit NateBot (menu-bar icon → Quit, or ⌘Q), drag the new `NateBot.app` from `dist/mac-arm64/` (or the
new `.dmg`) into Applications, replace the old one, and open it. Your agents, chats and settings live in
`~/NateBot`, so they carry over.

## Changing the app icon

The icon's source is `build/icon.svg` (the menu-bar icon is `build/trayTemplate.svg`); `npm run icons` rebuilds
every size from them. To use your own art, run `npm run icons -- path/to/art.png` with any 1024×1024 PNG or SVG.
It regenerates `build/icon.icns` and the PNGs, and rebuilds the dev app.

The current icon is a white-to-silver metallic bubble bot on a black tile. The UI's accent colour is separate:
pick one of 18 in **Settings → Appearance → Accent colour** (defined in `src/shared/accents.ts`).

**macOS caches app icons aggressively.** After changing the icon, to see it everywhere:

1. Build and install the new app (`npm run dist`, then replace `/Applications/NateBot.app`).
2. Unpin the old Dock icon (right-click → Options → uncheck *Keep in Dock*).
3. Refresh the icon caches. Notification Center keeps its own copy of the icon in memory, so restart it too, or
   notifications keep showing the old one:
   ```bash
   touch /Applications/NateBot.app && killall Dock Finder NotificationCenter usernoted
   ```
   Old copies in the Trash or `dist/` stay registered under the same bundle id. If an old icon still shows, unregister
   them (`/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u
   <path to the old NateBot.app>`) and empty the Trash.
4. Open NateBot and pin it again (right-click its Dock icon → Options → *Keep in Dock*).

If the old icon still shows, clear the system icon cache (asks for your password) and restart the Mac:

```bash
sudo rm -rf /Library/Caches/com.apple.iconservices.store
```

`npm install` sets up dev mode automatically: `npm run dev` launches a
NateBot-branded copy of Electron (`node_modules/electron/dist/NateBot.app`), so the Dock and menu bar show NateBot.
To keep NateBot in your Dock, pin the installed `/Applications/NateBot.app` (pinning the dev copy would open a
blank Electron window when clicked).

## Development workflow

- **Branches:** `main` only accepts pull requests. Work on a short-lived branch, open a PR, and squash-merge it
  once CI is green.
- **Checks:** `npm test` runs the unit tests (Vitest, `src/**/*.test.ts`). CI (`.github/workflows/ci.yml`) runs
  typecheck, tests and build on every PR and push to `main`. Tests never start Electron or `claude`.
- **Releases:** bump the version in a PR (`npm version minor --no-git-tag-version`), merge it, then tag `main`
  (`git tag v0.2.0 && git push origin v0.2.0`). `.github/workflows/release.yml` builds the `.dmg` on macOS and
  attaches it to a draft GitHub release. The app is ad-hoc signed and not notarised: a downloaded copy needs
  right-click → Open on first launch, and it can't auto-update.

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

## Screenshots

The README's screenshots come from a demo data folder with made-up agents, chats, calendar and inbox, never your real
`~/NateBot`. To retake them:

```bash
npm run demo:data -- /tmp/natebot-demo
NATEBOT_HOME=/tmp/natebot-demo npm run dev
```

`NATEBOT_HOME` points NateBot at another data folder, with its own window state and single-instance lock, so this runs
next to the installed app. The demo copy reads Today's calendar and inbox from `demo-today.json` in that folder instead
of Google. Its routines are on but never catch up on launch, so nothing runs unless you leave it open past 7:30 or 8:00.
Capture at 1280px wide (`docs/images/`). The demo content is in `scripts/demo-data.ts`.

