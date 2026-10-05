// Real-HTTP test of the host half against a fake cordis ctx.
import assert from 'node:assert/strict'
import { createServer, request as httpRequest } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const profile = mkdtempSync(join(tmpdir(), 'vdc-profile-'))
process.env.DSH_PROFILE_DIR = profile
const { apply } = await import('../index.js')

let handler
apply({ webRuntime: { trustedHosts: [] }, webServer: { register: (r) => { handler = r.handler; return () => {} } }, effect: (fn) => fn() })
const server = createServer((req, res) => handler(req, res))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`
const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
let n = 0
const t = async (name, fn) => { await fn(); n++; console.log('ok  ' + name) }

await t('ping answers', async () => { const r = await fetch(base + '/vdc/ping'); assert.equal(r.status, 200); assert.equal((await r.json()).name, '@vibedev-si/dsh-ecosystem') })
await t('PRIVACY: self-check is OFF by default', async () => { const j = await (await fetch(base + '/vdc/config')).json(); assert.equal(j.selfcheck, false) })
await t('PRIVACY: a report is refused (403) and nothing is written while it is off', async () => {
  const r = await post('/vdc/selfcheck', { checks: {} })
  assert.equal(r.status, 403); assert.equal(existsSync(join(profile, '.vdc', 'selfcheck.json')), false)
})
mkdirSync(join(profile, '.vdc'), { recursive: true }); writeFileSync(join(profile, '.vdc', 'enable-selfcheck'), '')
await t('marker file turns it on', async () => { assert.equal((await (await fetch(base + '/vdc/config')).json()).selfcheck, true) })
await t('the VISIBLE part (switching panels) stays off even when the self-check is on', async () => {
  const j = await (await fetch(base + '/vdc/config')).json()
  assert.equal(j.selfcheck, true); assert.equal(j.mount, false)
})
await t('the visible part needs its own second marker', async () => {
  writeFileSync(join(profile, '.vdc', 'enable-selfcheck-mount'), '')
  assert.equal((await (await fetch(base + '/vdc/config')).json()).mount, true)
  rmSync(join(profile, '.vdc', 'enable-selfcheck-mount'))
  assert.equal((await (await fetch(base + '/vdc/config')).json()).mount, false)
})
await t('the second marker alone does nothing: no self-check, no mount', async () => {
  writeFileSync(join(profile, '.vdc', 'enable-selfcheck-mount'), '')
  rmSync(join(profile, '.vdc', 'enable-selfcheck'))
  const j = await (await fetch(base + '/vdc/config')).json()
  assert.equal(j.selfcheck, false); assert.equal(j.mount, false)
  writeFileSync(join(profile, '.vdc', 'enable-selfcheck'), ''); rmSync(join(profile, '.vdc', 'enable-selfcheck-mount'))
})
await t('a report is stored under the profile, with a timestamp', async () => {
  const r = await post('/vdc/selfcheck', { plugin: 'x', checks: { a: 1 } })
  assert.equal(r.status, 200)
  const saved = JSON.parse(readFileSync(join(profile, '.vdc', 'selfcheck.json'), 'utf8'))
  assert.equal(saved.checks.a, 1); assert.ok(saved.at)
})
await t('malformed JSON is a 400, not a crash', async () => { assert.equal((await post('/vdc/selfcheck', '{nope')).status, 400) })
await t('oversized body is refused (413)', async () => { assert.equal((await post('/vdc/selfcheck', JSON.stringify({ blob: 'x'.repeat(70 * 1024) }))).status, 413) })
await t('unknown path and wrong method are not served', async () => {
  assert.equal((await fetch(base + '/vdc/nope')).status, 404)
  assert.equal((await fetch(base + '/vdc/config', { method: 'POST' })).status, 404)
})
await t('SECURITY: a foreign Origin is refused', async () => { assert.equal((await fetch(base + '/vdc/config', { headers: { origin: 'http://evil.example' } })).status, 403) })
await t('SECURITY: cross-site browser requests are refused', async () => { assert.equal((await fetch(base + '/vdc/config', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403) })
await t('SECURITY: a forged Host header (DNS rebinding) is refused', async () => {
  const code = await new Promise((resolve, reject) => { const u = new URL(base + '/vdc/config'); const q = httpRequest({ host: '127.0.0.1', port: u.port, path: u.pathname, headers: { host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode) }); q.on('error', reject); q.end() })
  assert.equal(code, 403)
})
server.close()
console.log(`\n${n} host tests passed`)
