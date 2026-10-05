import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as E from '../src/engine.js'
import { createFakePm } from './fake-pm.js'

const catalog = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'catalog', 'catalog.json'), 'utf8'))
const by = (id) => catalog.plugins.find((p) => p.id === id)
const MV = '@vibedev-si/dsh-media-viewer'
let n = 0
const t = async (name, fn) => { await fn(); n++; console.log('ok  ' + name) }

// ── plan ────────────────────────────────────────────────────────────────────
await t('plan: dependencies come first, no duplicates', () => {
  const plan = E.resolvePlan(catalog, [MV, 'dsh-media', MV])
  assert.deepEqual(plan.map((p) => p.id), ['dsh-better-sidebar', MV, 'dsh-media'])
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
  const r = await E.installOne(pm, by('dsh-media'), { installed: false })
  assert.equal(r.status, 'done')
  assert.deepEqual(pm.calls.map((c) => c[0]), ['inspect', 'installBundle', 'setBundleEnabled'])
  assert.equal(pm.calls[1][2].enabled, false, 'must install WITHOUT enabling')
  assert.equal(pm.calls[1][1], 'dsh-media@0.1.3')
  assert.equal(pm.bundles.get('dsh-media').enabled, true)
})
await t('install: already installed + enabled is skipped without any call to install', async () => {
  const pm = createFakePm([{ name: 'dsh-media', version: '0.1.3' }])
  const r = await E.installOne(pm, by('dsh-media'), { installed: true, enabled: true })
  assert.equal(r.status, 'skipped'); assert.equal(pm.calls.length, 0)
})
await t('install: installed but disabled is just enabled, not reinstalled', async () => {
  const pm = createFakePm([{ name: 'dsh-media', version: '0.1.3', enabled: false }])
  const r = await E.installOne(pm, by('dsh-media'), { installed: true, enabled: false })
  assert.equal(r.status, 'enabledOnly'); assert.deepEqual(pm.calls.map((c) => c[0]), ['setBundleEnabled'])
})
await t('install: host says already-installed -> skipped, not an error', async () => {
  const pm = createFakePm([{ name: 'dsh-media', version: '0.1.3' }])
  const r = await E.installOne(pm, by('dsh-media'), { installed: false })
  assert.equal(r.status, 'skipped')
})

// ── safety: the registry must answer with what the catalog promised ─────────
await t('SAFETY: registry returns a different package name -> nothing is installed', async () => {
  const pm = createFakePm([], { 'dsh-media': { nameOverride: 'evil-media' } })
  const r = await E.installOne(pm, by('dsh-media'), { installed: false })
  assert.equal(r.status, 'failed'); assert.equal(r.failure.kind, 'mismatch')
  assert.ok(!pm.calls.some((c) => c[0] === 'installBundle'), 'installBundle must not be called')
})
await t('SAFETY: registry returns a different version -> nothing is installed', async () => {
  const pm = createFakePm([], { 'dsh-media': { versionOverride: '9.9.9' } })
  const r = await E.installOne(pm, by('dsh-media'), { installed: false })
  assert.equal(r.failure.kind, 'mismatch'); assert.ok(!pm.calls.some((c) => c[0] === 'installBundle'))
})
await t('SAFETY: a package that is not a bundle is refused before install', async () => {
  const pm = createFakePm([], { 'dsh-media': { notBundle: true } })
  const r = await E.installOne(pm, by('dsh-media'), { installed: false })
  assert.equal(r.failure.kind, 'mismatch'); assert.ok(!pm.calls.some((c) => c[0] === 'installBundle'))
})

// ── failures ────────────────────────────────────────────────────────────────
await t('failure: network', async () => {
  const pm = createFakePm([], { 'dsh-media': { network: true } })
  const r = await E.installOne(pm, by('dsh-media'), { installed: false })
  assert.equal(r.status, 'failed'); assert.equal(r.failure.kind, 'network')
  assert.equal(pm.bundles.has('dsh-media'), false, 'nothing may be left behind')
})
await t('failure: inspect RPC dropped -> reported as network, nothing installed', async () => {
  const pm = createFakePm([], { 'dsh-media': { inspectThrows: true } })
  const r = await E.installOne(pm, by('dsh-media'), { installed: false })
  assert.equal(r.failure.kind, 'network'); assert.equal(pm.bundles.size, 0)
})
await t('failure: not found on registry', async () => {
  const r = await E.installOne(createFakePm([], { 'dsh-media': { notFound: true } }), by('dsh-media'), { installed: false })
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
  const r = await E.installOne(createFakePm([], { 'dsh-media': { cooldown: true } }), by('dsh-media'), { installed: false })
  assert.equal(r.failure.kind, 'exempt'); assert.equal(r.failure.culprit, 'dsh-film@0.3.0')
  assert.equal(E.cooldownEnds(r.failure.publishedAt).toISOString(), '2026-10-06T08:47:54.172Z')
})
await t('network failure keeps the registries the host actually tried (so the UI cannot overclaim)', async () => {
  const real = { status: 'refused', problem: 'network', reason: 'pnpm view timed out after 20000ms', registries: [null] }
  const r = await E.installOne(createFakePm([], { 'dsh-media': { inspect: real } }), by('dsh-media'), { installed: false })
  assert.equal(r.failure.kind, 'network'); assert.deepEqual(r.failure.registries, [null]); assert.match(r.failure.diagnostic, /timed out/)
})
await t('the chosen registry is asked first, and install then uses the registry that answered', async () => {
  const mirror = 'https://registry.npmmirror.com'
  const pm = createFakePm()
  await E.installOne(pm, by('dsh-media'), { installed: false }, { registry: mirror })
  const regs = pm.calls.filter((c) => c[0] === 'inspect' || c[0] === 'installBundle').map((c) => [c[0], c[2].registry])
  assert.deepEqual(regs, [['inspect', mirror], ['installBundle', mirror]])
})
await t('with no chosen registry, the host default (null) is used for inspect', async () => {
  const pm = createFakePm()
  await E.installOne(pm, by('dsh-media'), { installed: false })
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

await t('failure: enabling fails after a good install -> reported, and says it IS installed', async () => {
  const pm = createFakePm([], { 'dsh-media': { enableFails: true } })
  const r = await E.installOne(pm, by('dsh-media'), { installed: false })
  assert.equal(r.status, 'failed'); assert.equal(r.installedNotEnabled, true)
})
await t('restart-required is reported as its own outcome, never as plain success', async () => {
  const r = await E.installOne(createFakePm([], { 'dsh-media': { restartOnInstall: true } }), by('dsh-media'), { installed: false })
  assert.equal(r.status, 'restart')
})
await t('install RPC lost mid-way is flagged uncertain (so the UI can re-check instead of guessing)', async () => {
  const r = await E.installOne(createFakePm([], { 'dsh-media': { installRpcLost: true } }), by('dsh-media'), { installed: false })
  assert.equal(r.status, 'failed'); assert.equal(r.uncertain, true)
})

// ── plans ───────────────────────────────────────────────────────────────────
await t('plan run: stops at the first failure, keeps what is done, touches nothing after it', async () => {
  const pm = createFakePm([], { 'dsh-media': { network: true } })
  const rows = E.markInstalled(E.resolvePlan(catalog, ['dsh-media', 'dsh-film']), [])
  const { results, stoppedAt } = await E.installPlan(pm, rows)
  assert.equal(stoppedAt, 'dsh-media'); assert.equal(results.length, 1)
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
  const rows = E.markInstalled(E.resolvePlan(catalog, ['dsh-media', 'dsh-film']), [])
  const { results } = await E.installPlan(pm, rows, { signal: ac.signal, hooks: { onPluginEnd: () => ac.abort() } })
  assert.equal(results[0].status, 'done'); assert.equal(results[1].status, 'cancelled')
  assert.equal(pm.bundles.has('dsh-film'), false)
})
await t('hooks report every step in order', async () => {
  const steps = []
  await E.installOne(createFakePm(), by('dsh-media'), { installed: false }, { hooks: { onStep: (s) => steps.push(s) } })
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

// ── uninstall: the non-atomic case that really happened ─────────────────────
await t('uninstall: clean success', async () => {
  const pm = createFakePm([{ name: 'dsh-media', version: '0.1.3' }])
  assert.equal((await E.uninstall(pm, by('dsh-media'))).status, 'done')
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
    { name: 'dsh-media', version: '0.1.2', installed: true },
    { name: 'dshmarket', version: '1.0.0', installed: true }, // updates itself -> never offered
    { name: 'dsh-film', version: '0.3.0', installed: true }, // current
  ])
  assert.deepEqual(u.map((x) => [x.entry.id, x.from, x.to]), [['dsh-media', '0.1.2', '0.1.3']])
})
await t('semver compare', () => {
  assert.equal(E.compareSemver('0.1.2', '0.1.3'), -1); assert.equal(E.compareSemver('1.0.0', '0.9.9'), 1); assert.equal(E.compareSemver('0.3.0', '0.3.0'), 0)
})

// ── update mode: the host's inspect refuses by NAME, so "already-installed" must NOT skip an update ──
await t('UPDATE: inspect says already-installed, yet the update still installs the new exact version', async () => {
  const pm = createFakePm([{ name: 'dsh-media', version: '0.1.2' }])
  const r = await E.installOne(pm, by('dsh-media'), { installed: true, enabled: true }, { update: true })
  assert.notEqual(r.status, 'skipped', 'an update must never be silently skipped')
  const inst = pm.calls.filter((c) => c[0] === 'installBundle')
  assert.equal(inst.length, 1); assert.equal(inst[0][1], 'dsh-media@0.1.3')
  assert.equal(pm.bundles.get('dsh-media').version, '0.1.3')
})
await t('UPDATE: stays enabled if it was enabled, and is reported as needing a restart', async () => {
  const pm = createFakePm([{ name: 'dsh-media', version: '0.1.2' }])
  const r = await E.installOne(pm, by('dsh-media'), { installed: true, enabled: true }, { update: true })
  assert.equal(r.status, 'restart'); assert.equal(pm.bundles.get('dsh-media').enabled, true)
})
await t('UPDATE: a plugin the user had switched off stays off', async () => {
  const pm = createFakePm([{ name: 'dsh-media', version: '0.1.2', enabled: false }])
  await E.installOne(pm, by('dsh-media'), { installed: true, enabled: false }, { update: true })
  assert.equal(pm.bundles.get('dsh-media').version, '0.1.3'); assert.equal(pm.bundles.get('dsh-media').enabled, false)
  assert.ok(!pm.calls.some((c) => c[0] === 'setBundleEnabled' && c[2] === true), 'must not switch it back on')
})
await t('UPDATE: a real refusal (not-found) is still a failure, only already-installed is waved through', async () => {
  const pm = createFakePm([{ name: 'dsh-media', version: '0.1.2' }], { 'dsh-media': { inspect: { status: 'refused', problem: 'not-found', reason: 'nope' } } })
  const r = await E.installOne(pm, by('dsh-media'), { installed: true, enabled: true }, { update: true })
  assert.equal(r.status, 'failed'); assert.equal(r.failure.kind, 'notfound')
})
await t('UPDATE: pnpm cooldown on update is recognised too', async () => {
  const pm = createFakePm([{ name: 'dsh-media', version: '0.1.2' }], { 'dsh-media': { cooldown: true } })
  const r = await E.installOne(pm, by('dsh-media'), { installed: true, enabled: true }, { update: true })
  assert.equal(r.failure.kind, 'exempt')
})
await t('FRESH install is unchanged: already-installed is still skipped when not updating', async () => {
  const pm = createFakePm([{ name: 'dsh-media', version: '0.1.3' }])
  const r = await E.installOne(pm, by('dsh-media'), { installed: false })
  assert.equal(r.status, 'skipped')
})

console.log(`\n${n} engine tests passed`)
