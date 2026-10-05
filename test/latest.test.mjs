// /vdc/latest: the only outbound network use of the host half. These tests pin its safety properties:
// it never runs on its own, it cannot be steered by the page, it never shows a hostile answer, and it never lies about a failure.
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_PROFILE_DIR = mkdtempSync(join(tmpdir(), 'vdc-latest-'))
const { apply, latestVersion, readRegistry, compareVersions } = await import('../index.js')

const NPMJS = 'https://registry.npmjs.org/@vibedev-si%2Fdsh-ecosystem'
const MIRROR = 'https://registry.npmmirror.com/@vibedev-si%2Fdsh-ecosystem'
const PKG = '@vibedev-si/dsh-ecosystem'

// A scripted registry: answers per URL, records every call (url + options).
let calls = []
let script = {}
const packument = (latest, time, extra = {}) => ({ name: PKG, 'dist-tags': { latest }, ...(time ? { time: { [latest]: time } } : {}), ...extra })
const respond = (url) => {
  const s = script[url]
  if (typeof s === 'function') return s()
  if (s === undefined) return { ok: false, status: 404, json: async () => ({}) }
  return { ok: true, status: 200, json: async () => s }
}
const fakeFetch = async (url, opts) => { calls.push({ url, opts }); return respond(url) }

let handler
const ctx = { webRuntime: { trustedHosts: [] }, webServer: { register: (r) => { handler = r.handler; return () => {} } }, effect: (fn) => fn(), __vdcFetch: fakeFetch }
apply(ctx)
const server = createServer((req, res) => handler(req, res))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`
const get = (path, headers) => fetch(base + path, { headers })

let n = 0
const t = async (name, fn) => { calls = []; script = {}; await fn(); n++; console.log('ok  ' + name) }
// every test starts from a clean cache: a fresh handler instance
const fresh = () => { apply(ctx) }

await t('NOTHING is fetched when the plugin loads, or by any other route', async () => {
  fresh()
  await get('/vdc/ping'); await get('/vdc/config')
  assert.equal(calls.length, 0)
})
await t('the page asking for /vdc/latest reads exactly the two fixed registries, nothing else', async () => {
  fresh(); script = { [NPMJS]: packument('0.1.3'), [MIRROR]: packument('0.1.3') }
  const j = await (await get('/vdc/latest')).json()
  assert.deepEqual(calls.map((c) => c.url).sort(), [MIRROR, NPMJS].sort())
  assert.equal(j.ok, true); assert.equal(j.latest, '0.1.3'); assert.equal(j.name, PKG)
})
await t('SAFETY: nothing in the request can change where it goes (query string, path suffix, headers)', async () => {
  fresh(); script = { [NPMJS]: packument('0.1.3'), [MIRROR]: packument('0.1.3') }
  await get('/vdc/latest?registry=http://evil.example/&name=left-pad&url=http://169.254.169.254/', { 'x-registry': 'http://evil.example/', referer: 'http://evil.example/' })
  assert.ok(calls.length === 2 && calls.every((c) => c.url === NPMJS || c.url === MIRROR), calls.map((c) => c.url).join(' '))
  assert.equal((await get('/vdc/latest/anything')).status, 404)
})
await t('PRIVACY: the outbound request is a bare GET: no cookies, no auth, no body, no identifying headers', async () => {
  fresh(); script = { [NPMJS]: packument('0.1.3'), [MIRROR]: packument('0.1.3') }
  await get('/vdc/latest', { cookie: 'session=secret', authorization: 'Bearer secret' })
  for (const c of calls) {
    assert.deepEqual(Object.keys(c.opts.headers), ['accept'], 'only an Accept header may be sent')
    assert.equal(c.opts.method, undefined); assert.equal(c.opts.body, undefined)
    assert.equal(c.opts.redirect, 'error', 'a redirect must be an error, not followed')
    assert.ok(c.opts.signal, 'every request needs a timeout')
  }
})
await t('the highest version wins when the mirror lags behind npm, with its publish time', async () => {
  fresh(); script = { [NPMJS]: packument('0.1.4', '2026-10-06T01:02:03.000Z'), [MIRROR]: packument('0.1.2', '2026-10-05T14:40:00.000Z') }
  const j = await (await get('/vdc/latest')).json()
  assert.equal(j.latest, '0.1.4'); assert.equal(j.publishedAt, '2026-10-06T01:02:03.000Z'); assert.equal(j.from, 'https://registry.npmjs.org/')
  assert.equal(j.sources.length, 2)
})
await t('one registry down, the other answers: still a good answer, and the failure is shown', async () => {
  fresh(); script = { [NPMJS]: () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }) }, [MIRROR]: packument('0.1.3') }
  const j = await (await get('/vdc/latest')).json()
  assert.equal(j.ok, true); assert.equal(j.latest, '0.1.3')
  assert.equal(j.sources.find((s) => s.registry.includes('npmjs')).error, 'timeout')
})
await t('both down: ok:false with each reason, an honest failure rather than "up to date"', async () => {
  fresh(); script = { [NPMJS]: () => ({ ok: false, status: 503, json: async () => ({}) }), [MIRROR]: () => { throw Object.assign(new Error('getaddrinfo'), { cause: { code: 'ENOTFOUND' } }) } }
  const j = await (await get('/vdc/latest')).json()
  assert.equal(j.ok, false); assert.equal(j.latest, undefined)
  assert.deepEqual(j.sources.map((s) => s.error).sort(), ['ENOTFOUND', 'HTTP 503'])
})
await t('SAFETY: a hostile or malformed answer is never accepted as a version', async () => {
  const bad = [
    packument('0.1.3; rm -rf /'), packument('javascript:alert(1)'), packument('<img src=x onerror=alert(1)>'), packument('latest'), packument('1.2'), packument(''),
    { name: 'some-other-package', 'dist-tags': { latest: '9.9.9' } }, // right shape, wrong package
    { name: PKG }, { name: PKG, 'dist-tags': {} }, { name: PKG, 'dist-tags': { latest: 5 } }, null,
  ]
  for (const b of bad) {
    fresh(); calls = []; script = { [NPMJS]: b, [MIRROR]: b }
    const j = await (await get('/vdc/latest')).json()
    assert.equal(j.ok, false, `accepted: ${JSON.stringify(b)}`)
    assert.equal(j.latest, undefined)
  }
})
await t('a non-JSON answer (an HTML error page) is a failure, not a crash', async () => {
  fresh(); script = { [NPMJS]: () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <') } }), [MIRROR]: () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <') } }) }
  const j = await (await get('/vdc/latest')).json()
  assert.equal(j.ok, false); assert.ok(j.sources.every((s) => s.error))
})
await t('publishedAt is normalised, and an invalid time is dropped rather than shown', async () => {
  fresh(); script = { [NPMJS]: packument('0.1.3', '2026-10-05T14:40:00+08:00'), [MIRROR]: packument('0.1.3', 'not a date') }
  const a = await readRegistry('https://registry.npmjs.org/', async () => ({ ok: true, json: async () => packument('0.1.3', '2026-10-05T14:40:00+08:00') }))
  assert.equal(a.publishedAt, '2026-10-05T06:40:00.000Z')
  const b = await readRegistry('https://registry.npmmirror.com/', async () => ({ ok: true, json: async () => packument('0.1.3', 'not a date') }))
  assert.equal(b.version, '0.1.3'); assert.equal(b.publishedAt, undefined)
})
await t('a success is cached for a minute (the button cannot hammer the registry); the answer says so', async () => {
  fresh(); script = { [NPMJS]: packument('0.1.3'), [MIRROR]: packument('0.1.3') }
  await get('/vdc/latest'); const before = calls.length
  const j = await (await get('/vdc/latest')).json()
  assert.equal(calls.length, before, 'second click must not fetch again'); assert.equal(j.cached, true); assert.equal(j.latest, '0.1.3')
})
await t('a FAILURE is never cached: the next click tries again', async () => {
  fresh(); script = {}
  const a = await (await get('/vdc/latest')).json(); assert.equal(a.ok, false); const first = calls.length
  script = { [NPMJS]: packument('0.1.3'), [MIRROR]: packument('0.1.3') }
  const b = await (await get('/vdc/latest')).json()
  assert.ok(calls.length > first, 'must fetch again after a failure'); assert.equal(b.ok, true)
})
await t('only GET is served', async () => {
  fresh(); script = { [NPMJS]: packument('0.1.3'), [MIRROR]: packument('0.1.3') }
  assert.equal((await fetch(base + '/vdc/latest', { method: 'POST' })).status, 404)
  assert.equal((await fetch(base + '/vdc/latest', { method: 'PUT' })).status, 404)
  assert.equal(calls.length, 0)
})
await t('SECURITY: the loopback fence applies, and a refused request fetches nothing', async () => {
  fresh(); script = { [NPMJS]: packument('0.1.3'), [MIRROR]: packument('0.1.3') }
  assert.equal((await get('/vdc/latest', { origin: 'http://evil.example' })).status, 403)
  assert.equal((await get('/vdc/latest', { 'sec-fetch-site': 'cross-site' })).status, 403)
  const code = await new Promise((resolve, reject) => { const u = new URL(base + '/vdc/latest'); const q = httpRequest({ host: '127.0.0.1', port: u.port, path: u.pathname, headers: { host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode) }); q.on('error', reject); q.end() })
  assert.equal(code, 403); assert.equal(calls.length, 0)
})
await t('compareVersions orders correctly', () => {
  assert.equal(compareVersions('0.1.2', '0.1.10'), -1); assert.equal(compareVersions('1.0.0', '0.9.9'), 1); assert.equal(compareVersions('0.1.3', '0.1.3'), 0)
})
await t('latestVersion on its own: the highest of the answering sources', async () => {
  script = { [NPMJS]: packument('0.2.0'), [MIRROR]: packument('0.1.9') }
  const j = await latestVersion(fakeFetch); assert.equal(j.latest, '0.2.0')
})

server.close()
console.log(`\n${n} latest-version tests passed`)
