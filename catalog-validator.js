/**
 * The catalog validator, shared by everything that trusts catalog/catalog.json.
 *
 * The catalog is the install ALLOW-LIST: the ecosystem installs nothing that is not an entry here,
 * so every rule below protects users, not just formatting. It has two callers:
 *
 *   - scripts/validate-catalog.mjs  (the maintainer's offline/online check, same rules as before)
 *   - src/remote-catalog.js         (the Host's ONLINE catalog reader: an entry that arrives over
 *                                    the network is validated with exactly these rules before a
 *                                    single package name from it is trusted)
 *
 * Pure and dependency-free: no file reads, no network, no globals. `validateCatalog` never throws.
 *
 * The catalog source is FIXED (the repository's own catalog/catalog.json on the default branch) and
 * the names an entry may use are validated here — the reader does not accept a caller-supplied URL
 * or an unbounded set of trusted package names. It is deliberately NOT a "these four plugins only"
 * list: a new @vibedev-si/* plugin committed to the catalog is picked up without shipping a new
 * client, which is the whole point of the online catalog.
 */

/** Hard bounds: a payload over these is refused whole rather than rendered. */
export const CATALOG_LIMITS = {
  plugins: 40,
  suites: 20,
  sizeKB: 1048576, // 1 GB: the catalog only DESCRIBES size, so a large legitimate plugin is not blocked
  capabilities: 12,
  doesLines: 8,
  textLength: 600,
  taglineLength: 200,
  itemsPerSuite: 40,
}

/** The catalog format this build understands: `catalog.schema` must be one of these. */
export const CATALOG_SCHEMA = 1
export const CATALOG_SCHEMAS = [1]

/** Names the catalog may claim. Everything else is refused, so the trusted install surface is fixed. */
export const CATALOG_KNOWN = {
  /** VibeDev's own packages are scoped; dsh-film is grandfathered from before the scope existed. */
  officialScopes: ['@vibedev-si/'],
  officialGrandfathered: ['dsh-film'],
  /** Community entries are the packages already shipped this way; the list does not grow by remote edit. */
  community: ['dsh-better-sidebar', 'dshmarket'],
  /** Never VibeDev's own: a DSH-scoped name claiming "official" is impersonation. */
  forbiddenScopes: ['@deepseek-ai/'],
  officialRepo: /^https:\/\/github\.com\/VibeDev-Si\/[A-Za-z0-9._-]+$/,
  npmPage: /^https:\/\/www\.npmjs\.com\/package\/[@a-z0-9._~/-]+$/i,
}

/** The ecosystem itself, which is never a catalog entry. */
export const CATALOG_SELF = ['@vibedev-si/dsh-ecosystem']

const ORIGINS = new Set(['official', 'community'])
const ROLES = new Set(['official', 'dependency', 'companion', 'featured'])
const UPDATES = new Set(['center', 'self'])
const COMPAT = new Set(['verified', 'likely', 'unknown', 'incompatible'])
const TAGS = new Set(['official', 'community', 'needsAccount', 'paid', 'needsHost02', 'needsSidebar', 'dependency', 'companion', 'tested'])
const CAPS = new Set(['network', 'writeFiles', 'readFiles', 'credentials', 'cost', 'agentTools', 'localRoute', 'pageScripts', 'community', 'fileAccess', 'writeConfig'])
/** A plain package name: no urls, no git specs, no paths, no versions, no dist-tags. */
const SPEC = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
/** An exact released version. No range, no tag, no prerelease suffix. */
const STABLE = /^\d+\.\d+\.\d+$/
const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/
const EARLIEST = Date.parse('2020-01-01T00:00:00Z')
/** Two CSS hex colours, and nothing else: `url(...)`, `var(...)` or a named colour would let a remote
 *  payload make the page fetch something or read a theme value it should not touch. */
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const PROFILE = '[A-Za-z0-9._-]{1,64}'
/** The one shape a `cmd` may have. Nothing from a payload is ever executed or echoed as a shell line:
 *  the reader regenerates the command from the entry's own npm name and exact version. */
const canonicalCmd = (npm, version) => new RegExp(`^dsh plugin(?: --profile ${PROFILE})? add ${escapeRe(npm)}(?:@${escapeRe(version)})?$`)

/** Escape a package name or version so it can only match itself inside a pattern. */
function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The canonical install command for an entry, built from fields this validator has already checked.
 * @param npm - the entry's package name.
 * @param version - the entry's exact version.
 * @param profile - an optional dsh profile name.
 * @returns the command the UI may show and the user may copy.
 */
export function catalogCommand(npm, version, profile) {
  return `dsh plugin${profile ? ` --profile ${profile}` : ''} add ${npm}@${version}`
}

/**
 * A copy of the catalog whose commands are regenerated rather than trusted.
 * @param catalog - a catalog that passed validateCatalog.
 * @param options - { profile }: the dsh profile the Host installs into, when it knows one.
 * @returns a new catalog object; the input is never modified.
 */
export function normalizeCatalog(catalog, options = {}) {
  const profile = options.profile
  if (profile !== undefined && !new RegExp(`^${PROFILE}$`).test(String(profile))) throw new Error('invalid profile name')
  const plugins = (catalog?.plugins ?? []).map((p) => ({ ...p, cmd: catalogCommand(p.npm, p.version, profile) }))
  const suites = (catalog?.suites ?? []).map((s) => ({ ...s }))
  return { ...catalog, plugins, suites }
}

/** https, and a plain path: no credentials in the authority, no query, no fragment. */
const plainHttps = (value) => typeof value === 'string' && /^https:\/\//.test(value)
  && !/^https:\/\/[^/]*@/.test(value) && !/[?#]/.test(value)

/**
 * Validate one catalog.
 * @param catalog - the parsed catalog (or anything at all).
 * @param options - { now, limits, known } overrides, for tests and for a stricter caller.
 * @returns { ok, errors, counts }: the errors are messages, safe to log and to show.
 */
export function validateCatalog(catalog, options = {}) {
  const limits = { ...CATALOG_LIMITS, ...(options.limits ?? {}) }
  const known = { ...CATALOG_KNOWN, ...(options.known ?? {}) }
  const now = typeof options.now === 'function' ? options.now() : (options.now ?? Date.now())
  const errors = []
  const err = (m) => errors.push(m)
  const entry = (v) => v !== null && typeof v === 'object'
  const text = (v) => typeof v === 'string' && v.trim().length > 0
  const bi = (v, where) => {
    if (!entry(v) || !text(v.zh) || !text(v.en)) return err(`${where}: needs non-empty zh and en`)
    if (v.zh.length > limits.textLength || v.en.length > limits.textLength) err(`${where}: text is longer than ${limits.textLength} characters`)
  }
  const biList = (v, where, min = 1, max = limits.doesLines) => {
    if (!entry(v) || !Array.isArray(v.zh) || !Array.isArray(v.en) || v.zh.length === 0) return err(`${where}: needs zh[] and en[]`)
    if (v.zh.length !== v.en.length) err(`${where}: zh and en must have the same number of lines (${v.zh.length} vs ${v.en.length})`)
    if (v.zh.length > max) err(`${where}: more than ${max} lines`)
    for (const line of [...v.zh, ...v.en]) if (!text(line)) err(`${where}: every line must be non-empty`)
  }

  if (!entry(catalog)) return { ok: false, errors: ['catalog: not an object'], counts: { plugins: 0, suites: 0 } }
  const schemas = options.schemas ?? CATALOG_SCHEMAS
  if (!schemas.includes(catalog.schema)) err(`schema must be one of ${schemas.join(', ')} (got ${JSON.stringify(catalog.schema)})`)
  if (!Array.isArray(catalog.plugins) || catalog.plugins.length === 0) err('plugins[] is required')
  const plugins = Array.isArray(catalog.plugins) ? catalog.plugins : []
  const suites = Array.isArray(catalog.suites) ? catalog.suites : []
  if (plugins.length > limits.plugins) err(`plugins[] has ${plugins.length} entries, more than the ${limits.plugins} this reader accepts`)
  if (suites.length > limits.suites) err(`suites[] has ${suites.length} entries, more than the ${limits.suites} this reader accepts`)

  const ids = new Set()
  const npmNames = new Set()
  for (const p of plugins) {
    const w = `plugin ${entry(p) ? p.id ?? '?' : '?'}`
    if (!entry(p)) { err(`${w}: not an object`); continue }
    if (!text(p.id) || ids.has(p.id)) err(`${w}: id missing or duplicated`)
    if (typeof p.id === 'string') ids.add(p.id)
    if (p.id !== p.npm) err(`${w}: id must equal npm name`)
    if (!text(p.npm) || !SPEC.test(p.npm)) err(`${w}: npm is not a plain package name (no urls, git specs, paths, versions or tags)`)
    if (npmNames.has(p.npm)) err(`${w}: duplicate npm name`)
    if (typeof p.npm === 'string') npmNames.add(p.npm)
    if (!STABLE.test(p.version ?? '')) err(`${w}: version must be an exact released x.y.z (no range, tag or prerelease)`)
    // When this exact version reached npm. The update screens use it to warn about pnpm's one-day cooldown honestly.
    const published = typeof p.publishedAt === 'string' && ISO_UTC.test(p.publishedAt) ? Date.parse(p.publishedAt) : NaN
    if (Number.isNaN(published)) err(`${w}: publishedAt must be an ISO UTC time such as 2026-10-05T14:40:00.000Z`)
    else if (published < EARLIEST) err(`${w}: publishedAt is before 2020`)
    else if (published > now + 24 * 3600 * 1000) err(`${w}: publishedAt is in the future`)
    if (!ORIGINS.has(p.origin)) err(`${w}: origin`)
    if (!ROLES.has(p.role)) err(`${w}: role`)
    if (!UPDATES.has(p.updates)) err(`${w}: updates`)
    // What a name may claim. A DSH-scoped package is never VibeDev's own, whatever the entry says.
    const scope = typeof p.npm === 'string' ? p.npm.slice(0, p.npm.indexOf('/') + 1) : ''
    // The center itself is listed as a manual row and updated from the Plugins page: it must never
    // appear here, or a click could unload the very panel reading this catalog.
    if ((options.self ?? CATALOG_SELF).includes(p.npm) || (options.self ?? CATALOG_SELF).includes(p.id)) {
      err(`${w}: the ecosystem is not a catalog entry (it is updated from the Plugins page, never installed from here)`)
    }
    if (known.forbiddenScopes.includes(scope)) err(`${w}: ${scope} is not a VibeDev package name`)
    if (p.origin === 'official' && !(known.officialScopes.some((s) => (p.npm ?? '').startsWith(s)) || known.officialGrandfathered.includes(p.npm))) {
      err(`${w}: an "official" entry must be @vibedev-si/* or one of the grandfathered unscoped names`)
    }
    if (p.origin === 'community') {
      if (p.role === 'official') err(`${w}: community entry cannot have role official`)
      if (!p.author) err(`${w}: community entry needs author`)
      if (!known.community.includes(p.npm)) err(`${w}: community entries are limited to the packages this catalog already ships`)
      if (!(p.capabilities ?? []).some((c) => entry(c) && c.key === 'community')) err(`${w}: community entry must carry the "community" capability disclaimer`)
    }
    bi(p.name, `${w}.name`)
    bi(p.tagline, `${w}.tagline`)
    if (entry(p.tagline) && text(p.tagline.zh) && p.tagline.zh.length > limits.taglineLength) err(`${w}.tagline: longer than ${limits.taglineLength} characters`)
    biList(p.does, `${w}.does`)
    // Rendered when present (the card shows this instead of the computed size), so it must be a
    // bilingual string pair like every other rendered field: a payload must not be able to put an
    // object — or a line that disagrees with the real size — there.
    if (p.sizeNote != null) bi(p.sizeNote, `${w}.sizeNote`)
    for (const t of p.tags ?? []) if (!TAGS.has(t)) err(`${w}: unknown tag ${t}`)
    const caps = Array.isArray(p.capabilities) ? p.capabilities : []
    if (caps.length > limits.capabilities) err(`${w}: more than ${limits.capabilities} capabilities`)
    for (const c of caps) {
      if (!entry(c) || !CAPS.has(c.key)) err(`${w}: unknown capability ${entry(c) ? c.key : '?'}`)
      bi(c?.text, `${w}.capabilities.${c?.key}`)
    }
    if (!caps.length) err(`${w}: capabilities must list at least one entry`)
    if (!Number.isFinite(p.sizeKB) || p.sizeKB <= 0) err(`${w}: sizeKB`)
    else if (p.sizeKB > limits.sizeKB) err(`${w}: sizeKB ${p.sizeKB} is larger than the ${limits.sizeKB} KB this reader accepts`)
    if (!p.icon?.glyph?.zh || !p.icon?.glyph?.en || p.icon.grad?.length !== 2) err(`${w}: icon.glyph{zh,en} and icon.grad[2]`)
    if (p.icon?.glyph?.en && /[^\x00-\x7f]/.test(p.icon.glyph.en)) err(`${w}: icon.glyph.en must be plain ASCII (it is shown in the English UI)`)
    for (const c of p.icon?.grad ?? []) if (!HEX.test(String(c))) err(`${w}: icon.grad must be two CSS hex colours (got ${String(c).slice(0, 40)})`)
    // The command is a fixed shape built from the name and version above: a payload cannot smuggle a
    // shell line in, and the reader regenerates it anyway (see normalizeCatalog).
    if (!canonicalCmd(p.npm ?? '', p.version ?? '').test(p.cmd ?? '')) {
      err(`${w}: cmd must be "dsh plugin [--profile <name>] add ${p.npm ?? '?'}[@${p.version ?? '?'}]" and nothing else`)
    }
    // Links: https, no credentials, no query or fragment — and the shapes this catalog actually uses.
    for (const k of ['repo', 'npm']) if (!plainHttps(p.links?.[k])) err(`${w}: links.${k} must be a plain https url`)
    if (plainHttps(p.links?.repo) && p.origin === 'official' && !known.officialRepo.test(p.links.repo)) err(`${w}: links.repo must be a VibeDev repository (${p.links.repo})`)
    if (plainHttps(p.links?.npm) && !known.npmPage.test(p.links.npm)) err(`${w}: links.npm must be the npm package page`)
    if (p.compat != null) {
      if (!COMPAT.has(p.compat.s)) err(`${w}: compat.s`)
      bi(p.compat.why, `${w}.compat.why`)
    }
    if (p.reviewed != null && !(p.reviewed.date && Array.isArray(p.reviewed.tested) && p.reviewed.tested.length)) err(`${w}: reviewed needs date and tested[]`)
  }
  for (const p of plugins) {
    if (!entry(p)) continue
    for (const k of ['requires', 'partners']) {
      if (p[k] !== undefined && !Array.isArray(p[k])) { err(`plugin ${p.id}: ${k} must be an array`); continue }
      for (const d of p[k] ?? []) if (!ids.has(d)) err(`plugin ${p.id}: ${k} points at unknown id ${d}`)
    }
    if (p.legacyNames !== undefined && !Array.isArray(p.legacyNames)) err(`plugin ${p.id}: legacyNames must be an array`)
    else {
      // Legacy aliases are the plain package names this plugin used to be published under (dsh-media):
      // useful for the migration banner, and never a url, a git spec or a path.
      for (const name of p.legacyNames ?? []) {
        if (typeof name !== 'string' || !SPEC.test(name)) err(`plugin ${p.id}: legacyNames must be plain package names (got ${String(name).slice(0, 40)})`)
      }
    }
    if ((p.requires ?? []).includes(p.id)) err(`plugin ${p.id}: requires itself`)
  }
  // dependency cycles
  const visit = (id, path) => {
    if (path.includes(id)) return err(`dependency cycle: ${[...path, id].join(' -> ')}`)
    const p = plugins.find((x) => entry(x) && x.id === id)
    for (const d of p?.requires ?? []) visit(d, [...path, id])
  }
  for (const p of plugins) if (entry(p) && text(p.id)) visit(p.id, [])
  const suiteIds = new Set()
  for (const s of suites) {
    if (!entry(s)) { err('suite: not an object'); continue }
    if (!text(s.id)) err('suite: id is required')
    else if (suiteIds.has(s.id)) err(`suite ${s.id}: id is duplicated`)
    else suiteIds.add(s.id)
    bi(s.name, `suite ${s.id}.name`)
    bi(s.tagline, `suite ${s.id}.tagline`)
    if (!Array.isArray(s.items)) err(`suite ${s.id}: items[] is required`)
    else {
      if (s.items.length > limits.itemsPerSuite) err(`suite ${s.id}: more than ${limits.itemsPerSuite} items`)
      for (const i of s.items) if (!ids.has(i)) err(`suite ${s.id}: unknown item ${i}`)
    }
  }

  return { ok: errors.length === 0, errors, counts: { plugins: plugins.length, suites: suites.length } }
}

/**
 * The error list alone, for a caller that only wants to know why a catalog is refused.
 * @param catalog - the parsed catalog.
 * @param options - as validateCatalog.
 * @returns the error messages, empty when the catalog is fine.
 */
export function catalogErrors(catalog, options) {
  return validateCatalog(catalog, options).errors
}
