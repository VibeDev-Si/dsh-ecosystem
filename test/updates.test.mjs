// /vdc/updates: the allow-listed live update read. These tests pin the properties that make it safe to serve:
// it never runs on its own, nothing in the request can change who is read, a version is accepted only when the
// metadata proves it is that package's own bundle from its own repository, a mirror may only stand in for a
// TRANSPORT failure (never for metadata that failed a check), and a failure is never dressed up as "up to date".
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_PROFILE_DIR = mkdtempSync(join(tmpdir(), 'vdc-updates-'))
const { apply } = await import('../index.js')
const { ALLOWLIST, REGISTRIES, SELF_NAME, normalizeRepo, verifyPackument, createUpdatesReader, MAX_PLUGINS } = await import('../catalog-updates.js')
const { CATALOG_URL } = await import('../remote-catalog.js')

const [NPMJS, MIRROR] = REGISTRIES
const EVERY = [...ALLOWLIST.plugins, ALLOWLIST.self]
const PLUGIN_NAMES = ALLOWLIST.plugins.map((e) => e.name)
const SELF = ALLOWLIST.self
const stable = (name) => (name === SELF_NAME ? '0.1.7' : '9.9.9')
const urlOf = (name, base) => base + name.replace('/', '%2F')
const NOW = '2026-10-07T00:00:00.000Z'
const integrity = () => 'sha512-' + 'A'.repeat(88)

/** One valid packument for any package name and repository; `mutate` breaks exactly one field. */
function buildPackument(name, repo, over = {}, mutate) {
  const latest = over.latest ?? stable(name)
  const doc = {
    name: over.packumentName ?? name,
    'dist-tags': { latest: over.tag ?? latest },
    versions: {
      [latest]: {
        name,
        version: latest,
        dsh: { bundle: { patch: over.patch ?? './cordis.patch.yml' } },
        repository: over.repository ?? { type: 'git', url: 'git+' + repo + '.git' },
        dist: { integrity: over.integrity ?? integrity(), unpackedSize: over.unpackedSize ?? 2048 },
      },
    },
    time: { [latest]: over.time ?? '2026-10-06T17:29:57.457Z' },
  }
  mutate?.(doc, latest)
  return doc
}

/** One valid packument for an allow-listed package (its own repository). */
function packumentFor(name, over = {}, mutate) {
  return buildPackument(name, EVERY.find((e) => e.name === name)?.repo, over, mutate)
}

/** The same, for a package the bundled allow-list has never heard of (the online catalogue may add one). */
function packumentFrom(name, repo, over = {}) {
  return buildPackument(name, repo, over)
}

/** The whole allow-list answering well, as a script for the official registry. */
const allGood = (over = {}) => Object.fromEntries(EVERY.map((e) => {
  const mine = { ...over[e.name] }
  return [urlOf(e.name, NPMJS), packumentFor(e.name, mine, mine.mutate)]
}))

// A scripted registry pair: answers per URL, records every call (url + options).
let calls = []
let script = {}
let delayMs = 0
const respond = (url) => {
  const s = script[url]
  if (typeof s === 'function') return s()
  if (s === undefined) return { ok: false, status: 404, json: async () => ({}), text: async () => '' }
  // `text()` as well as `json()`: the catalogue reader reads the body as text (it has its own byte cap).
  return { ok: true, status: 200, json: async () => s, text: async () => (typeof s === 'string' ? s : JSON.stringify(s)) }
}
const fakeFetch = async (url, opts) => {
  calls.push({ url, opts })
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
  return respond(url)
}

let clock = Date.parse(NOW)
let handler
const webServer = { register: (r) => { handler = r.handler; return () => {} } }
const hostCtx = (catalogReader) => ({
  webRuntime: { trustedHosts: [] }, webServer, effect: (fn) => fn(), __vdcFetch: fakeFetch, __vdcNow: () => clock,
  ...(catalogReader == null ? {} : { __vdcCatalogReader: catalogReader }),
})
/**
 * The catalogue the panel runs against: the shipped one, served as if the online check had just answered it.
 * It names exactly the three official plugins, so the reads below are the same four packuments either way.
 */
const shippedCatalog = JSON.parse(readFileSync(new URL('../catalog/catalog.json', import.meta.url), 'utf8'))
const catalogReaderOf = (catalog = shippedCatalog, over = {}) => ({ read: async () => ({ catalog, source: 'bundled', checkedAt: NOW, ...over }) })
apply(hostCtx(catalogReaderOf()))
const server = createServer((req, res) => handler(req, res))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`
const get = (path, headers) => fetch(base + path, { headers })
const updates = async () => (await get('/vdc/updates')).json()

let n = 0
const t = async (name, fn) => { calls = []; script = {}; delayMs = 0; clock = Date.parse(NOW); await fn(); n++; console.log('ok  ' + name) }
// Every test starts from a clean cache: a fresh apply() makes a new reader. A catalogue reader is passed in
// unless the test is about the entry point's REAL one (which fetches the fixed raw URL like production does).
const fresh = (catalogReader = catalogReaderOf()) => { apply(hostCtx(catalogReader)) }

/* ── the safety frame ─────────────────────────────────────────────────────────────────────────────── */

await t('NOTHING is fetched when the plugin loads, or by any other route', async () => {
  fresh()
  await get('/vdc/ping'); await get('/vdc/config')
  assert.equal(calls.length, 0)
})

await t('the panel asking reads exactly the four allow-listed official packuments, and no mirror', async () => {
  fresh(); script = allGood()
  const j = await updates()
  assert.deepEqual(calls.map((c) => c.url).sort(), EVERY.map((e) => urlOf(e.name, NPMJS)).sort())
  assert.equal(j.ok, true); assert.equal(j.partial, false)
})

await t('the REAL entry point reads the fixed catalogue URL plus the four packuments — five requests, no query', async () => {
  // No catalogue reader injected (null, not the default): this is the wiring the host half actually builds.
  fresh(null)
  script = { [CATALOG_URL]: shippedCatalog, ...allGood() }
  const j = await updates()
  assert.equal(calls.length, 5, calls.map((c) => c.url).join(' '))
  const catalogCall = calls.find((c) => c.url.startsWith('https://raw.githubusercontent.com/'))
  assert.equal(catalogCall?.url, CATALOG_URL, 'the catalogue source is the one fixed raw URL')
  assert.ok(!catalogCall.url.includes('?') && !catalogCall.url.includes('#'), 'no query, no fragment')
  assert.deepEqual(calls.filter((c) => c !== catalogCall).map((c) => c.url).sort(), EVERY.map((e) => urlOf(e.name, NPMJS)).sort())
  assert.equal(j.catalogSource, 'online')
  assert.deepEqual(j.catalog?.plugins?.map((p) => p.npm), shippedCatalog.plugins.map((p) => p.npm))
  assert.equal(j.ok, true)
})

await t('SAFETY: nothing in the request can change who is read (query, headers, suffix, method)', async () => {
  fresh(); script = allGood()
  await get('/vdc/updates?registry=http://evil.example/&name=left-pad&url=http://169.254.169.254/', { 'x-registry': 'http://evil.example/', referer: 'http://evil.example/', cookie: 'session=secret', authorization: 'Bearer secret' })
  assert.ok(calls.every((c) => EVERY.some((e) => c.url === urlOf(e.name, NPMJS) || c.url === urlOf(e.name, MIRROR))), calls.map((c) => c.url).join(' '))
  assert.equal((await get('/vdc/updates/anything')).status, 404)
  assert.equal((await fetch(base + '/vdc/updates', { method: 'POST' })).status, 404)
  assert.equal((await fetch(base + '/vdc/updates', { method: 'PUT' })).status, 404)
  assert.equal(calls.length, 4, 'only the four packuments, and none of them twice')
})

await t('PRIVACY: each outbound request is a bare GET: no cookies, no auth, no body, no identifying headers', async () => {
  fresh(); script = allGood()
  await get('/vdc/updates', { cookie: 'session=secret', authorization: 'Bearer secret' })
  assert.equal(calls.length, 4)
  for (const c of calls) {
    assert.deepEqual(Object.keys(c.opts.headers), ['accept'], 'only an Accept header may be sent')
    assert.equal(c.opts.method, undefined); assert.equal(c.opts.body, undefined)
    assert.equal(c.opts.redirect, 'error', 'a redirect must be an error, not followed')
    assert.ok(c.opts.signal, 'every request needs a timeout')
  }
})

await t('SECURITY: the loopback fence applies, and a refused request fetches nothing', async () => {
  fresh(); script = allGood()
  assert.equal((await get('/vdc/updates', { origin: 'http://evil.example' })).status, 403)
  assert.equal((await get('/vdc/updates', { 'sec-fetch-site': 'cross-site' })).status, 403)
  const code = await new Promise((resolve, reject) => { const u = new URL(base + '/vdc/updates'); const q = httpRequest({ host: '127.0.0.1', port: u.port, path: u.pathname, headers: { host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode) }); q.on('error', reject); q.end() })
  assert.equal(code, 403); assert.equal(calls.length, 0)
})

/* ── the answer's shape ───────────────────────────────────────────────────────────────────────────── */

await t('the batch carries the three plugins and the center apart, each with its verified facts', async () => {
  fresh(); script = allGood()
  const j = await updates()
  // The engine keys its "verified" state on these exact strings, so they are pinned here, not derived.
  assert.deepEqual(REGISTRIES, ['https://registry.npmjs.org/', 'https://registry.npmmirror.com/'])
  // The catalogue fields appear only when a catalogue reader is wired in, so both shapes are accepted here.
  const allowed = ['cached', 'catalog', 'catalogCheckedAt', 'catalogError', 'catalogSource', 'catalogStale', 'checkedAt', 'ok', 'partial', 'plugins', 'self']
  assert.ok(Object.keys(j).every((k) => allowed.includes(k)), Object.keys(j).join(','))
  assert.ok(['checkedAt', 'ok', 'partial', 'plugins', 'self'].every((k) => k in j))
  assert.equal(j.checkedAt, NOW)
  assert.deepEqual(j.plugins.map((p) => p.name), PLUGIN_NAMES)
  for (const p of j.plugins) {
    assert.deepEqual(Object.keys(p).sort(), ['checkedAt', 'integrity', 'name', 'ok', 'publishedAt', 'registry', 'sizeKB', 'sources', 'version'])
    assert.equal(p.ok, true); assert.equal(p.version, '9.9.9'); assert.equal(p.registry, 'https://registry.npmjs.org/')
    assert.equal(p.publishedAt, '2026-10-06T17:29:57.457Z')
    assert.equal(p.integrity, integrity())
    assert.equal(p.sizeKB, 2, '2048 bytes is 2 KB')
    assert.equal(p.checkedAt, NOW); assert.equal(p.sources.length, 1)
    assert.equal(p.sources[0].registry, NPMJS); assert.equal(p.sources[0].state, undefined, 'the internal state is not published')
  }
  // The center reports itself under `latest` (never `version`), and is never a catalogue entry.
  assert.deepEqual(Object.keys(j.self).sort(), ['checkedAt', 'latest', 'ok', 'publishedAt', 'registry', 'sources'])
  assert.equal(j.self.ok, true); assert.equal(j.self.latest, '0.1.7'); assert.equal(j.self.version, undefined); assert.equal(j.self.registry, 'https://registry.npmjs.org/')
  // Nothing claims a mirror was needed, so the screen may call this fully verified.
  assert.equal(JSON.stringify(j).includes('degraded'), false)
})

await t('a missing or unusable size is reported as no size, never as a refusal', async () => {
  fresh(); script = allGood({ [PLUGIN_NAMES[0]]: { unpackedSize: 'huge' } })
  const j = await updates()
  const first = j.plugins.find((p) => p.name === PLUGIN_NAMES[0])
  assert.equal(first.ok, true); assert.equal(first.sizeKB, undefined)
  assert.equal(j.ok, true)
})

/* ── what makes one package's answer unacceptable (unit matrix) ───────────────────────────────────── */

await t('a version is accepted only when the metadata proves it is that package, that bundle and that repository', () => {
  const entry = ALLOWLIST.plugins[1]
  const good = verifyPackument(entry, packumentFor(entry.name))
  assert.deepEqual(good, {
    version: '9.9.9', publishedAt: '2026-10-06T17:29:57.457Z', integrity: integrity(), sizeKB: 2,
  })
  assert.equal(normalizeRepo('https://github.com/VibeDev-Si/dsh-film'), entry.repo)
  assert.equal(normalizeRepo('git+https://github.com/VibeDev-Si/dsh-film.git'), entry.repo)
  assert.equal(normalizeRepo('git://github.com/VibeDev-Si/dsh-film'), entry.repo)
  assert.equal(normalizeRepo('ssh://git@github.com/VibeDev-Si/dsh-film'), entry.repo)
  assert.equal(normalizeRepo({ url: 'git+https://github.com/VibeDev-Si/dsh-film.git/' }), entry.repo)
  for (const junk of [undefined, null, 5, {}, { url: 5 }]) assert.equal(normalizeRepo(junk), undefined)

  const refusals = [
    ['a packument naming another package', packumentFor(entry.name, { packumentName: 'left-pad' })],
    ['no dist-tags at all', packumentFor(entry.name, { tag: undefined }, (d) => { delete d['dist-tags'] })],
    ['a range instead of a version', packumentFor(entry.name, { tag: '^9.9.9' })],
    ['a tag instead of a version', packumentFor(entry.name, { tag: 'latest' })],
    ['a two-part version', packumentFor(entry.name, { tag: '9.9' })],
    ['a four-part version', packumentFor(entry.name, { tag: '9.9.9.9' })],
    ['a v-prefixed version', packumentFor(entry.name, { tag: 'v9.9.9' })],
    ['a prerelease', packumentFor(entry.name, { tag: '9.9.9-beta.1' })],
    ['an empty version', packumentFor(entry.name, { tag: '' })],
    ['a version that is not published', packumentFor(entry.name, {}, (d, latest) => { delete d.versions[latest] })],
    ['a version naming another package', packumentFor(entry.name, {}, (d, latest) => { d.versions[latest].name = 'left-pad' })],
    ['a version naming itself differently', packumentFor(entry.name, {}, (d, latest) => { d.versions[latest].version = '9.9.8' })],
    ['no bundle manifest', packumentFor(entry.name, {}, (d, latest) => { delete d.versions[latest].dsh })],
    ['an empty bundle patch', packumentFor(entry.name, { patch: '   ' })],
    ['another repository', packumentFor(entry.name, { repository: 'https://github.com/evil/dsh-film' })],
    ['a look-alike repository', packumentFor(entry.name, { repository: 'https://github.com/VibeDev-Si/dsh-filmx' })],
    ['a non-https repository', packumentFor(entry.name, { repository: 'http://github.com/VibeDev-Si/dsh-film' })],
    ['no integrity', packumentFor(entry.name, {}, (d, latest) => { delete d.versions[latest].dist.integrity })],
    ['a non-sha512 integrity', packumentFor(entry.name, { integrity: 'md5-abc' })],
    ['a malformed sha512', packumentFor(entry.name, { integrity: 'sha512-!!!not base64!!!' })],
    ['no publish time', packumentFor(entry.name, {}, (d, latest) => { delete d.time[latest] })],
    ['an unreadable publish time', packumentFor(entry.name, { time: 'not a date' })],
    ['not an object', null],
    ['an HTML error page parsed as JSON', 'not an object at all'],
  ]
  for (const [why, doc] of refusals) {
    const verdict = verifyPackument(entry, doc)
    assert.ok(verdict.error, `${why} was accepted`)
    assert.equal(verdict.version, undefined)
  }
  // A size that changed is NOT a refusal: a newer version may legitimately be a different size.
  assert.equal(verifyPackument(entry, packumentFor(entry.name, { unpackedSize: 999 * 1024 * 1024 })).sizeKB, 999 * 1024)
})

await t('a refused package fails the batch and is reported, while the others still answer', async () => {
  fresh()
  script = allGood({ [PLUGIN_NAMES[0]]: { repository: 'https://github.com/evil/dsh-vibedev' } })
  const j = await updates()
  const bad = j.plugins.find((p) => p.name === PLUGIN_NAMES[0])
  assert.equal(j.ok, false); assert.equal(j.partial, true)
  assert.equal(bad.ok, false); assert.equal(bad.version, undefined)
  assert.match(bad.error, /repository/)
  assert.equal(bad.registry, NPMJS)
  assert.equal(j.plugins.filter((p) => p.ok).length, 2)
  assert.equal(j.self.ok, true)
})

/* ── registries: official first, a mirror only for a transport failure ────────────────────────────── */

await t('official wins even when the mirror reports a higher version: the mirror is never asked', async () => {
  fresh()
  script = allGood()
  for (const e of EVERY) script[urlOf(e.name, MIRROR)] = packumentFor(e.name, { latest: '99.0.0' })
  const j = await updates()
  assert.equal(j.ok, true)
  for (const p of j.plugins) assert.equal(p.version, '9.9.9')
  assert.equal(j.self.latest, '0.1.7')
  assert.ok(calls.every((c) => c.url.startsWith(NPMJS)), 'no mirror may be read while the official registry answers')
})

await t('a transport failure falls back to the mirror, and the answer says so', async () => {
  fresh()
  script = Object.fromEntries(EVERY.map((e) => [urlOf(e.name, MIRROR), packumentFor(e.name)]))
  script[urlOf(PLUGIN_NAMES[0], NPMJS)] = () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }) }
  script[urlOf(PLUGIN_NAMES[1], NPMJS)] = () => ({ ok: false, status: 503, json: async () => ({}) })
  script[urlOf(PLUGIN_NAMES[2], NPMJS)] = () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <') } })
  script[urlOf(SELF.name, NPMJS)] = () => { throw Object.assign(new Error('getaddrinfo'), { cause: { code: 'ENOTFOUND' } }) }
  const j = await updates()
  assert.equal(j.ok, true, JSON.stringify(j))
  for (const p of j.plugins) { assert.equal(p.registry, MIRROR); assert.equal(p.degraded, true); assert.equal(p.sources.length, 2) }
  assert.equal(j.self.registry, MIRROR); assert.equal(j.self.degraded, true)
  assert.equal(j.plugins[0].sources[0].error, 'timeout')
  assert.equal(j.plugins[1].sources[0].error, 'HTTP 503')
  assert.equal(j.plugins[2].sources[0].error, 'answer is not JSON')
  assert.equal(j.self.sources[0].error, 'ENOTFOUND')
})

await t('metadata that failed a check is a refusal: a good mirror answer must NOT rescue it', async () => {
  fresh()
  script = allGood({ [PLUGIN_NAMES[0]]: { packumentName: 'left-pad' } })
  // A perfectly good mirror answer exists for every package, and none of them may be used.
  for (const e of EVERY) script[urlOf(e.name, MIRROR)] = packumentFor(e.name)
  const j = await updates()
  const bad = j.plugins.find((p) => p.name === PLUGIN_NAMES[0])
  assert.equal(bad.ok, false); assert.match(bad.error, /names left-pad/)
  assert.equal(bad.registry, NPMJS)
  assert.equal(bad.sources.length, 1, 'the mirror must not even be asked')
  assert.ok(calls.every((c) => c.url.startsWith(NPMJS)))
  assert.equal(j.ok, false)
})

await t('both registries unreachable: ok:false with every reason, never "up to date"', async () => {
  fresh()
  const j = await updates()
  assert.equal(j.ok, false); assert.equal(j.partial, false)
  assert.equal(j.plugins.length, 3)
  for (const p of j.plugins) { assert.equal(p.ok, false); assert.equal(p.version, undefined); assert.equal(p.error, 'HTTP 404'); assert.equal(p.sources.length, 2) }
  assert.equal(j.self.ok, false); assert.equal(j.self.error, 'HTTP 404')
})

/* ── cache, coalescing and re-checking ────────────────────────────────────────────────────────────── */

await t('a successful batch is cached for a minute; after that it is read again', async () => {
  fresh(); script = allGood()
  await updates()
  assert.equal(calls.length, 4)
  const cached = await updates()
  assert.equal(calls.length, 4, 'a second look inside the minute must not fetch again')
  assert.equal(cached.cached, true); assert.equal(cached.ok, true); assert.equal(cached.checkedAt, NOW)
  clock += 61_000
  const later = await updates()
  assert.equal(calls.length, 8, 'past the minute it reads again')
  assert.equal(later.cached, undefined)
  assert.equal(later.checkedAt, new Date(clock).toISOString())
})

await t('a FAILURE is never cached: the next look tries again', async () => {
  fresh()
  const first = await updates(); assert.equal(first.ok, false)
  const after = calls.length
  script = allGood()
  const second = await updates()
  assert.ok(calls.length > after, 'must read again after a failure')
  assert.equal(second.ok, true)
})

await t('two looks at once share one batch: a double click cannot double the requests', async () => {
  fresh(); script = allGood(); delayMs = 60
  const [a, b] = await Promise.all([updates(), updates()])
  assert.equal(calls.length, 4, 'both callers must wait for the same four reads')
  assert.equal(a.ok, true); assert.equal(b.ok, true)
})

await t('the reader itself: an injected clock drives its own minute', async () => {
  let at = Date.parse(NOW)
  const seen = []
  const reader = createUpdatesReader(async (url) => { seen.push(url); return { ok: true, status: 200, json: async () => packumentFor(EVERY.find((e) => urlOf(e.name, NPMJS) === url).name) } }, () => at)
  assert.equal((await reader.read()).ok, true)
  assert.equal(seen.length, 4)
  assert.equal((await reader.read()).cached, true)
  assert.equal(seen.length, 4)
  at += 60_001
  await reader.read()
  assert.equal(seen.length, 8)
})

/* ── the online catalogue: a validated reader decides which packages are read ──────────────────────── */

const FUTURE = '@vibedev-si/future-tool'
const FUTURE_REPO = 'https://github.com/VibeDev-Si/future-tool'
const repoOf = (name) => EVERY.find((e) => e.name === name).repo
const links = (repo) => ({ repo })
/** A catalogue entry as the validator would pass it on: official, with the repository npm must confirm. */
const entryFor = (npm, version, repo) => ({ id: npm, npm, version, origin: 'official', role: 'official', updates: 'center', links: links(repo) })

/** A validated catalogue: the official packages, plus a community entry and this center's own entry, which
 *  must never be read as plugins (the center is read from its constant repository instead). */
const catalogFixture = () => ({
  schema: 1,
  updated: '2026-10-07',
  plugins: [
    entryFor(PLUGIN_NAMES[0], '0.2.5', repoOf(PLUGIN_NAMES[0])),
    entryFor(PLUGIN_NAMES[1], '0.3.3', repoOf(PLUGIN_NAMES[1])),
    entryFor(PLUGIN_NAMES[2], '0.1.3', repoOf(PLUGIN_NAMES[2])),
    { id: 'dshmarket', npm: 'dshmarket', version: '1.66.8', origin: 'community', links: links('https://github.com/dsh-market/dsh-market') },
    entryFor(SELF_NAME, '0.1.7', repoOf(SELF_NAME)),
  ],
})
/** The same catalogue after the online one gained a plugin this center never shipped. */
const catalogWithFuture = () => {
  const catalog = catalogFixture()
  catalog.plugins.splice(3, 0, entryFor(FUTURE, '0.0.1', FUTURE_REPO))
  return catalog
}
const readerOf = (answer) => ({ read: async () => (typeof answer === 'function' ? answer() : answer) })
const online = (catalog, over = {}) => readerOf(() => ({ catalog, source: 'online', checkedAt: NOW, ...over }))

await t('with a catalogue reader, the packages it names are read — including one this center never shipped', async () => {
  const reader = createUpdatesReader(fakeFetch, () => clock, online(catalogWithFuture()))
  script = { ...allGood(), [urlOf(FUTURE, NPMJS)]: packumentFrom(FUTURE, FUTURE_REPO, { latest: '2.0.0' }) }
  const j = await reader.read()
  assert.ok(calls.some((c) => c.url === urlOf(FUTURE, NPMJS)), 'a package the online catalogue added must be read from the official registry')
  const added = j.plugins.find((p) => p.name === FUTURE)
  assert.equal(added?.ok, true); assert.equal(added.version, '2.0.0')
  assert.deepEqual(j.plugins.map((p) => p.name), [...PLUGIN_NAMES, FUTURE])
  assert.equal(calls.filter((c) => c.url.includes('dshmarket')).length, 0, 'a community entry is never read')
  assert.equal(calls.filter((c) => c.url === urlOf(SELF_NAME, NPMJS)).length, 1, 'this center is read once, from its constant repository')
  assert.equal(j.self.ok, true); assert.equal(j.self.latest, '0.1.7')
  assert.deepEqual(j.catalog, catalogWithFuture(), 'the answer carries the validated catalogue it was read against')
  assert.equal(j.catalogSource, 'online'); assert.equal(j.catalogCheckedAt, NOW)
  assert.ok(!('catalogError' in j) && !('catalogStale' in j), JSON.stringify(Object.keys(j)))
})

await t('a catalogue that changes is read again in the same process: a new package is never missed', async () => {
  let catalog = catalogFixture()
  const reader = createUpdatesReader(fakeFetch, () => clock, readerOf(() => ({ catalog, source: 'online', checkedAt: NOW })))
  script = { ...allGood(), [urlOf(FUTURE, NPMJS)]: packumentFrom(FUTURE, FUTURE_REPO, { latest: '2.0.0' }) }
  const first = await reader.read()
  assert.equal(first.ok, true)
  assert.ok(!first.plugins.some((p) => p.name === FUTURE))
  const before = calls.length
  catalog = catalogWithFuture()
  const second = await reader.read()
  assert.ok(calls.length > before, 'the changed list must be read, never served from the previous cache')
  const added = second.plugins.find((p) => p.name === FUTURE)
  assert.equal(added?.ok, true); assert.equal(added.version, '2.0.0')
  assert.equal(second.cached, undefined)
  assert.ok(!second.plugins.some((p) => p.name === 'dshmarket'))
  // Dropping it again is also a different list: it is read again and the package is gone from the answer.
  catalog = catalogFixture()
  const third = await reader.read()
  assert.ok(!third.plugins.some((p) => p.name === FUTURE))
})

await t('the same catalogue inside the minute is a cache hit; the injected clock ends it', async () => {
  const reader = createUpdatesReader(fakeFetch, () => clock, online(catalogFixture()))
  script = allGood()
  await reader.read()
  const hits = calls.length
  const again = await reader.read()
  assert.equal(again.cached, true); assert.equal(calls.length, hits)
  clock += 60_001
  const later = await reader.read()
  assert.equal(later.cached, undefined); assert.ok(calls.length > hits)
})

await t('an offline catalogue is reported as bundled, with its reason and staleness, and its packages are still read', async () => {
  const reader = createUpdatesReader(fakeFetch, () => clock, readerOf(() => ({ catalog: catalogFixture(), source: 'bundled', checkedAt: NOW, error: 'HTTP 503', stale: true })))
  script = allGood()
  const j = await reader.read()
  assert.equal(j.catalogSource, 'bundled'); assert.equal(j.catalogError, 'HTTP 503'); assert.equal(j.catalogStale, true)
  assert.equal(j.ok, true); assert.deepEqual(j.plugins.map((p) => p.name), PLUGIN_NAMES)
})

await t('a reader that throws, or answers no catalogue, leaves the fixed allow-list in place', async () => {
  script = allGood()
  for (const reader of [readerOf(() => { throw new Error('boom') }), readerOf(() => ({ source: 'bundled', checkedAt: NOW }))]) {
    const j = await createUpdatesReader(fakeFetch, () => clock, { read: () => Promise.resolve().then(() => reader.read()) }).read()
    assert.equal(j.catalogSource, 'bundled')
    assert.deepEqual(j.plugins.map((p) => p.name), PLUGIN_NAMES, 'the three shipped packages stay readable')
    assert.equal(j.self.ok, true)
  }
})

await t('a large catalogue is read four at a time, this center included, and never past the cap', async () => {
  const names = Array.from({ length: 12 }, (_, i) => `@vibedev-si/tool-${i}`)
  const repoFor = (n) => `https://github.com/VibeDev-Si/${n.split('/')[1]}`
  const catalog = { schema: 1, plugins: names.map((n) => entryFor(n, '1.0.0', repoFor(n))) }
  let inFlight = 0
  let peak = 0
  const slowFetch = async (url) => {
    inFlight += 1
    peak = Math.max(peak, inFlight)
    await new Promise((r) => setTimeout(r, 5))
    inFlight -= 1
    const name = names.find((n) => urlOf(n, NPMJS) === url) ?? SELF_NAME
    return { ok: true, status: 200, json: async () => packumentFrom(name, name === SELF_NAME ? repoOf(SELF_NAME) : repoFor(name), { latest: '1.1.0' }) }
  }
  const j = await createUpdatesReader(slowFetch, () => clock, online(catalog)).read()
  assert.equal(j.ok, true); assert.equal(j.plugins.length, 12)
  assert.equal(peak, 4, 'at most four packuments in flight, this center included')
})

await t('a catalogue wider than the cap is read only up to it', async () => {
  const names = Array.from({ length: 45 }, (_, i) => `@vibedev-si/wide-${i}`)
  const repoFor = (n) => `https://github.com/VibeDev-Si/${n.split('/')[1]}`
  const catalog = { schema: 1, plugins: names.map((n) => entryFor(n, '1.0.0', repoFor(n))) }
  const seen = []
  const j = await createUpdatesReader(async (url) => {
    seen.push(url)
    const name = names.find((n) => urlOf(n, NPMJS) === url) ?? SELF_NAME
    return { ok: true, status: 200, json: async () => packumentFrom(name, name === SELF_NAME ? repoOf(SELF_NAME) : repoFor(name), { latest: '1.1.0' }) }
  }, () => clock, online(catalog)).read()
  assert.equal(j.plugins.length, MAX_PLUGINS, 'the cap')
  assert.equal(seen.length, MAX_PLUGINS + 1, 'the cap, plus this center')
  assert.ok(seen.includes(urlOf(SELF_NAME, NPMJS)))
})

await t('a slow package cannot hold the batch: the budget ends it, the rows that answered stay, no version is invented', async () => {
  const names = ['@vibedev-si/fast-one', '@vibedev-si/slow-one', '@vibedev-si/fast-two']
  const repoFor = (n) => `https://github.com/VibeDev-Si/${n.split('/')[1]}`
  const catalog = { schema: 1, plugins: names.map((n) => entryFor(n, '1.0.0', repoFor(n))) }
  const never = new Promise(() => {}) // a transport that ignores its signal entirely
  const slow = '@vibedev-si/slow-one'
  const doFetch = async (url) => {
    const name = names.find((n) => urlOf(n, NPMJS) === url) ?? SELF_NAME
    if (name === slow) return never
    return { ok: true, status: 200, json: async () => packumentFrom(name, name === SELF_NAME ? repoOf(SELF_NAME) : repoFor(name), { latest: '1.1.0' }) }
  }
  const reader = createUpdatesReader(doFetch, () => clock, online(catalog), { budgetMs: 30 })
  const started = Date.now()
  const j = await reader.read()
  const took = Date.now() - started
  assert.ok(took < 2000, `the batch must end on its own budget, took ${took}ms`)
  assert.equal(j.ok, false, 'a row that never answered is a failure, not a version')
  const stuck = j.plugins.find((p) => p.name === slow)
  assert.equal(stuck.ok, false); assert.equal(stuck.error, 'timeout')
  assert.equal(stuck.version, undefined, 'no latest, no publishedAt, no integrity for a row that was never read')
  assert.equal(stuck.publishedAt, undefined); assert.equal(stuck.integrity, undefined)
  assert.deepEqual(j.plugins.filter((p) => p.ok).map((p) => p.name), ['@vibedev-si/fast-one', '@vibedev-si/fast-two'])
  assert.equal(j.self.ok, true)
  assert.deepEqual(j.catalog, catalog, 'the catalogue is kept even when a row failed')
})

await t('after the budget no new packument is requested: the queue tail is reported, never read', async () => {
  const names = Array.from({ length: 8 }, (_, i) => `@vibedev-si/queued-${i}`)
  const repoFor = (n) => `https://github.com/VibeDev-Si/${n.split('/')[1]}`
  const catalog = { schema: 1, plugins: names.map((n) => entryFor(n, '1.0.0', repoFor(n))) }
  const requested = []
  const never = new Promise(() => {})
  const reader = createUpdatesReader(async (url) => { requested.push(url); return never }, () => clock, online(catalog), { budgetMs: 40 })
  const j = await reader.read()
  assert.equal(requested.length, 4, 'only the first wave is asked for: ' + requested.join(' '))
  assert.deepEqual(requested.map((u) => u.replace(NPMJS, '')).sort(), names.slice(0, 4).map((n) => n.replace('/', '%2F')).sort())
  assert.equal(j.plugins.length, 8, 'every row is reported')
  assert.ok(j.plugins.every((p) => p.ok === false && p.error === 'timeout'))
  assert.equal(j.self.ok, false, 'this center is last in the queue and is reported, not guessed')
  assert.equal(j.self.error, 'timeout'); assert.equal(j.self.latest, undefined)
  assert.deepEqual(j.catalog, catalog)
})

await t('a budget that is not spent is never noticed: a fast batch keeps its real versions', async () => {
  const catalog = catalogFixture()
  const reader = createUpdatesReader(fakeFetch, () => clock, online(catalog), { budgetMs: 5000 })
  script = allGood()
  const j = await reader.read()
  assert.equal(j.ok, true)
  assert.ok(j.plugins.every((p) => p.ok && p.version === '9.9.9'))
  assert.equal(j.self.ok, true)
})

server.close()
console.log(`\n${n} updates tests passed`)
