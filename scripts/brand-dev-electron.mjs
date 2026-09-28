// Makes `npm run dev` look like NateBot instead of Electron on macOS.
// The menu-bar name, Dock icon and tooltip come from the launched app bundle,
// which app.setName() can't change at runtime. So we clone Electron.app to a
// separate NateBot.app (an instant APFS copy-on-write clone), give it
// NateBot's name, bundle id and icon, and point the electron package's
// path.txt at it. A new bundle path also means macOS has no cached Electron
// icon for it. Runs automatically after `npm install` (postinstall). The
// packaged app is built separately by electron-builder and is unaffected.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const NAME = 'NateBot'
const BUNDLE_ID = 'com.nathan.natebot.dev'

if (process.platform !== 'darwin') process.exit(0)

const root = join(import.meta.dirname, '..')
const dist = join(root, 'node_modules/electron/dist')
const source = join(dist, 'Electron.app')
const target = join(dist, `${NAME}.app`)
const pathFile = join(root, 'node_modules/electron/path.txt')
const icon = join(root, 'build/icon.icns')

if (!existsSync(join(source, 'Contents/Info.plist'))) {
  console.log('[brand-dev-electron] Electron not downloaded yet, skipping')
  process.exit(0)
}

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'pipe' })

// Fresh clone each time so it always matches the installed Electron version.
rmSync(target, { recursive: true, force: true })
try {
  run('/bin/cp', ['-c', '-R', source, target]) // APFS clone: instant, no extra disk
} catch {
  run('/bin/cp', ['-R', source, target])
}

const plist = join(target, 'Contents/Info.plist')
const set = (key, value) => run('/usr/bin/plutil', ['-replace', key, '-string', value, plist])
set('CFBundleName', NAME)
set('CFBundleDisplayName', NAME)
set('CFBundleIdentifier', BUNDLE_ID)
set('CFBundleIconFile', `${NAME}.icns`)
if (existsSync(icon)) copyFileSync(icon, join(target, `Contents/Resources/${NAME}.icns`))

// Editing Info.plist invalidates Electron's signature; re-sign ad hoc.
run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', target])

// Point `electron` (and so electron-vite) at NateBot.app.
const exe = readFileSync(pathFile, 'utf8').replace(/^[^/]+\.app\//, `${NAME}.app/`)
writeFileSync(pathFile, exe)

// Register with Launch Services so the Dock and menu bar pick up name and icon.
const lsregister =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
try {
  run(lsregister, ['-f', target])
} catch {
  // Not fatal: macOS refreshes its cache on its own eventually.
}

console.log(`[brand-dev-electron] npm run dev now launches ${NAME}.app (${exe})`)
