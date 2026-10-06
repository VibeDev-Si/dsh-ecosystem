import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as E from '../src/engine.js'
import { createFakePm } from './fake-pm.js'

const catalog = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'catalog', 'catalog.json'), 'utf8'))
const by = (id) => catalog.plugins.find((p) => p.id === id)
const MV = '@vibedev-si/dsh-media-viewer'
const VD = '@vibedev-si/dsh-vibedev'
let n = 0
const t = async (name, fn) => { await fn(); n++; console.log('ok  ' + name) }

// ── plan ────────────────────────────────────────────────────────────────────
await t('plan: dependencies come first, no duplicates', () => {
  const plan = E.resolvePlan(catalog, [MV, VD, MV])
  assert.deepEqual(plan.map((p) => p.id), ['dsh-better-sidebar', MV, VD])
})
await t('plan: the creator suite expands to all four in dependency order', () => {
  const s = catalog.suites[0]
  const ids = E.resolvePlan(catalog, s.items).map((p) => p.id)
  assert.equal(ids[0], 'dsh-better-sidebar'); assert.equal(new Set(ids).size, 4)
})
await t('plan: an id that is not in the catalog is refused', () => {
  assert.throws(() => E.resolvePlan(catalog, ['evil-package']), /not in catalog/)
})
await t('spec is always name@exactVersion from the catalog', () => {
  for (const p of catalog.plugins) assert.equal(E.specOf(p), `${p.npm}@${p.version}`)
})

// ── happy path & ordering ───────────────────────────────────────────────────
await t('install: inspect -> install(enabled:false) -> enable, in that order', async () => {
  const pm = createFakePm()
  const r = await E.installOne(pm, by(VD), { installed: false })
  assert.equal(r.status, 'done')
  assert.deepEqual(pm.calls.map((c) => c[0]), ['inspect', 'installBundle', 'setBundleEnabled'])
  assert.equal(pm.calls[1][2].enabled, false, 'must install WITHOUT enabling')
  assert.equal(pm.calls[1][1], E.specOf(by(VD)))
  assert.equal(pm.bundles.get(VD).enabled, true)
})
await t('install: already installed + enabled is skipped without any call to install', async () => {
  const pm = createFakePm([{ name: VD, version: '0.1.3' }])
  const r = await E.installOne(pm, by(VD), { installed: true, enabled: true })
  assert.equal(r.status, 'skipped'); assert.equal(pm.calls.length, 0)
})
await t('install: installed but disabled is just enabled, not reinstalled', async () => {
  const pm = createFakePm([{ name: VD, version: '0.1.3', enabled: false }])
  const r = await E.installOne(pm, by(VD), { installed: true, enabled: false })
  assert.equal(r.status, 'enabledOnly'); assert.deepEqual(pm.calls.map((c) => c[0]), ['setBundleEnabled'])
})
await t('install: host says already-installed -> skipped, not an error', async () => {
  const pm = createFakePm([{ name: VD, version: '0.1.3' }])
  const r = await E.installOne(pm, by(VD), { installed: false })
  assert.equal(r.status, 'skipped')
})

// ── safety: the registry must answer with what the catalog promised ─────────
await t('SAFETY: registry returns a different package name -> nothing is installed', async () => {
  const pm = createFakePm([], { [VD]: { nameOverride: 'evil-media' } })
  const r = await E.installOne(pm, by(VD), { installed: false })
  assert.equal(r.status, 'failed'); assert.equal(r.failure.kind, 'mismatch')
  assert.ok(!pm.calls.some((c) => c[0] === 'installBundle'), 'installBundle must not be called')
})
await t('SAFETY: registry returns a different version -> nothing is installed', async () => {
  const pm = createFakePm([], { [VD]: { versionOverride: '9.9.9' } })
  const r = await E.installOne(pm, by(VD), { installed: false })
  assert.equal(r.failure.kind, 'mismatch'); assert.ok(!pm.calls.some((c) => c[0] === 'installBundle'))
})
await t('SAFETY: a package that is not a bundle is refused before install', async () => {
  const pm = createFakePm([], { [VD]: { notBundle: true } })
  const r = await E.installOne(pm, by(VD), { installed: false })
  assert.equal(r.failure.kind, 'mismatch'); assert.ok(!pm.calls.some((c) => c[0] === 'installBundle'))
})

// ── failures ────────────────────────────────────────────────────────────────
await t('failure: network', async () => {
  const pm = createFakePm([], { [VD]: { network: true } })
  const r = await E.installOne(pm, by(VD), { installed: false })
  assert.equal(r.status, 'failed'); assert.equal(r.failure.kind, 'network')
  assert.equal(pm.bundles.has(VD), false, 'nothing may be left behind')
})
await t('failure: inspect RPC dropped -> reported as network, nothing installed', async () => {
  const pm = createFakePm([], { [VD]: { inspectThrows: true } })
  const r = await E.installOne(pm, by(VD), { installed: false })
  assert.equal(r.failure.kind, 'network'); assert.equal(pm.bundles.size, 0)
})
await t('failure: not found on registry', async () => {
  const r = await E.installOne(createFakePm([], { [VD]: { notFound: true } }), by(VD), { installed: false })
  assert.equal(r.failure.kind, 'notfound')
})
await t('failure: incompatible host version carries the details', async () => {
  const r = await E.installOne(createFakePm([], { 'dsh-film': { incompat: true } }), by('dsh-film'), { installed: false })
  assert.equal(r.failure.kind, 'incompat'); assert.equal(r.failure.incompatible[0].runtimeVersion, '0.1.7')
})
await t('failure: pending build scripts are surfaced, and approval is passed through on retry', async () => {
  const pm = createFakePm([], { 'dsh-film': { builds: true } })
  const first = await E.installOne(pm, by('dsh-film'), { installed: false })
  assert.equal(first.failure.kind, 'builds'); assert.deepEqual(first.failure.pendingBuilds, ['esbuild', 'protobufjs'])
  assert.equal(pm.bundles.has('dsh-film'), false)
  const second = await E.installOne(pm, by('dsh-film'), { installed: false }, { approvedBuilds: first.failure.pendingBuilds })
  assert.equal(second.status, 'done')
  const call = pm.calls.filter((c) => c[0] === 'installBundle').pop()
  assert.deepEqual(call[2].approvedBuilds, ['esbuild', 'protobufjs'])
})
await t('failure: pnpm release-age cooldown is recognised, with the culprit and the end time', async () => {
  const r = await E.installOne(createFakePm([], { [VD]: { cooldown: true } }), by(VD), { installed: false })
  assert.equal(r.failure.kind, 'exempt'); assert.equal(r.failure.culprit, 'dsh-film@0.3.0')
  assert.equal(E.cooldownEnds(r.failure.publishedAt).toISOString(), '2026-10-06T08:47:54.172Z')
})
await t('network failure keeps the registries the host actually tried (so the UI cannot overclaim)', async () => {
  const real = { status: 'refused', problem: 'network', reason: 'pnpm view timed out after 20000ms', registries: [null] }
  const r = await E.installOne(createFakePm([], { [VD]: { inspect: real } }), by(VD), { installed: false })
  assert.equal(r.failure.kind, 'network'); assert.deepEqual(r.failure.registries, [null]); assert.match(r.failure.diagnostic, /timed out/)
})
await t('the chosen registry is asked first, and install then uses the registry that answered', async () => {
  const mirror = 'https://registry.npmmirror.com'
  const pm = createFakePm()
  await E.installOne(pm, by(VD), { installed: false }, { registry: mirror })
  const regs = pm.calls.filter((c) => c[0] === 'inspect' || c[0] === 'installBundle').map((c) => [c[0], c[2].registry])
  assert.deepEqual(regs, [['inspect', mirror], ['installBundle', mirror]])
})
await t('with no chosen registry, the host default (null) is used for inspect', async () => {
  const pm = createFakePm()
  await E.installOne(pm, by(VD), { installed: false })
  assert.equal(pm.calls.find((c) => c[0] === 'inspect')[2].registry, null)
})
// ── registry choice: the official page's rule ───────────────────────────────────────────────────
const MIRROR = 'https://registry.npmmirror.com/'
const probeOf = (value, ok = true) => { const p = { calls: 0, async fastest() { p.calls++; return { ok, value } } }; return p }
await t('registry: default is the official registry and the mirror is fastest -> use the mirror', async () => {
  const probe = probeOf(MIRROR)
  assert.equal(await E.chooseRegistry(createFakePm(), probe), MIRROR); assert.equal(probe.calls, 1)
})
await t('registry: the official registry is fastest -> keep pnpm default (null)', async () => {
  assert.equal(await E.chooseRegistry(createFakePm(), probeOf('https://registry.npmjs.org/')), null)
})
await t('registry: REAL CASE on this machine - pnpm already defaults to the mirror -> leave it alone and do not even probe', async () => {
  const probe = probeOf(MIRROR)
  const pm = createFakePm([], {}, { resolved: 'https://registry.npmmirror.com' })
  assert.equal(await E.chooseRegistry(pm, probe), null); assert.equal(probe.calls, 0)
})
await t('registry: a probe that fails, throws or is absent never blocks and never breaks anything', async () => {
  assert.equal(await E.chooseRegistry(createFakePm(), probeOf(null, false)), null)
  assert.equal(await E.chooseRegistry(createFakePm(), { fastest: async () => { throw new Error('boom') } }), null)
  assert.equal(await E.chooseRegistry(createFakePm(), undefined), null)
  assert.equal(await E.chooseRegistry(undefined, probeOf(MIRROR)), null)
})
await t('registry: a probe that never answers is cut off (8 s in production, 50 ms here)', async () => {
  const t0 = Date.now()
  assert.equal(await E.chooseRegistry(createFakePm(), { fastest: () => new Promise(() => {}) }, { timeoutMs: 50 }), null)
  assert.ok(Date.now() - t0 < 1500)
})
await t('registry: a custom (non-null) configured registry is never overridden', async () => {
  const pm = createFakePm(); pm.registries = async () => ({ ok: true, value: { registry: 'https://corp.example/', fallbackRegistries: [MIRROR], resolved: 'https://corp.example/' } })
  assert.equal(await E.chooseRegistry(pm, probeOf(MIRROR)), null)
})

// ── readable text on the host brand colour ──────────────────────────────────────────────────────
await t('contrast: the real light-theme brand (#0f1115) gets white text', () => { assert.equal(E.readableTextOn('rgb(15, 17, 21)'), '#fff') })
await t('contrast: a light brand (what a dark theme most likely uses) gets dark text', () => { assert.equal(E.readableTextOn('rgb(232, 234, 240)'), '#000'); assert.equal(E.readableTextOn('rgb(255, 255, 255)'), '#000') })
await t('contrast: the choice always reaches WCAG AA (4.5:1) on black, white and mid colours alike', () => {
  for (const [r, g, b] of [[0, 0, 0], [255, 255, 255], [15, 17, 21], [232, 234, 240], [111, 135, 255], [77, 107, 254], [128, 128, 128], [200, 40, 40], [40, 200, 90]]) {
    const bg = `rgb(${r}, ${g}, ${b})`; const fg = E.readableTextOn(bg) === '#fff' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)'
    assert.ok(E.contrastRatio(fg, bg) >= 4.5, `${bg} with ${fg} = ${E.contrastRatio(fg, bg)}`)
  }
})
await t('contrast: an unparseable colour falls back to white instead of throwing', () => { assert.equal(E.readableTextOn('var(--x)'), '#fff'); assert.equal(E.readableTextOn(undefined), '#fff') })

// ── waitQuiet: let the host finish before the next change / before saying "done" ───────────────
await t('waitQuiet: with no events it resolves after quietMs', async () => {
  const t0 = Date.now(); await E.waitQuiet(() => () => {}, { quietMs: 60, maxMs: 1000 }); const d = Date.now() - t0
  assert.ok(d >= 55 && d < 400, `waited ${d} ms`)
})
await t('waitQuiet: every event restarts the quiet period', async () => {
  let fire; const t0 = Date.now()
  const p = E.waitQuiet((cb) => { fire = cb; return () => {} }, { quietMs: 80, maxMs: 2000 })
  for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 50)); fire() }
  await p; const d = Date.now() - t0
  assert.ok(d >= 200 + 75, `returned after only ${d} ms although events kept arriving`)
})
await t('waitQuiet: a constant stream of events is cut off by maxMs', async () => {
  let fire; const t0 = Date.now()
  const p = E.waitQuiet((cb) => { fire = cb; return () => {} }, { quietMs: 100, maxMs: 300 })
  const iv = setInterval(() => fire(), 20); await p; clearInterval(iv)
  const d = Date.now() - t0; assert.ok(d >= 290 && d < 700, `waited ${d} ms`)
})
await t('waitQuiet: the subscription is released afterwards', async () => {
  let released = 0; await E.waitQuiet(() => () => { released++ }, { quietMs: 20, maxMs: 200 }); assert.equal(released, 1)
})
await t('waitQuiet: a host without events, or one that throws on subscribe, never blocks beyond quietMs', async () => {
  const a = Date.now(); await E.waitQuiet(undefined, { quietMs: 30, maxMs: 500 }); assert.ok(Date.now() - a < 300)
  const b = Date.now(); await E.waitQuiet(() => { throw new Error('no events') }, { quietMs: 30, maxMs: 500 }); assert.ok(Date.now() - b < 300)
})

// ── self-update judgement and cooldown ──────────────────────────────────────────────────────────
await t('self update: a higher version on npm is "newer", with its publish time', () => {
  const j = E.judgeSelfUpdate('0.1.2', { ok: true, latest: '0.1.3', publishedAt: '2026-10-06T01:00:00.000Z', from: 'https://registry.npmjs.org/', sources: [] })
  assert.equal(j.kind, 'newer'); assert.equal(j.latest, '0.1.3'); assert.equal(j.publishedAt, '2026-10-06T01:00:00.000Z')
})
await t('self update: the same version is "same"; a LOWER one on npm (a dev build) is "ahead", never "newer"', () => {
  assert.equal(E.judgeSelfUpdate('0.1.3', { ok: true, latest: '0.1.3' }).kind, 'same')
  assert.equal(E.judgeSelfUpdate('0.2.0', { ok: true, latest: '0.1.9' }).kind, 'ahead')
  assert.equal(E.judgeSelfUpdate('0.1.10', { ok: true, latest: '0.1.9' }).kind, 'ahead', 'numeric, not string, comparison')
})
await t('self update: any failure is "unavailable", NEVER "same" (a failed check must not claim you are up to date)', () => {
  for (const a of [undefined, null, { ok: false, sources: [{ registry: 'x', error: 'timeout' }] }, { ok: true }, { ok: true, latest: 5 }]) assert.equal(E.judgeSelfUpdate('0.1.2', a).kind, 'unavailable')
  assert.deepEqual(E.judgeSelfUpdate('0.1.2', { ok: false, sources: [{ registry: 'x', error: 'timeout' }] }).sources, [{ registry: 'x', error: 'timeout' }])
})
await t('self update: a malformed or hostile version string is "unavailable", so it can never reach a link', () => {
  for (const v of ['0.1.3; rm -rf /', 'javascript:alert(1)', '<b>x</b>', '1.2', 'latest', '../../x']) assert.equal(E.judgeSelfUpdate('0.1.2', { ok: true, latest: v }).kind, 'unavailable', v)
})
await t('cooldown: 24 h from the publish time, inclusive of the exact end', () => {
  const pub = '2026-10-05T14:40:00.000Z'
  assert.equal(E.cooldownState(pub, Date.parse('2026-10-06T14:39:59.000Z')).active, true)
  assert.equal(E.cooldownState(pub, Date.parse('2026-10-06T14:40:00.000Z')).active, false)
  assert.equal(E.cooldownState(pub, Date.parse('2026-10-05T14:40:01.000Z')).endsAt.toISOString(), '2026-10-06T14:40:00.000Z')
})
await t('cooldown: a missing or garbage time means "no warning", never a crash', () => {
  for (const x of [undefined, null, '', 'soon']) assert.deepEqual(E.cooldownState(x), { active: false, endsAt: undefined })
})

// ── plugins replaced under a running page (the real boot crash; see engine.js trackLoadedChanges) ──
const B = (name, version, installed = true) => ({ name, version, installed })
const track = (...lists) => lists.reduce((s, l) => E.trackLoadedChanges(s, l), null)
await t('replaced-plugin tracker: the first look is only a baseline, never an alarm', () => {
  const s = track([B('dsh-media', '0.1.3'), B('dsh-film', '0.3.0')])
  assert.deepEqual(s.dirty, []); assert.deepEqual(s.prev, { 'dsh-media': '0.1.3', 'dsh-film': '0.3.0' })
})
await t('REAL crash 2: all four uninstalled, then installed again at the same versions -> all four flagged', () => {
  const four = [B('dsh-media', '0.1.3'), B('dsh-film', '0.3.0'), B('@vibedev-si/dsh-media-viewer', '0.1.0'), B('@vibedev-si/dsh-ecosystem', '0.1.1')]
  const s = track(four, [], four)
  assert.deepEqual(s.dirty.sort(), four.map((b) => b.name).sort())
})
await t('REAL crash 1: only the plugin that was loaded at start and then reinstalled is flagged; newly added ones are not', () => {
  const s = track([B('dsh-media', '0.1.3')], [], [B('dsh-media', '0.1.3')], [B('dsh-media', '0.1.3'), B('dsh-film', '0.3.0'), B('@vibedev-si/dsh-media-viewer', '0.1.0')])
  assert.deepEqual(s.dirty, ['dsh-media'])
})
await t('REAL 20:48 refresh that did NOT crash: a plugin that was removed (and stayed removed) and a brand-new one -> no alarm', () => {
  const s = track([B('dsh-media', '0.1.3')], [], [B('@vibedev-si/dsh-ecosystem', '0.1.0')])
  assert.deepEqual(s.dirty, [])
})
await t('an update in place (version changed) is flagged; so is a downgrade', () => {
  assert.deepEqual(track([B('dsh-media', '0.1.2')], [B('dsh-media', '0.1.3')]).dirty, ['dsh-media'])
  assert.deepEqual(track([B('dsh-media', '0.1.3')], [B('dsh-media', '0.1.2')]).dirty, ['dsh-media'])
})
await t('NO alarm for: a first install, a removal alone, disabling and enabling, or the same list seen again', () => {
  assert.deepEqual(track([], [B('dsh-media', '0.1.3')]).dirty, [])
  assert.deepEqual(track([B('dsh-media', '0.1.3')], []).dirty, [])
  const off = { ...B('dsh-media', '0.1.3'), enabled: false }, on = { ...B('dsh-media', '0.1.3'), enabled: true }
  assert.deepEqual(track([on], [off], [on]).dirty, [])
  assert.deepEqual(track([B('dsh-media', '0.1.3')], [B('dsh-media', '0.1.3')], [B('dsh-media', '0.1.3')]).dirty, [])
})
await t('entries that are not installed (listed but absent) are ignored', () => {
  assert.deepEqual(track([B('dsh-media', '0.1.3', false)], [B('dsh-media', '0.1.3')]).dirty, [])
})
await t('once flagged it stays flagged until the page is gone (a restart makes a new page), and flags accumulate', () => {
  const s = track([B('a', '1.0.0'), B('b', '1.0.0')], [B('a', '1.0.1'), B('b', '1.0.0')], [B('a', '1.0.1'), B('b', '1.0.0')], [B('a', '1.0.1')], [B('a', '1.0.1'), B('b', '1.0.0')])
  assert.deepEqual(s.dirty.sort(), ['a', 'b'])
})
await t('hostile or broken input never throws', () => {
  for (const bad of [undefined, null, [], [null], [{}], [{ installed: true }], [{ name: 5, installed: true }]]) assert.doesNotThrow(() => E.trackLoadedChanges(null, bad))
  assert.doesNotThrow(() => E.trackLoadedChanges({ prev: { a: '1' } }, undefined))
})

await t('failure: enabling fails after a good install -> reported, and says it IS installed', async () => {
  const pm = createFakePm([], { [VD]: { enableFails: true } })
  const r = await E.installOne(pm, by(VD), { installed: false })
  assert.equal(r.status, 'failed'); assert.equal(r.installedNotEnabled, true)
})
await t('restart-required is reported as its own outcome, never as plain success', async () => {
  const r = await E.installOne(createFakePm([], { [VD]: { restartOnInstall: true } }), by(VD), { installed: false })
  assert.equal(r.status, 'restart')
})
await t('install RPC lost mid-way is flagged uncertain (so the UI can re-check instead of guessing)', async () => {
  const r = await E.installOne(createFakePm([], { [VD]: { installRpcLost: true } }), by(VD), { installed: false })
  assert.equal(r.status, 'failed'); assert.equal(r.uncertain, true)
})

// ── plans ───────────────────────────────────────────────────────────────────
await t('plan run: stops at the first failure, keeps what is done, touches nothing after it', async () => {
  const pm = createFakePm([], { [VD]: { network: true } })
  const rows = E.markInstalled(E.resolvePlan(catalog, [VD, 'dsh-film']), [])
  const { results, stoppedAt } = await E.installPlan(pm, rows)
  assert.equal(stoppedAt, VD); assert.equal(results.length, 1)
  assert.ok(!pm.calls.some((c) => String(c[1]).startsWith('dsh-film')), 'dsh-film must not be touched')
})
await t('plan run: creator suite with the sidebar already installed installs the other three', async () => {
  const pm = createFakePm([{ name: 'dsh-better-sidebar', version: '0.24.1' }])
  const bundles = (await pm.listBundles()).value
  const rows = E.markInstalled(E.resolvePlan(catalog, catalog.suites[0].items), bundles)
  const { results } = await E.installPlan(pm, rows)
  assert.deepEqual(results.map((r) => r.status), ['skipped', 'done', 'done', 'done'])
  assert.equal(pm.calls.filter((c) => c[0] === 'installBundle').length, 3)
})
await t('plan run: cancel via AbortSignal stops before the next plugin', async () => {
  const pm = createFakePm(); const ac = new AbortController()
  const rows = E.markInstalled(E.resolvePlan(catalog, [VD, 'dsh-film']), [])
  const { results } = await E.installPlan(pm, rows, { signal: ac.signal, hooks: { onPluginEnd: () => ac.abort() } })
  assert.equal(results[0].status, 'done'); assert.equal(results[1].status, 'cancelled')
  assert.equal(pm.bundles.has('dsh-film'), false)
})
await t('hooks report every step in order', async () => {
  const steps = []
  await E.installOne(createFakePm(), by(VD), { installed: false }, { hooks: { onStep: (s) => steps.push(s) } })
  assert.deepEqual(steps, ['inspect', 'install', 'enable'])
})

// ── migration ───────────────────────────────────────────────────────────────
await t('migrate: new installed disabled, old disabled, new enabled, THEN old removed; never both enabled', async () => {
  const pm = createFakePm([{ name: 'dsh-media-viewer', version: '0.1.0' }])
  const r = await E.migrate(pm, by(MV), 'dsh-media-viewer')
  assert.equal(r.status, 'done')
  const seq = pm.calls.map((c) => [c[0], c[1]].join(':'))
  const iNew = seq.findIndex((s) => s.startsWith('installBundle:@vibedev-si'))
  const iOff = seq.indexOf('setBundleEnabled:dsh-media-viewer')
  const iOn = seq.indexOf('setBundleEnabled:@vibedev-si/dsh-media-viewer')
  const iRm = seq.indexOf('removeBundle:dsh-media-viewer')
  assert.ok(iNew < iOff && iOff < iOn && iOn < iRm, `bad order: ${seq.join(' | ')}`)
  assert.equal(pm.calls[iNew][2].enabled, false)
  assert.equal(pm.bundles.has('dsh-media-viewer'), false); assert.equal(pm.bundles.get(MV).enabled, true)
})
await t('migrate: if enabling the new one fails, the old one is switched back on', async () => {
  const pm = createFakePm([{ name: 'dsh-media-viewer', version: '0.1.0' }], { [MV]: { enableFails: true } })
  const r = await E.migrate(pm, by(MV), 'dsh-media-viewer')
  assert.equal(r.status, 'failed'); assert.equal(r.restoredOld, true)
  assert.equal(pm.bundles.get('dsh-media-viewer').enabled, true, 'user must not be left with neither')
})
await t('migrate: if removing the old one fails, the new one stays live and it is reported as half-removed', async () => {
  const pm = createFakePm([{ name: 'dsh-media-viewer', version: '0.1.0' }], { 'dsh-media-viewer': { removeFailsLast: true } })
  const r = await E.migrate(pm, by(MV), 'dsh-media-viewer')
  assert.equal(r.status, 'halfRemoved'); assert.equal(pm.bundles.get(MV).enabled, true)
  assert.equal(pm.bundles.get('dsh-media-viewer').enabled, false)
})
await t('migrate: install failure leaves the old package untouched', async () => {
  const pm = createFakePm([{ name: 'dsh-media-viewer', version: '0.1.0' }], { [MV]: { network: true } })
  const r = await E.migrate(pm, by(MV), 'dsh-media-viewer')
  assert.equal(r.status, 'failed'); assert.equal(pm.bundles.get('dsh-media-viewer').enabled, true)
  assert.ok(!pm.calls.some((c) => c[0] === 'setBundleEnabled'))
})
await t('legacy detection: only offered when the old name is actually installed', () => {
  assert.equal(E.legacyInstalled(catalog, [{ name: 'dsh-media-viewer', installed: true }]).length, 1)
  assert.equal(E.legacyInstalled(catalog, [{ name: MV, installed: true }]).length, 0)
})

// ── a plain install while the old name is installed switches over (card, suite or prerequisite) ─────
const oldMV = (enabled = true) => [{ name: 'dsh-media-viewer', version: '0.1.0', enabled }, { name: 'dsh-better-sidebar', version: '0.24.1' }]
const rowOf = (pm, id) => E.markInstalled(E.resolvePlan(catalog, [id]), [...pm.bundles.values()]).find((r) => r.entry.id === id)
await t('switch: the plan row names the installed old package and whether it is on', () => {
  const pm = createFakePm(oldMV(false))
  const row = rowOf(pm, MV)
  assert.equal(row.legacy, 'dsh-media-viewer'); assert.equal(row.legacyEnabled, false); assert.equal(row.installed, false)
  assert.equal(rowOf(createFakePm([]), MV).legacy, undefined)
})
await t('switch: install never runs both — new installed off, old off, new on, THEN old removed', async () => {
  const pm = createFakePm(oldMV())
  const steps = []
  const r = await E.installOne(pm, by(MV), rowOf(pm, MV), { hooks: { onStep: (s) => steps.push(s) } })
  assert.equal(r.status, 'done'); assert.equal(r.legacyLeft, undefined)
  const seq = pm.calls.map((c) => c[0] === 'installBundle' ? `${c[0]}:${c[1]}:${c[2].enabled}` : c[0] === 'setBundleEnabled' ? `${c[0]}:${c[1]}:${c[2]}` : `${c[0]}:${c[1]}`)
  assert.deepEqual(seq, [`inspect:${E.specOf(by(MV))}`, `installBundle:${E.specOf(by(MV))}:false`, 'setBundleEnabled:dsh-media-viewer:false', `setBundleEnabled:${MV}:true`, 'removeBundle:dsh-media-viewer'])
  assert.deepEqual(steps, ['inspect', 'install', 'disable-old', 'enable', 'remove-old'])
  assert.equal(pm.bundles.has('dsh-media-viewer'), false); assert.equal(pm.bundles.get(MV).enabled, true)
})
await t('switch: if the new one cannot be enabled, the old one is turned back on', async () => {
  const pm = createFakePm(oldMV(), { [MV]: { enableFails: true } })
  const r = await E.installOne(pm, by(MV), rowOf(pm, MV))
  assert.equal(r.status, 'failed'); assert.equal(r.restoredOld, true); assert.equal(r.installedNotEnabled, true)
  assert.equal(pm.bundles.get('dsh-media-viewer').enabled, true, 'user must not be left with neither')
  assert.ok(!pm.calls.some((c) => c[0] === 'removeBundle'))
})
await t('switch: an old package that was already off stays off when the new one fails', async () => {
  const pm = createFakePm(oldMV(false), { [MV]: { enableFails: true } })
  const r = await E.installOne(pm, by(MV), rowOf(pm, MV))
  assert.equal(r.status, 'failed'); assert.equal(r.restoredOld, undefined)
  assert.equal(pm.bundles.get('dsh-media-viewer').enabled, false)
})
await t('switch: if the old one cannot be disabled, the new one is left installed but OFF', async () => {
  const pm = createFakePm(oldMV(), { 'dsh-media-viewer': { disableFails: true } })
  const r = await E.installOne(pm, by(MV), rowOf(pm, MV))
  assert.equal(r.status, 'failed'); assert.equal(r.oldStillEnabled, true)
  assert.equal(pm.bundles.get(MV).enabled, false); assert.equal(pm.bundles.get('dsh-media-viewer').enabled, true)
  assert.ok(!pm.calls.some((c) => c[0] === 'setBundleEnabled' && c[1] === MV))
})
await t('switch: an old package that could not be removed is reported, the new one stays live', async () => {
  const pm = createFakePm(oldMV(), { 'dsh-media-viewer': { removeFailsLast: true } })
  const r = await E.installOne(pm, by(MV), rowOf(pm, MV))
  assert.equal(r.status, 'done'); assert.equal(r.legacyLeft, 'dsh-media-viewer')
  assert.equal(pm.bundles.get(MV).enabled, true); assert.equal(pm.bundles.get('dsh-media-viewer').enabled, false)
})
await t('switch: new one installed but off, old one on -> the old one goes off before the new one comes on', async () => {
  const pm = createFakePm([...oldMV(), { name: MV, version: by(MV).version, enabled: false }])
  const r = await E.installOne(pm, by(MV), rowOf(pm, MV))
  assert.equal(r.status, 'enabledOnly')
  assert.deepEqual(pm.calls.map((c) => [c[0], c[1], c[2]].join(':')), ['setBundleEnabled:dsh-media-viewer:false', `setBundleEnabled:${MV}:true`, 'removeBundle:dsh-media-viewer:'])
})
await t('switch: the creator suite over an installed dsh-media replaces it (dsh-vibedev was dsh-media), never both on', async () => {
  const pm = createFakePm([{ name: 'dsh-better-sidebar', version: '0.24.1' }, { name: 'dsh-media', version: '0.1.3' }])
  const rows = E.markInstalled(E.resolvePlan(catalog, catalog.suites[0].items), (await pm.listBundles()).value)
  assert.equal(rows.find((r) => r.entry.id === VD).legacy, 'dsh-media')
  const { results } = await E.installPlan(pm, rows)
  assert.deepEqual(results.map((r) => r.status), ['skipped', 'done', 'done', 'done'])
  const seq = pm.calls.map((c) => `${c[0]}:${c[1]}${c[0] === 'setBundleEnabled' ? ':' + c[2] : ''}`)
  assert.ok(seq.indexOf('setBundleEnabled:dsh-media:false') < seq.indexOf(`setBundleEnabled:${VD}:true`), seq.join(' | '))
  assert.equal(pm.bundles.has('dsh-media'), false); assert.equal(pm.bundles.get(VD).enabled, true)
})
await t('switch: installing dsh-film alone brings its prerequisite, which replaces dsh-media', async () => {
  const pm = createFakePm([{ name: 'dsh-media', version: '0.1.3' }])
  const rows = E.markInstalled(E.resolvePlan(catalog, ['dsh-film']), (await pm.listBundles()).value)
  assert.deepEqual(rows.map((r) => [r.entry.id, r.legacy]), [[VD, 'dsh-media'], ['dsh-film', undefined]])
  const { results } = await E.installPlan(pm, rows)
  assert.deepEqual(results.map((r) => r.status), ['done', 'done'])
  assert.equal(pm.bundles.has('dsh-media'), false)
})
await t('switch: an update never touches an old name (update rows do not carry one)', async () => {
  const pm = createFakePm([...oldMV(), { name: MV, version: '0.1.0' }])
  const r = await E.installOne(pm, by(MV), { installed: true, enabled: true, legacy: 'dsh-media-viewer', legacyEnabled: true }, { update: true })
  assert.equal(r.status, 'restart')
  assert.ok(!pm.calls.some((c) => c[1] === 'dsh-media-viewer'))
})

// ── uninstall: the non-atomic case that really happened ─────────────────────
await t('uninstall: clean success', async () => {
  const pm = createFakePm([{ name: VD, version: '0.1.3' }])
  assert.equal((await E.uninstall(pm, by(VD))).status, 'done')
})
await t('uninstall: pnpm blocks the last step -> reported as HALF-removed (disabled but still installed), with the cooldown cause', async () => {
  const pm = createFakePm([{ name: 'dsh-film', version: '0.3.0' }], { 'dsh-film': { removeFailsLast: true } })
  const r = await E.uninstall(pm, by('dsh-film'))
  assert.equal(r.status, 'halfRemoved'); assert.equal(r.failure.kind, 'exempt')
  assert.equal(pm.bundles.get('dsh-film').enabled, false); assert.equal(pm.bundles.get('dsh-film').installed, true)
})

// ── updates ─────────────────────────────────────────────────────────────────
await t('updates: only center-managed plugins whose installed version is older', () => {
  const u = E.pendingUpdates(catalog, [
    { name: VD, version: '0.1.0', installed: true },
    { name: 'dshmarket', version: '1.0.0', installed: true }, // updates itself -> never offered
    { name: 'dsh-film', version: by('dsh-film').version, installed: true }, // current
  ])
  assert.deepEqual(u.map((x) => [x.entry.id, x.from, x.to]), [[VD, '0.1.0', by(VD).version]])
})
await t('semver compare', () => {
  assert.equal(E.compareSemver('0.1.2', '0.1.3'), -1); assert.equal(E.compareSemver('1.0.0', '0.9.9'), 1); assert.equal(E.compareSemver('0.3.0', '0.3.0'), 0)
})

// ── update mode: the host's inspect refuses by NAME, so "already-installed" must NOT skip an update ──
await t('UPDATE: inspect says already-installed, yet the update still installs the new exact version', async () => {
  const pm = createFakePm([{ name: VD, version: '0.1.0' }])
  const r = await E.installOne(pm, by(VD), { installed: true, enabled: true }, { update: true })
  assert.notEqual(r.status, 'skipped', 'an update must never be silently skipped')
  const inst = pm.calls.filter((c) => c[0] === 'installBundle')
  assert.equal(inst.length, 1); assert.equal(inst[0][1], E.specOf(by(VD)))
  assert.equal(pm.bundles.get(VD).version, by(VD).version)
})
await t('UPDATE: stays enabled if it was enabled, and is reported as needing a restart', async () => {
  const pm = createFakePm([{ name: VD, version: '0.1.0' }])
  const r = await E.installOne(pm, by(VD), { installed: true, enabled: true }, { update: true })
  assert.equal(r.status, 'restart'); assert.equal(pm.bundles.get(VD).enabled, true)
})
await t('UPDATE: a plugin the user had switched off stays off', async () => {
  const pm = createFakePm([{ name: VD, version: '0.1.0', enabled: false }])
  await E.installOne(pm, by(VD), { installed: true, enabled: false }, { update: true })
  assert.equal(pm.bundles.get(VD).version, by(VD).version); assert.equal(pm.bundles.get(VD).enabled, false)
  assert.ok(!pm.calls.some((c) => c[0] === 'setBundleEnabled' && c[2] === true), 'must not switch it back on')
})
await t('UPDATE: a real refusal (not-found) is still a failure, only already-installed is waved through', async () => {
  const pm = createFakePm([{ name: VD, version: '0.1.0' }], { [VD]: { inspect: { status: 'refused', problem: 'not-found', reason: 'nope' } } })
  const r = await E.installOne(pm, by(VD), { installed: true, enabled: true }, { update: true })
  assert.equal(r.status, 'failed'); assert.equal(r.failure.kind, 'notfound')
})
await t('UPDATE: pnpm cooldown on update is recognised too', async () => {
  const pm = createFakePm([{ name: VD, version: '0.1.0' }], { [VD]: { cooldown: true } })
  const r = await E.installOne(pm, by(VD), { installed: true, enabled: true }, { update: true })
  assert.equal(r.failure.kind, 'exempt')
})
await t('FRESH install is unchanged: already-installed is still skipped when not updating', async () => {
  const pm = createFakePm([{ name: VD, version: by(VD).version }])
  const r = await E.installOne(pm, by(VD), { installed: false })
  assert.equal(r.status, 'skipped')
})


// Installation-provided bundles have installed:false; defaults can still run their rows.
const suppliedAccount = (extra = {}) => ({ name: VD, version: by(VD).version, installed: false, enabled: false,
  liveEnabled: true, removable: false, optional: false,
  rows: [{ rowId: 'dsh-vibedev', moduleName: VD, entryId: 'include:dsh-vibedev' }], ...extra })
const inventoryOf = async (pm) => (await E.readBundleInventory(pm)).value
await t('provided: defaults can enable a built-in package without a profile dependency or bundle selection', async () => {
  const pm = createFakePm([suppliedAccount()])
  const rows = E.markInstalled(E.resolvePlan(catalog, [VD]), await inventoryOf(pm))
  assert.equal(rows[0].installed, true); assert.equal(rows[0].enabled, true); assert.equal(rows[0].provided, true)
  pm.calls.length = 0
  assert.equal((await E.installOne(pm, by(VD), rows[0])).status, 'skipped')
  assert.equal(pm.calls.length, 0, 'must not install or select a second copy')
})
await t('provided: the suite reuses the built-in account and installs only film and viewer', async () => {
  const pm = createFakePm([{ name: 'dsh-better-sidebar', version: '0.24.1' }, suppliedAccount()])
  const rows = E.markInstalled(E.resolvePlan(catalog, catalog.suites[0].items), await inventoryOf(pm))
  const r = await E.installPlan(pm, rows)
  assert.deepEqual(r.results.map((x) => x.status), ['skipped', 'skipped', 'done', 'done'])
  assert.deepEqual(pm.calls.filter((x) => x[0] === 'installBundle').map((x) => x[1]), [E.specOf(by('dsh-film')), E.specOf(by(MV))])
  assert.ok(!pm.calls.some((x) => x[0] === 'setBundleEnabled' && x[1] === VD))
})
await t('provided: disabled built-ins block their dependants without reinstalling or selecting them', async () => {
  const pm = createFakePm([suppliedAccount({ liveEnabled: false })])
  const rows = E.markInstalled(E.resolvePlan(catalog, ['dsh-film']), await inventoryOf(pm))
  pm.calls.length = 0
  const r = await E.installPlan(pm, rows)
  assert.equal(r.stoppedAt, VD); assert.equal(r.results[0].failure.kind, 'provided'); assert.equal(pm.calls.length, 0)
})
await t('provided: a failed plugin-inventory read never creates a fallback installation', async () => {
  const pm = createFakePm([suppliedAccount()]); pm.listPlugins = async () => { throw new Error('offline') }
  const rows = E.markInstalled(E.resolvePlan(catalog, [VD]), await inventoryOf(pm))
  assert.equal(rows[0].provided, true); assert.equal(rows[0].installed, true)
  assert.equal((await E.installOne(pm, by(VD), rows[0])).failure.kind, 'provided')
  assert.ok(!pm.calls.some((x) => x[0] === 'installBundle' || x[0] === 'setBundleEnabled'))
})
await t('provided: a row id now occupied by another package does not prove the built-in package is enabled', async () => {
  const pm = createFakePm([suppliedAccount()]); pm.listPlugins = async () => ({ ok: true, value: [{ entryId: 'include:dsh-vibedev', moduleName: 'other-package', enabled: true }] })
  const b = (await inventoryOf(pm))[0]
  assert.equal(b.enabled, false); assert.equal(E.bundlePresent(b), true)
})
await t('provided: the loaded installation wins over a redundant profile dependency, including updates', async () => {
  const pm = createFakePm([suppliedAccount({ installed: true, version: '0.2.0' })])
  const bundles = await inventoryOf(pm)
  assert.deepEqual(E.pendingUpdates(catalog, bundles), [])
  const row = E.markInstalled([by(VD)], bundles)[0]
  assert.equal((await E.installOne(pm, by(VD), row, { update: true })).failure.kind, 'provided')
  assert.ok(!pm.calls.some((x) => x[0] === 'installBundle'))
})
await t('provided: an owned but protected package is not misclassified; a missing selection is not present', () => {
  assert.equal(E.providedByApp({ installed: true, removable: false, source: VD + '@0.2.1' }), false)
  assert.equal(E.bundlePresent({ installed: false, enabled: true, removable: true }), false)
})
await t('provided: uninstall checks live ownership and never calls removeBundle for a built-in package', async () => {
  const pm = createFakePm([suppliedAccount()])
  const r = await E.uninstall(pm, by(VD))
  assert.equal(r.failure.kind, 'provided'); assert.equal(pm.bundles.has(VD), true)
  assert.ok(!pm.calls.some((x) => x[0] === 'removeBundle'))
})
await t('provided: migration reuses the enabled built-in and only disables/removes the old external package', async () => {
  const pm = createFakePm([suppliedAccount(), { name: 'dsh-media', version: '0.1.3' }])
  const bundles = await inventoryOf(pm)
  assert.equal(E.legacyInstalled(catalog, bundles)[0].provided, true)
  const r = await E.migrate(pm, by(VD), 'dsh-media')
  assert.equal(r.status, 'done'); assert.equal(pm.bundles.has(VD), true); assert.equal(pm.bundles.has('dsh-media'), false)
  assert.deepEqual(pm.calls.filter((x) => !['listBundles', 'listPlugins'].includes(x[0])).map((x) => [x[0], x[1]]), [['setBundleEnabled', 'dsh-media'], ['removeBundle', 'dsh-media']])
})
await t('provided: inline suite migration cannot skip the old external copy or reinstall the new one', async () => {
  const pm = createFakePm([{ name: 'dsh-better-sidebar', version: '0.24.1' }, suppliedAccount(), { name: 'dsh-media', version: '0.1.3' }])
  const rows = E.markInstalled(E.resolvePlan(catalog, catalog.suites[0].items), await inventoryOf(pm))
  assert.equal(E.needsInstall(rows.find((r) => r.entry.id === VD)), true)
  await E.installPlan(pm, rows)
  assert.equal(pm.bundles.has('dsh-media'), false)
  assert.ok(!pm.calls.some((x) => x[0] === 'installBundle' && x[1] === E.specOf(by(VD))))
})
await t('provided: an unavailable built-in never disables the old package during migration', async () => {
  const pm = createFakePm([suppliedAccount({ liveEnabled: false }), { name: 'dsh-media', version: '0.1.3' }])
  assert.equal((await E.migrate(pm, by(VD), 'dsh-media')).failure.kind, 'provided')
  assert.equal(pm.bundles.get('dsh-media').enabled, true)
  assert.ok(!pm.calls.some((x) => x[0] === 'setBundleEnabled' || x[0] === 'installBundle' || x[0] === 'removeBundle'))
})
await t('provided: failed old-package removal leaves the built-in package alone and reports the remainder', async () => {
  const pm = createFakePm([suppliedAccount(), { name: 'dsh-media', version: '0.1.3' }], { 'dsh-media': { removeFailsLast: true } })
  const r = await E.migrate(pm, by(VD), 'dsh-media')
  assert.equal(r.status, 'halfRemoved'); assert.equal(pm.bundles.get('dsh-media').enabled, false)
  assert.equal(pm.bundles.get(VD).installed, false); assert.equal(pm.bundles.get(VD).liveEnabled, true)
})

console.log(`\n${n} engine tests passed`)
