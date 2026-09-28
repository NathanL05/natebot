// Custom profile pictures, stored as 256×256 PNGs in the app's user-data
// folder (~/Library/Application Support/NateBot/avatars) and served to the
// UI through the natebot-avatar:// protocol.
import { app, nativeImage, net, protocol } from 'electron'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const AVATAR_SCHEME = 'natebot-avatar'
const SIZE = 256
const MAX_BYTES = 4 * 1024 * 1024
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

/** 'user' or 'agent:<id>' */
export type AvatarTarget = string

const dir = (): string => join(app.getPath('userData'), 'avatars')

function fileFor(target: AvatarTarget): string {
  if (target === 'user') return join(dir(), 'user.png')
  const id = /^agent:(.+)$/.exec(target)?.[1]
  if (!id || !ID_RE.test(id)) throw new Error('Invalid avatar target')
  return join(dir(), `agent-${id}.png`)
}

/** Modification time of the stored picture (used as a cache-busting version). */
export function avatarVersion(target: AvatarTarget): number | null {
  try {
    return Math.round(statSync(fileFor(target)).mtimeMs)
  } catch {
    return null
  }
}

/** Saves a picture from a PNG/JPEG data URL. Returns the new version. */
export function saveAvatar(target: AvatarTarget, dataUrl: string): number {
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!m) throw new Error('Unsupported image data')
  const buffer = Buffer.from(m[2] as string, 'base64')
  if (buffer.length > MAX_BYTES) throw new Error('Image is too large')

  let image = nativeImage.createFromBuffer(buffer)
  if (image.isEmpty()) throw new Error("That file couldn't be read as an image")
  // The UI already crops and resizes; enforce it here too.
  const { width, height } = image.getSize()
  if (width !== height) {
    const side = Math.min(width, height)
    image = image.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side })
  }
  if (image.getSize().width !== SIZE) image = image.resize({ width: SIZE, height: SIZE, quality: 'best' })

  mkdirSync(dir(), { recursive: true })
  writeFileSync(fileFor(target), image.toPNG())
  return avatarVersion(target) ?? Date.now()
}

export function removeAvatar(target: AvatarTarget): void {
  rmSync(fileFor(target), { force: true })
}

/** Must run before app 'ready'. */
export function registerAvatarScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: AVATAR_SCHEME, privileges: { standard: true, secure: true } }])
}

/** natebot-avatar://user/?v=… and natebot-avatar://agent/<id>?v=… */
export function handleAvatarProtocol(): void {
  protocol.handle(AVATAR_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const target = url.hostname === 'user' ? 'user' : `agent:${url.pathname.replace(/^\//, '')}`
      const file = fileFor(target)
      if (!existsSync(file)) return new Response(null, { status: 404 })
      return net.fetch(pathToFileURL(file).toString())
    } catch {
      return new Response(null, { status: 400 })
    }
  })
}
