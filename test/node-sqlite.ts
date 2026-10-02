// Vitest can't resolve `node:sqlite` itself (a built-in that only exists with the
// `node:` prefix), so tests load it through require. Needs Node 22+, like the app.
import { createRequire } from 'node:module'

export const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
