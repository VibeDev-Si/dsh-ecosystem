#!/usr/bin/env node
/**
 * Validates catalog/catalog.json.
 *
 *   node scripts/validate-catalog.mjs            structural checks only (offline, used by `npm test`)
 *   node scripts/validate-catalog.mjs --online   also confirms every npm package@version really exists
 *
 * The catalog is the install ALLOW-LIST: the center installs nothing that is not an entry here, so
 * every rule below protects users, not just formatting.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const online = process.argv.includes('--online')
const catalog = JSON.parse(readFileSync(join(root, 'catalog', 'catalog.json'), 'utf8'))
const errors = []
const err = (m) => errors.push(m)

const ORIGINS = new Set(['official', 'community'])
const ROLES = new Set(['official', 'dependency', 'companion', 'featured'])
const UPDATES = new Set(['center', 'self'])
const COMPAT = new Set(['verified', 'likely', 'unknown', 'incompatible'])
const TAGS = new Set(['official', 'community', 'needsAccount', 'paid', 'needsHost02', 'needsSidebar', 'dependency', 'companion', 'tested'])
const CAPS = new Set(['network', 'writeFiles', 'readFiles', 'credentials', 'cost', 'agentTools', 'localRoute', 'pageScripts', 'community', 'fileAccess', 'writeConfig'])
const SPEC = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

const bi = (v, where) => {
  if (!v || typeof v.zh !== 'string' || typeof v.en !== 'string' || !v.zh.trim() || !v.en.trim()) err(`${where}: needs non-empty zh and en`)
}
const biList = (v, where) => {
  if (!v || !Array.isArray(v.zh) || !Array.isArray(v.en) || v.zh.length === 0) return err(`${where}: needs zh[] and en[]`)
  if (v.zh.length !== v.en.length) err(`${where}: zh and en must have the same number of lines (${v.zh.length} vs ${v.en.length})`)
}

if (catalog.schema !== 1) err('schema must be 1')
if (!Array.isArray(catalog.plugins) || catalog.plugins.length === 0) err('plugins[] is required')

const ids = new Set()
const npmNames = new Set()
for (const p of catalog.plugins ?? []) {
  const w = `plugin ${p.id ?? '?'}`
  if (!p.id || ids.has(p.id)) err(`${w}: id missing or duplicated`)
  ids.add(p.id)
  if (p.id !== p.npm) err(`${w}: id must equal npm name`)
  if (!SPEC.test(p.npm ?? '')) err(`${w}: npm is not a plain package name (no urls, paths, versions or tags)`)
  if (npmNames.has(p.npm)) err(`${w}: duplicate npm name`)
  npmNames.add(p.npm)
  if (!SEMVER.test(p.version ?? '')) err(`${w}: version must be an exact x.y.z, not a range or tag`)
  // When this exact version reached npm. The update screens use it to warn about pnpm's one-day cooldown honestly.
  if (typeof p.publishedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(p.publishedAt) || Number.isNaN(Date.parse(p.publishedAt))) err(`${w}: publishedAt must be an ISO UTC time such as 2026-10-05T14:40:00.000Z`)
  if (!ORIGINS.has(p.origin)) err(`${w}: origin`)
  if (!ROLES.has(p.role)) err(`${w}: role`)
  if (!UPDATES.has(p.updates)) err(`${w}: updates`)
  if (p.origin === 'official' && !(p.npm.startsWith('@vibedev-si/') || ['dsh-media', 'dsh-film'].includes(p.npm))) {
    err(`${w}: an "official" entry must be @vibedev-si/* or one of the grandfathered unscoped names`)
  }
  if (p.origin === 'community' && p.role === 'official') err(`${w}: community entry cannot have role official`)
  if (p.origin === 'community' && !p.author) err(`${w}: community entry needs author`)
  bi(p.name, `${w}.name`)
  bi(p.tagline, `${w}.tagline`)
  biList(p.does, `${w}.does`)
  for (const t of p.tags ?? []) if (!TAGS.has(t)) err(`${w}: unknown tag ${t}`)
  for (const c of p.capabilities ?? []) {
    if (!CAPS.has(c.key)) err(`${w}: unknown capability ${c.key}`)
    bi(c.text, `${w}.capabilities.${c.key}`)
  }
  if (!(p.capabilities ?? []).length) err(`${w}: capabilities must list at least one entry`)
  if (p.origin === 'community' && !(p.capabilities ?? []).some((c) => c.key === 'community')) err(`${w}: community entry must carry the "community" capability disclaimer`)
  if (!Number.isFinite(p.sizeKB) || p.sizeKB <= 0) err(`${w}: sizeKB`)
  if (!p.icon?.glyph?.zh || !p.icon?.glyph?.en || p.icon.grad?.length !== 2) err(`${w}: icon.glyph{zh,en} and icon.grad[2]`)
  if (p.icon?.glyph?.en && /[^\x00-\x7f]/.test(p.icon.glyph.en)) err(`${w}: icon.glyph.en must be plain ASCII (it is shown in the English UI)`)
  if (typeof p.cmd !== 'string' || !p.cmd.includes(p.npm)) err(`${w}: cmd must mention the package name`)
  for (const k of ['repo', 'npm']) if (!/^https:\/\//.test(p.links?.[k] ?? '')) err(`${w}: links.${k} must be https`)
  if (p.compat != null) {
    if (!COMPAT.has(p.compat.s)) err(`${w}: compat.s`)
    bi(p.compat.why, `${w}.compat.why`)
  }
  if (p.reviewed != null && !(p.reviewed.date && Array.isArray(p.reviewed.tested) && p.reviewed.tested.length)) err(`${w}: reviewed needs date and tested[]`)
}
for (const p of catalog.plugins ?? []) {
  for (const k of ['requires', 'partners']) for (const d of p[k] ?? []) if (!ids.has(d)) err(`plugin ${p.id}: ${k} points at unknown id ${d}`)
  if ((p.requires ?? []).includes(p.id)) err(`plugin ${p.id}: requires itself`)
}
// dependency cycles
const visit = (id, path) => {
  if (path.includes(id)) return err(`dependency cycle: ${[...path, id].join(' -> ')}`)
  const p = catalog.plugins.find((x) => x.id === id)
  for (const d of p?.requires ?? []) visit(d, [...path, id])
}
for (const p of catalog.plugins ?? []) visit(p.id, [])
for (const s of catalog.suites ?? []) {
  bi(s.name, `suite ${s.id}.name`)
  bi(s.tagline, `suite ${s.id}.tagline`)
  for (const i of s.items ?? []) if (!ids.has(i)) err(`suite ${s.id}: unknown item ${i}`)
}

if (online) {
  for (const p of catalog.plugins) {
    try {
      const r = await fetch(`https://registry.npmjs.org/${p.npm.replace('/', '%2F')}`)
      if (!r.ok) { err(`${p.id}: registry answered ${r.status}`); continue }
      const j = await r.json()
      const v = j.versions?.[p.version]
      if (!v) { err(`${p.id}: version ${p.version} does not exist on npm`); continue }
      if (!v.dsh?.bundle) err(`${p.id}@${p.version}: no dsh.bundle manifest, the plugin manager would refuse it`)
      const npmTime = j.time?.[p.version]
      if (!npmTime) err(`${p.id}@${p.version}: npm has no publish time for it`)
      else if (new Date(npmTime).getTime() !== new Date(p.publishedAt).getTime()) err(`${p.id}@${p.version}: publishedAt ${p.publishedAt} differs from npm's ${new Date(npmTime).toISOString()}`)
      const size = Math.round((v.dist?.unpackedSize ?? 0) / 1024)
      if (size && Math.abs(size - p.sizeKB) / Math.max(size, 1) > 0.25) err(`${p.id}: sizeKB ${p.sizeKB} differs from npm unpackedSize ${size} KB by more than 25%`)
      console.log(`  ok  ${p.id}@${p.version}  (npm ${size} KB, latest ${j['dist-tags']?.latest})`)
    } catch (e) {
      err(`${p.id}: could not reach the registry (${e.message})`)
    }
  }
}

if (errors.length) {
  console.error(`catalog INVALID (${errors.length}):\n - ${errors.join('\n - ')}`)
  process.exit(1)
}
console.log(`catalog ok: ${catalog.plugins.length} plugins, ${catalog.suites.length} suite(s)${online ? ', verified against npm' : ''}`)
