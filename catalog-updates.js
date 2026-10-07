/**
 * The live update reader for the VibeDev plugins the catalogue names.
 *
 * The catalogue answers "what do we know about these plugins"; this module answers the other question — what npm
 * has now — for the packages it names. Which packages those are comes from ONE of two places, never from the
 * request:
 *
 *   - with no catalogue reader wired in, the fixed allow-list below (the three official plugins and this center,
 *     each with the repository its metadata must name);
 *   - with a catalogue reader (the host half passes one), the packages of the validated ONLINE catalogue it
 *     returns: `catalog.plugins` entries that are `origin: 'official'` and are not this center, taking each
 *     entry's `links.repo` as the repository its npm metadata must name. The reader is trusted to have validated
 *     those entries (identity, repository shape, no paths); this module only consumes the list, and still
 *     verifies every package it reads.
 * This center itself is always read with its constant repository and is never taken from the catalogue: it
 * cannot replace itself while it runs.
 *
 * Because the catalogue is read through the reader on every handler call, a plugin added to the online catalogue
 * becomes visible without a new release of this center. That is also why the update cache is keyed on the
 * package-list signature (names, expected repositories, catalogue versions) instead of a fixed list: adding,
 * removing or repinning a package starts a fresh read rather than serving the previous set from cache.
 *
 * Official first: only registry.npmjs.org decides what the newest version is. A mirror answers only when the
 * official read failed at the transport level (network error, timeout, a non-ok HTTP status, a body that is
 * not JSON), and its answer must pass exactly the same checks; it is reported with `degraded: true` and the
 * registry that supplied it. Metadata that arrived and then failed a check is a refusal — not a reason to
 * ask somebody else. No answer is ever combined across registries, and no version is compared between them.
 *
 * One package is accepted only when every one of these holds:
 *   - the packument names that package;
 *   - `dist-tags.latest` is a stable `x.y.z` (a prerelease or a range is never an update target);
 *   - that version exists in `versions`, and its own `name`/`version` are the ones asked for;
 *   - it carries a non-empty `dsh.bundle.patch` (the plugin manager refuses anything else);
 *   - its `repository` normalises to the expected https GitHub repository;
 *   - its `dist.integrity` is a sha512 in npm's shape;
 *   - npm's publish time for that version parses (a missing or unreadable time is a refusal).
 * `sizeKB` comes from `dist.unpackedSize` when that is a positive finite number; a size that differs from
 * the catalogue's snapshot is NOT a refusal, because a newer version may legitimately be a different size.
 *
 * Nothing here runs on import: the only outbound requests are the packuments `read()` asks for, which the
 * `/vdc/updates` handler calls for a GET. A fully successful answer is cached for a minute; a failure is never
 * cached, so the next click tries again. Concurrent reads share one batch, so a double click cannot multiply the
 * requests. At most {@link MAX_PLUGINS} catalogue packages are read, {@link CONCURRENCY} at a time, and this
 * center counts as one of them; the whole batch is bounded by {@link BATCH_BUDGET_MS}.
 */

/** This center. It is NOT a catalogue entry: the center cannot replace itself while it runs. */
export const SELF_NAME = '@vibedev-si/dsh-ecosystem'

/**
 * The packages this center may read from npm, each with the repository its metadata must name. Fixed here on
 * purpose: the page cannot name a package, and the catalogue cannot add one.
 */
export const ALLOWLIST = {
  plugins: [
    { name: '@vibedev-si/dsh-vibedev', repo: 'https://github.com/VibeDev-Si/dsh-vibedev' },
    { name: 'dsh-film', repo: 'https://github.com/VibeDev-Si/dsh-film' },
    { name: '@vibedev-si/dsh-media-viewer', repo: 'https://github.com/VibeDev-Si/dsh-media-viewer' },
  ],
  self: { name: SELF_NAME, repo: 'https://github.com/VibeDev-Si/dsh-ecosystem' },
}

/** The two registries, in the order they are trusted: the official one first, the mirror only as a fallback. */
export const REGISTRIES = ['https://registry.npmjs.org/', 'https://registry.npmmirror.com/']

/** How many catalogue packages one read may cover, and how many of them may be in flight at once. */
export const MAX_PLUGINS = 40
export const CONCURRENCY = 4

/**
 * The whole metadata batch has to finish inside this, however long the queue is: with forty packages four at a
 * time on a slow network the tail would otherwise keep the screen waiting for minutes. Once it is spent, no new
 * packument is requested, whatever is still in flight is aborted, and the rows that never answered are reported
 * as failures — never as current versions.
 */
export const BATCH_BUDGET_MS = 20_000

/** A stable release only: no prerelease, no build metadata, no range. */
const STABLE = /^\d+\.\d+\.\d+$/
/** npm's sha512 integrity shape. */
const INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/
const TIMEOUT_MS = 8000
const CACHE_MS = 60_000
const MAX_ERROR = 120

/**
 * One `repository` field (a string or `{url}`) normalised for comparison: the transport prefix dropped and
 * the trailing `.git`/slashes removed, so `git+https://github.com/x/y.git` and `https://github.com/x/y`
 * compare equal. Only an https GitHub URL can ever equal an expected repository, which is what makes the
 * comparison a check rather than a formality.
 * @param value - the packument's repository field.
 * @returns the normalised URL, or undefined when there is nothing usable.
 */
export function normalizeRepo(value) {
  const raw = typeof value === 'string' ? value : (value && typeof value.url === 'string' ? value.url : undefined)
  if (typeof raw !== 'string') return undefined
  return raw.trim()
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
}

/** The error text one failed read carries, bounded like the host's own diagnostics. */
const text = (value) => String(value ?? '').slice(0, MAX_ERROR)

/**
 * Verify one packument answer against one allow-listed entry.
 * @param entry - the allow-listed package and its expected repository.
 * @param json - the parsed packument.
 * @returns the accepted facts, or the reason the answer was refused.
 */
export function verifyPackument(entry, json) {
  if (!json || typeof json !== 'object') return { error: 'answer is not an object' }
  if (json.name !== entry.name) return { error: `answer names ${text(json.name) || 'nothing'}` }
  const latest = json['dist-tags']?.latest
  if (typeof latest !== 'string' || !STABLE.test(latest)) return { error: `latest ${text(latest) || 'is missing'} is not a stable version` }
  const version = json.versions?.[latest]
  if (!version || typeof version !== 'object') return { error: `versions has no ${latest}` }
  if (version.name !== entry.name || version.version !== latest) return { error: `versions.${latest} names ${text(version.name)}@${text(version.version)}` }
  const patch = version.dsh?.bundle?.patch
  if (typeof patch !== 'string' || patch.trim() === '') return { error: `${latest} carries no dsh.bundle.patch` }
  const repo = normalizeRepo(version.repository ?? json.repository)
  if (repo !== entry.repo) return { error: `${latest} names repository ${text(repo) || 'nothing'}` }
  const integrity = version.dist?.integrity
  if (typeof integrity !== 'string' || !INTEGRITY.test(integrity)) return { error: `${latest} carries no sha512 integrity` }
  const at = json.time?.[latest]
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return { error: `${latest} has no readable publish time` }
  const bytes = version.dist?.unpackedSize
  const sizeKB = Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes / 1024) : undefined
  return { version: latest, publishedAt: new Date(at).toISOString(), integrity, sizeKB }
}

/**
 * Read one registry for one entry. Never throws; the state decides what the caller may do next:
 * `ok` (verified), `refused` (metadata arrived and failed a check — nobody else may answer instead) or
 * `unavailable` (the transport failed, so the next registry may be asked).
 * @param base - registry base URL, without the package name.
 * @param entry - the package to read.
 * @param doFetch - the fetch to use.
 * @param signal - the batch's signal: when the budget is spent, an in-flight request is cut off with it.
 * @returns one source record for the answer's `sources`.
 */
async function readSource(base, entry, doFetch, signal) {
  const t0 = Date.now()
  const done = (o) => ({ registry: base, ms: Date.now() - t0, ...o })
  try {
    const r = await doFetch(base + entry.name.replace('/', '%2F'), {
      headers: { accept: 'application/json' },
      // Both bounds apply: this request's own timeout, and the batch's remaining budget.
      signal: signal === undefined ? AbortSignal.timeout(TIMEOUT_MS) : AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), signal]),
      redirect: 'error',
    })
    if (!r.ok) return done({ state: 'unavailable', error: `HTTP ${r.status}` })
    let json
    try { json = await r.json() } catch { return done({ state: 'unavailable', error: 'answer is not JSON' }) }
    const verdict = verifyPackument(entry, json)
    return verdict.error === undefined ? done({ state: 'ok', ...verdict }) : done({ state: 'refused', error: verdict.error })
  } catch (e) {
    return done({ state: 'unavailable', error: text(e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : e?.cause?.code ?? e?.message ?? e) })
  }
}

/** Every source record without the state, which is internal to this module. */
const publicSource = ({ state: _state, ...rest }) => rest

/**
 * Read one package once, official first.
 * @param entry - the package to read.
 * @param doFetch - the fetch to use.
 * @param now - the clock, injected so tests can move time.
 * @param signal - the batch's signal.
 * @returns one package answer in the shape the route publishes.
 */
async function readPackage(entry, doFetch, now, signal) {
  const sources = []
  const first = await readSource(REGISTRIES[0], entry, doFetch, signal)
  sources.push(first)
  let answer = first
  let degraded = false
  if (first.state === 'unavailable') {
    // Only a transport failure falls back: metadata that failed a check is this package's answer.
    const second = await readSource(REGISTRIES[1], entry, doFetch, signal)
    sources.push(second)
    answer = second
    degraded = second.state === 'ok'
  }
  const checkedAt = new Date(now()).toISOString()
  const base = { name: entry.name, ok: answer.state === 'ok', checkedAt, sources: sources.map(publicSource) }
  if (answer.state !== 'ok') return { ...base, registry: answer.registry, error: answer.error }
  return {
    ...base,
    version: answer.version,
    publishedAt: answer.publishedAt,
    integrity: answer.integrity,
    ...(answer.sizeKB === undefined ? {} : { sizeKB: answer.sizeKB }),
    registry: answer.registry,
    ...(degraded ? { degraded: true } : {}),
  }
}

/**
 * Build one reader: it owns the cache and the in-flight batch, so every call for a fresh answer goes through
 * the same two gates.
 * @param doFetch - the fetch to use; the host passes its own (with a test hook in front of the real one).
 * @param now - the clock in milliseconds; defaults to `Date.now`.
 * @param catalogReader - optional `{ read(): Promise<{catalog, source, checkedAt, error?, stale?}> }`, the
 *   validated online catalogue. Without it the fixed {@link ALLOWLIST} is read; with it, the catalogue decides
 *   which packages are read (this center always is), and the answer carries the catalogue it was read against.
 * @param options - `{ budgetMs }`: the whole batch's bound. Tests lower it; the host never sets it.
 * @returns the reader, whose `read()` answers the whole batch.
 */
export function createUpdatesReader(doFetch, now = Date.now, catalogReader, options = {}) {
  let cache // {signature, at, body}: a fully successful answer, kept for a minute
  let inflight // {signature, task}: the batch a concurrent caller is already waiting for
  const budgetMs = options.budgetMs ?? BATCH_BUDGET_MS

  /**
   * What to read: the fixed allow-list, or the validated catalogue's official packages plus this center.
   * @returns the entries to read (this center last) and the catalogue fields the answer carries.
   */
  const targets = async () => {
    if (catalogReader === undefined) return { list: [...ALLOWLIST.plugins, ALLOWLIST.self], meta: {} }
    // A reader that throws or answers nonsense falls back to its own bundled catalogue: it may not take the
    // whole screen down, and the packages it does name are still verified here.
    const answer = await Promise.resolve()
      .then(() => catalogReader.read())
      .catch((error) => ({ source: 'bundled', error: error?.message ?? error }))
    const catalog = answer?.catalog
    const named = Array.isArray(catalog?.plugins) ? catalog.plugins : undefined
    const plugins = (named ?? [])
      .filter((p) => p?.origin === 'official' && typeof p?.npm === 'string' && p.npm !== SELF_NAME)
      .slice(0, MAX_PLUGINS)
      .map((p) => ({ name: p.npm, repo: normalizeRepo(p.links?.repo), version: typeof p.version === 'string' ? p.version : undefined }))
    return {
      // A reader that answered with no catalogue at all leaves the fixed allow-list in place: an unreadable
      // catalogue must not empty the screen, and those three packages are the ones this center ships knowing.
      list: [...(named === undefined ? ALLOWLIST.plugins : plugins), ALLOWLIST.self],
      meta: {
        ...(catalog && typeof catalog === 'object' ? { catalog } : {}),
        catalogSource: typeof answer?.source === 'string' ? answer.source : 'bundled',
        ...(answer?.error === undefined ? {} : { catalogError: text(answer.error) }),
        catalogCheckedAt: typeof answer?.checkedAt === 'string' ? answer.checkedAt : new Date(now()).toISOString(),
        ...(answer?.stale === true ? { catalogStale: true } : {}),
      },
    }
  }

  /** The list's identity: a different set of names or repositories is a different read, never a cache hit. */
  const signatureOf = (list) => JSON.stringify(list.map((e) => [e.name, e.repo ?? null, e.version ?? null]))

  const readAll = async (list, signature, at, meta) => {
    // The budget: once it is spent, no new packument is asked for, the ones in flight are aborted, and the rows
    // that never answered are failures. A fake transport that ignores the signal still cannot hold the batch.
    const batch = new AbortController()
    let spent = false
    let fireSpent
    const spentSignal = new Promise((resolve) => { fireSpent = resolve })
    const timer = setTimeout(() => { spent = true; batch.abort(); fireSpent('spent') }, budgetMs)
    const results = new Array(list.length)
    let next = 0
    /** A row the budget stopped: a failure, with no version claim of any kind. */
    const stopped = (entry) => ({ name: entry.name, ok: false, checkedAt: new Date(now()).toISOString(), error: 'timeout', sources: [] })
    const readOne = async (entry) => {
      if (spent) return stopped(entry)
      const raced = await Promise.race([readPackage(entry, doFetch, now, batch.signal), spentSignal])
      return raced === 'spent' ? stopped(entry) : raced
    }
    // A handful at a time, this center included: a catalogue that grew large may not open a connection per entry.
    const worker = async () => {
      for (;;) {
        const index = next++
        if (index >= list.length) return
        results[index] = await readOne(list[index])
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.max(1, Math.min(CONCURRENCY, list.length)) }, worker))
    } finally {
      clearTimeout(timer)
    }
    const self = results[results.length - 1]
    const plugins = results.slice(0, -1)
    const ok = plugins.every((p) => p.ok) && self.ok
    const body = {
      ok,
      // Some, but not all: the screen may name what it knows and must still not claim everything is current.
      partial: !ok && (plugins.some((p) => p.ok) || self.ok),
      checkedAt: new Date(at).toISOString(),
      ...meta,
      plugins,
      // The center itself is reported apart, and is never a catalogue entry: it cannot replace itself.
      self: {
        ok: self.ok,
        checkedAt: self.checkedAt,
        ...(self.ok
          ? { latest: self.version, publishedAt: self.publishedAt, registry: self.registry, ...(self.degraded ? { degraded: true } : {}) }
          : { registry: self.registry, error: self.error }),
        sources: self.sources,
      },
    }
    // Only a fully successful read is cached; a failure must be retried on the next click.
    if (ok) cache = { signature, at, body }
    return body
  }

  return {
    async read() {
      const { list, meta } = await targets()
      const signature = signatureOf(list)
      const at = now()
      if (cache !== undefined && cache.signature === signature && at - cache.at < CACHE_MS) {
        return { ...cache.body, cached: true }
      }
      // A second click while the first batch is running waits for it instead of reading everything again — but
      // only for the same list: a catalogue that changed must not be answered from the previous batch.
      if (inflight === undefined || inflight.signature !== signature) {
        const task = readAll(list, signature, at, meta).finally(() => { if (inflight?.task === task) inflight = undefined })
        inflight = { signature, task }
      }
      return inflight.task
    },
  }
}
