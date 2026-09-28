// Skills marketplace. Browses GitHub repos containing SKILL.md folders
// (anthropics/skills by default) and installs skills into ~/NateBot/skills,
// which is a Claude Code plugin passed to every agent run with --plugin-dir.
import { shell } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize, sep } from 'node:path'
import { parse } from 'yaml'
import type { MarketplaceData, MarketplaceSkill, MarketplaceSource } from '@shared/types'
import { ROOT } from './paths'

export const SKILLS_PLUGIN = join(ROOT, 'skills')
const SKILLS_DIR = join(SKILLS_PLUGIN, 'skills')
const SOURCES_FILE = join(ROOT, 'skill-sources.json')
const CACHE_DIR = join(ROOT, 'cache')
const META = '.natebot.json'

const DEFAULT_SOURCES = ['anthropics/skills']
const CACHE_TTL = 60 * 60_000
const MAX_FILES = 300
const MAX_BYTES = 25 * 1024 * 1024
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const SCRIPT_RE = /\.(py|sh|js|mjs|ts|rb|pl)$/i

interface TreeFile {
  path: string
  size: number
}

interface CachedSource {
  fetchedAt: number
  sha: string
  skills: { name: string; description: string; dir: string; files: TreeFile[] }[]
}

// ---- plugin folder ----

function ensurePlugin(): void {
  mkdirSync(join(SKILLS_PLUGIN, '.claude-plugin'), { recursive: true })
  mkdirSync(SKILLS_DIR, { recursive: true })
  const manifest = join(SKILLS_PLUGIN, '.claude-plugin', 'plugin.json')
  if (!existsSync(manifest)) {
    writeFileSync(
      manifest,
      JSON.stringify({ name: 'natebot-skills', version: '1.0.0', description: 'Skills installed from the NateBot marketplace' }, null, 2) + '\n'
    )
  }
}

/** True when at least one skill is installed (so runs should load the plugin). */
export function hasInstalledSkills(): boolean {
  return installedSkills().length > 0
}

function frontmatter(text: string): { name?: string; description?: string } {
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(text)
  if (!m) return {}
  try {
    const data = parse(m[1] ?? '') as Record<string, unknown>
    return {
      name: typeof data['name'] === 'string' ? data['name'] : undefined,
      description: typeof data['description'] === 'string' ? data['description'] : undefined
    }
  } catch {
    return {}
  }
}

interface Installed {
  name: string
  description: string
  source: string
  dir: string
}

function installedSkills(): Installed[] {
  if (!existsSync(SKILLS_DIR)) return []
  const out: Installed[] = []
  for (const name of readdirSync(SKILLS_DIR)) {
    const skillFile = join(SKILLS_DIR, name, 'SKILL.md')
    if (!existsSync(skillFile)) continue
    const fm = frontmatter(readFileSync(skillFile, 'utf8'))
    let meta: { source?: string; dir?: string } = {}
    try {
      meta = JSON.parse(readFileSync(join(SKILLS_DIR, name, META), 'utf8')) as typeof meta
    } catch {
      // Added by hand: a local skill.
    }
    out.push({ name, description: fm.description ?? '', source: meta.source ?? 'local', dir: meta.dir ?? '' })
  }
  return out
}

// ---- sources ----

export function listSources(): string[] {
  try {
    const raw = JSON.parse(readFileSync(SOURCES_FILE, 'utf8')) as { sources?: unknown }
    const list = Array.isArray(raw.sources) ? raw.sources.filter((s): s is string => typeof s === 'string' && REPO_RE.test(s)) : []
    return list.length ? list : DEFAULT_SOURCES
  } catch {
    return DEFAULT_SOURCES
  }
}

function saveSources(list: string[]): void {
  writeFileSync(SOURCES_FILE, JSON.stringify({ sources: [...new Set(list)] }, null, 2) + '\n')
}

/** Accepts "owner/repo" or a github.com URL. */
export function parseRepo(input: string): string | null {
  const s = input.trim().replace(/\.git$/, '').replace(/\/$/, '')
  const url = /^https?:\/\/github\.com\/([^/]+\/[^/]+)/.exec(s)
  const repo = url ? url[1] : s
  return repo && REPO_RE.test(repo) ? repo : null
}

export function addSource(repo: string): void {
  saveSources([...listSources(), repo])
}

export function removeSource(repo: string): void {
  saveSources(listSources().filter((s) => s !== repo))
  rmSync(cacheFile(repo), { force: true })
}

// ---- GitHub ----

const HEADERS = { 'User-Agent': 'NateBot', Accept: 'application/vnd.github+json' }

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADERS })
  if (res.status === 403 || res.status === 429) throw new Error('GitHub rate limit reached. Try again in a while.')
  if (res.status === 404) throw new Error('Repository not found (or private).')
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`)
  return (await res.json()) as T
}

const rawUrl = (repo: string, sha: string, path: string): string =>
  `https://raw.githubusercontent.com/${repo}/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`

const cacheFile = (repo: string): string => join(CACHE_DIR, `skills-${repo.replace('/', '__')}.json`)

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i] as T)
      }
    })
  )
  return out
}

async function fetchSource(repo: string): Promise<CachedSource> {
  const meta = await getJson<{ default_branch: string }>(`https://api.github.com/repos/${repo}`)
  const tree = await getJson<{ sha: string; tree: { path: string; type: string; size?: number }[]; truncated: boolean }>(
    `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(meta.default_branch)}?recursive=1`
  )
  const blobs = tree.tree.filter((e) => e.type === 'blob')
  const dirs = blobs
    .filter((e) => e.path === 'SKILL.md' || e.path.endsWith('/SKILL.md'))
    .map((e) => (e.path === 'SKILL.md' ? '' : dirname(e.path)))
    .filter((d) => !/(^|\/)template$/i.test(d))

  const skills = await pool(dirs, 6, async (dir) => {
    const prefix = dir ? `${dir}/` : ''
    const text = await fetch(rawUrl(repo, tree.sha, `${prefix}SKILL.md`), { headers: { 'User-Agent': 'NateBot' } }).then((r) =>
      r.ok ? r.text() : ''
    )
    const fm = frontmatter(text)
    const files = blobs
      .filter((e) => e.path.startsWith(prefix) && !dirs.some((d) => d !== dir && d.startsWith(prefix) && e.path.startsWith(`${d}/`)))
      .map((e) => ({ path: e.path.slice(prefix.length), size: e.size ?? 0 }))
    return { name: fm.name ?? (dir.split('/').pop() || repo.split('/')[1] || 'skill'), description: fm.description ?? '', dir, files }
  })

  const cached: CachedSource = { fetchedAt: Date.now(), sha: tree.sha, skills }
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(cacheFile(repo), JSON.stringify(cached))
  return cached
}

async function loadSource(repo: string, force: boolean): Promise<CachedSource> {
  if (!force) {
    try {
      const cached = JSON.parse(readFileSync(cacheFile(repo), 'utf8')) as CachedSource
      if (Date.now() - cached.fetchedAt < CACHE_TTL) return cached
    } catch {
      // no cache yet
    }
  }
  return fetchSource(repo)
}

// ---- public API ----

export async function marketplace(force = false): Promise<MarketplaceData> {
  ensurePlugin()
  const installed = installedSkills()
  const sources: MarketplaceSource[] = []
  const skills: MarketplaceSkill[] = []

  for (const repo of listSources()) {
    try {
      const src = await loadSource(repo, force)
      sources.push({ repo, count: src.skills.length, error: null })
      for (const s of src.skills) {
        const match = installed.find((i) => i.source === repo && i.dir === s.dir)
        skills.push({
          id: `${repo}#${s.dir}`,
          name: s.name,
          description: s.description,
          source: repo,
          installed: !!match,
          installedName: match?.name ?? null,
          hasScripts: s.files.some((f) => SCRIPT_RE.test(f.path)),
          fileCount: s.files.length
        })
      }
    } catch (e) {
      sources.push({ repo, count: 0, error: (e as Error).message })
    }
  }

  // Skills added by hand, or from a source that was removed.
  for (const i of installed) {
    if (skills.some((s) => s.installedName === i.name)) continue
    skills.push({
      id: `local#${i.name}`,
      name: i.name,
      description: i.description,
      source: i.source,
      installed: true,
      installedName: i.name,
      hasScripts: false,
      fileCount: 0
    })
  }
  return { skills, sources, installedCount: installed.length }
}

/** Keeps a download inside its target folder. */
function safeJoin(base: string, rel: string): string {
  const full = normalize(join(base, rel))
  if (!full.startsWith(base + sep)) throw new Error(`Unsafe path in skill: ${rel}`)
  return full
}

export async function installSkill(id: string): Promise<void> {
  const [repo, dir = ''] = id.split('#')
  if (!repo || !listSources().includes(repo)) throw new Error('Unknown skill source')
  const src = await loadSource(repo, false)
  const skill = src.skills.find((s) => s.dir === dir)
  if (!skill) throw new Error('Skill not found. Try refreshing the marketplace.')

  const name = skill.name.toLowerCase()
  if (!NAME_RE.test(name)) throw new Error(`"${skill.name}" is not a valid skill name.`)
  if (skill.files.length > MAX_FILES) throw new Error('This skill has too many files to install.')
  if (skill.files.reduce((n, f) => n + f.size, 0) > MAX_BYTES) throw new Error('This skill is too large to install.')

  ensurePlugin()
  const target = join(SKILLS_DIR, name)
  const existing = installedSkills().find((i) => i.name === name)
  if (existing && !(existing.source === repo && existing.dir === dir)) {
    throw new Error(`A different skill called "${name}" is already installed (from ${existing.source}).`)
  }

  // Download into a temp folder, then swap it into place.
  const tmp = join(SKILLS_PLUGIN, `.installing-${name}-${Date.now()}`)
  mkdirSync(tmp, { recursive: true })
  try {
    const prefix = dir ? `${dir}/` : ''
    await pool(skill.files, 6, async (f) => {
      const res = await fetch(rawUrl(repo, src.sha, prefix + f.path), { headers: { 'User-Agent': 'NateBot' } })
      if (!res.ok) throw new Error(`Download failed for ${f.path} (${res.status})`)
      const dest = safeJoin(tmp, f.path)
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
    })
    // The folder name is the skill's name; keep SKILL.md's frontmatter consistent with it.
    writeFileSync(join(tmp, META), JSON.stringify({ source: repo, dir, sha: src.sha, installedAt: new Date().toISOString() }, null, 2))
    if (existsSync(target)) rmSync(target, { recursive: true, force: true })
    renameSync(tmp, target)
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true })
    throw e
  }
}

/** Moves the skill folder to the Trash (recoverable). */
export async function uninstallSkill(name: string): Promise<void> {
  if (!NAME_RE.test(name)) throw new Error('Invalid skill name')
  const target = join(SKILLS_DIR, name)
  if (existsSync(target)) await shell.trashItem(target)
}
