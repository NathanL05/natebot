// Makes `npm run dev` look like NateBot instead of "Electron" on macOS.
// The menu-bar app name, Dock tooltip and About panel come from the Electron
// binary's Info.plist, which app.setName() cannot change at runtime. This
// patches the dev copy in node_modules (never the packaged app) and re-signs
// it ad hoc. Runs automatically after `npm install` (postinstall).
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const NAME = 'NateBot'
const BUNDLE_ID = 'com.nathan.natebot.dev'

if (process.platform !== 'darwin') process.exit(0)

const root = join(import.meta.dirname, '..')
const app = join(root, 'node_modules/electron/dist/Electron.app')
const plist = join(app, 'Contents/Info.plist')
const icon = join(root, 'build/icon.icns')

if (!existsSync(plist)) {
  console.log('[brand-dev-electron] Electron not downloaded yet, skipping')
  process.exit(0)
}

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'pipe' })
const set = (key, value) => run('/usr/bin/plutil', ['-replace', key, '-string', value, plist])

set('CFBundleName', NAME)
set('CFBundleDisplayName', NAME)
set('CFBundleIdentifier', BUNDLE_ID)
if (existsSync(icon)) copyFileSync(icon, join(app, 'Contents/Resources/electron.icns'))

// Editing Info.plist invalidates Electron's signature; re-sign ad hoc.
run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app])

// Refresh Launch Services so the Dock/menu bar pick up the new name and icon.
const lsregister =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
try {
  run(lsregister, ['-f', app])
} catch {
  // Not fatal: macOS refreshes its cache on its own eventually.
}

console.log(`[brand-dev-electron] dev Electron now shows as ${NAME}`)
