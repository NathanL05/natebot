const SIZE = 256
const MAX_INPUT_BYTES = 25 * 1024 * 1024
export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif']

/** URL of an uploaded picture, or null to use the generated mascot. */
export function agentPicture(agentId: string, version: number | null | undefined): string | null {
  return version ? `natebot-avatar://agent/${agentId}?v=${version}` : null
}

export function userPicture(version: number | null | undefined): string | null {
  return version ? `natebot-avatar://user/?v=${version}` : null
}

/** Centre-crops an image file to a square and scales it to 256px. Returns a PNG data URL. */
export async function squareImage(file: File): Promise<string> {
  if (!ACCEPTED_TYPES.includes(file.type)) throw new Error('Choose a PNG, JPG or GIF image.')
  if (file.size > MAX_INPUT_BYTES) throw new Error('That image is too large (max 25 MB).')
  // For animated GIFs this takes the first frame.
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not process the image.')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE)
  bitmap.close()
  return canvas.toDataURL('image/png')
}
