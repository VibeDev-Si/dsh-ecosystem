/**
 * Install engine: pure logic, no DOM, no React. It drives the host's `pluginManager`
 * through an injected `pm` object, so the same code runs against the real service and
 * against the fake one used in tests.
 *
 * Contract with the host (read from @deepseek-ai/dsh-plugin-manager's typert schema):
 *   pm.inspect(spec, {registry})            -> { ok, value | error }   value: {status:'accepted'|'refused', ...}
 *   pm.installBundle(spec, {enabled, requestId, registry, approvedBuilds}) -> { ok, value | error }
 *   pm.setBundleEnabled(name, enabled)      -> { ok, value | error }
 *   pm.removeBundle(name)                   -> { ok, value | error }
 *   pm.cancelInstall(requestId)             -> { ok, value: {status: 'cancelled'|'too-late'|...} }
 *   pm.listBundles()                        -> { ok, value: BundleInfo[] }
 * `value.application`: 'applied' | 'restart-required' | 'failed' | 'cancelled' | 'overridden'
 *
 * Safety rules enforced HERE (not in the UI, so a UI bug cannot bypass them):
 *   - only catalog entries can be installed, and only at the catalog's exact version;
 *   - the spec is always built as `name@exactVersion`, never taken from outside the catalog;
 *   - inspect() must answer with the same name and version we asked for.
 */

/** Plain, exact install spec for one catalog entry. */
export function specOf(entry) {
  return `${entry.npm}@${entry.version}`
}

/**
 * Expand the requested ids with their `requires`, dependencies first, without duplicates.
 * Unknown ids and cycles throw: the catalog validator already forbids them, this is the belt to its braces.
 */
export function resolvePlan(catalog, wantedIds) {
  const byId = new Map(catalog.plugins.map((p) => [p.id, p]))
  const out = []
  const done = new Set()
  const visiting = new Set()
  const visit = (id) => {
    const p = byId.get(id)
    if (!p) throw new Error(`not in catalog: ${id}`)
    if (done.has(id)) return
    if (visiting.has(id)) throw new Error(`dependency cycle at ${id}`)
    visiting.add(id)
    for (const d of p.requires ?? []) visit(d)
    visiting.delete(id)
    done.add(id)
    out.push(p)
  }
  for (const id of wantedIds) visit(id)
  return out
}

/** Which of the planned plugins are already installed, by npm name. */
export function markInstalled(plan, bundles) {
  const have = new Map((bundles ?? []).filter((b) => b.installed).map((b) => [b.name, b]))
  return plan.map((p) => {
    const b = have.get(p.npm)
    return { entry: p, installed: !!b, enabled: !!b?.enabled, installedVersion: b?.version }
  })
}

/**
 * Turn whatever the host returned into ONE shape the UI can render.
 * kinds: ok | restart | network | builds | incompat | notfound | exempt | halfRemoved | refused | failed
 */
export function classifyFailure(result) {
  const err = result?.error
  const log = `${result?.packageResult?.output ?? ''}\n${err?.diagnostic ?? ''}`
  const kind = result?.packageResult?.kind
  if (result?.pendingBuilds?.length || kind === 'build-blocked') return { kind: 'builds', pendingBuilds: result.pendingBuilds ?? [] }
  if (err?.code === 'incompatible-version') return { kind: 'incompat', incompatible: err.incompatible ?? result?.packageResult?.incompatible ?? [] }
  // The pnpm release-age cooldown: it blocks EVERY install/uninstall until the version is a day old.
  if (/ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION|minimumReleaseAge/.test(log)) {
    const m = /([@\w./-]+@[\w.-]+) was published at ([0-9T:.\-]+Z)/.exec(log)
    return { kind: 'exempt', culprit: m?.[1], publishedAt: m?.[2] }
  }
  if (kind === 'network' || kind === 'timeout') return { kind: 'network', registries: result?.registries, diagnostic: err?.diagnostic ?? '' }
  if (kind === 'not-found' || kind === 'no-matching-version') return { kind: 'notfound' }
  if (err?.code === 'stop-profile' || err?.code === 'bundle-in-use') return { kind: 'busy', code: err.code }
  return { kind: 'failed', code: err?.code, diagnostic: err?.diagnostic ?? result?.packageResult?.output ?? '' }
}

/** When the pnpm cooldown for a version ends: publishedAt + 24 h. */
export function cooldownEnds(publishedAtIso) {
  const t = Date.parse(publishedAtIso)
  return Number.isFinite(t) ? new Date(t + 24 * 3600 * 1000) : undefined
}

let seq = 0
const newRequestId = () => `eco-${Date.now().toString(36)}-${(seq++).toString(36)}`

/* ── registry choice: the same rule as the official Plugins page ─────────────────────────────
 * The host's registries() answers { registry, fallbackRegistries, resolved }. The page only considers the
 * China mirror when pnpm's own default resolves to the OFFICIAL npm registry (a user whose default is already
 * a mirror is left alone), and then only switches to it when the host's probe says the mirror is the fastest. */
const NPMJS = 'https://registry.npmjs.org/'
const NPMMIRROR = 'https://registry.npmmirror.com/'
const normReg = (u) => { try { const x = new URL(u); return `${x.protocol}//${x.host.toLowerCase()}${x.pathname.replace(/\/?$/, '/')}` } catch { return undefined } }

export function eligibleMirror(regs) {
  if (!regs || regs.registry !== null || regs.resolved == null) return undefined
  if (normReg(regs.resolved) !== NPMJS) return undefined
  return (regs.fallbackRegistries ?? []).find((r) => r === NPMMIRROR)
}

/** The registry to ask first, or null for "whatever pnpm is configured with". Never throws, never waits long. */
export async function chooseRegistry(pm, probe, opts = {}) {
  const ms = opts.timeoutMs ?? 8000
  const capped = (p) => { let t; return Promise.race([Promise.resolve(p), new Promise((r) => { t = setTimeout(() => r(undefined), ms) })]).finally(() => clearTimeout(t)) }
  try {
    const regs = await capped(pm?.registries?.())
    if (!regs?.ok) return null
    const mirror = eligibleMirror(regs.value)
    if (!mirror || typeof probe?.fastest !== 'function') return null
    const f = await capped(probe.fastest())
    return f?.ok && f.value === mirror ? mirror : null
  } catch { return null }
}

/* ── "is there a newer version of the center itself?" ─────────────────────────────────────────────────────────
 * The catalog is bundled in the package, so the center cannot learn about its own newer release from it. The host half
 * reads npm once, only when the user asks (index.js /vdc/latest); this turns that answer into what the screen says.
 * `answer` is the JSON of /vdc/latest, or undefined when the request itself failed.
 *   -> {kind:'newer'|'same'|'ahead'|'unavailable', latest?, publishedAt?, sources?}                                    */
export function judgeSelfUpdate(current, answer) {
  // The host half already vets the version; this second check keeps a malformed one from ever reaching a link or the screen.
  if (!answer || answer.ok !== true || typeof answer.latest !== 'string' || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(answer.latest)) return { kind: 'unavailable', sources: answer?.sources ?? [] }
  const c = compareSemver(current, answer.latest)
  return { kind: c < 0 ? 'newer' : c === 0 ? 'same' : 'ahead', latest: answer.latest, publishedAt: answer.publishedAt, from: answer.from, sources: answer.sources ?? [] }
}

/** pnpm holds back a version younger than 24 h. {active, endsAt} for an ISO publish time; never throws. */
export function cooldownState(publishedAtIso, now = Date.now()) {
  const endsAt = cooldownEnds(publishedAtIso)
  return endsAt === undefined ? { active: false, endsAt: undefined } : { active: now < endsAt.getTime(), endsAt }
}

/* ── let the host finish applying a change before the next one, and before telling the user it is done ──────────
 * Every enable makes the host rebuild its module graph and push it to the open page. A real user installed the whole
 * suite (four enables in about 25 s) and pressed our "reload" button seconds after the last one: the booting page then
 * failed to load one of the plugins and the desktop shell showed its crash dialog. The exact trigger is not proven, but
 * reloading in the middle of the host's own update is the one thing we did that the official Plugins page never does.
 * So: wait until no change event has arrived for `quietMs` (never longer than `maxMs`), and never reload for the user. */
export function waitQuiet(subscribe, opts = {}) {
  const quietMs = opts.quietMs ?? 2000
  const maxMs = opts.maxMs ?? 10000
  return new Promise((resolve) => {
    let quiet, cap, off
    const done = () => { clearTimeout(quiet); clearTimeout(cap); try { if (typeof off === 'function') off() } catch { /* ignore */ } resolve() }
    const arm = () => { clearTimeout(quiet); quiet = setTimeout(done, quietMs) }
    try { off = typeof subscribe === 'function' ? subscribe(arm) : undefined } catch { off = undefined }
    arm()
    cap = setTimeout(done, maxMs)
  })
}

/* ── readable text on the host's brand colour ─────────────────────────────────────────────────
 * The host's brand colour is near-black in the light theme and (very likely) light in the dark one, so a fixed
 * white label on primary buttons would vanish. Pick whichever of black/white has the higher WCAG contrast. */
export function readableTextOn(bg) {
  const m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(String(bg ?? ''))
  if (!m) return '#fff'
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => { const c = Number(v) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) })
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.05 ? '#fff' : '#000'
}
export function contrastRatio(fg, bg) {
  const lum = (s) => { const m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s); if (!m) return undefined; const [r, g, b] = [m[1], m[2], m[3]].map((v) => { const c = Number(v) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const a = lum(fg), b = lum(bg)
  if (a === undefined || b === undefined) return undefined
  const [hi, lo] = a >= b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Install one entry: inspect -> install (not enabled) -> enable.
 * Never throws; always resolves to {status, ...}. status:
 *   'done'      installed and enabled (applied)
 *   'restart'   installed, needs an app restart to take effect
 *   'skipped'   already installed (and enabled)
 *   'enabledOnly' was installed but disabled; we enabled it
 *   'failed'    with .failure = classifyFailure(...) or {kind:'refused'|'mismatch', ...}
 *   'cancelled'
 * `hooks.onStep(step)` is told 'inspect' | 'install' | 'enable' so the UI can show progress.
 */
export async function installOne(pm, entry, state, opts = {}) {
  const hooks = opts.hooks ?? {}
  const registry = opts.registry ?? null
  const approved = opts.approvedBuilds
  const update = opts.update === true
  const step = (s) => hooks.onStep?.(s, entry)
  const requestId = newRequestId()
  hooks.onRequest?.(requestId, entry)

  if (!update && state?.installed && state?.enabled) return { status: 'skipped' }
  if (!update && state?.installed && !state?.enabled) {
    step('enable')
    const r = await pm.setBundleEnabled(entry.npm, true)
    if (!r?.ok) return { status: 'failed', failure: { kind: 'failed', diagnostic: r?.error?.message ?? 'enable failed' } }
    if (r.value?.application === 'failed') return { status: 'failed', failure: classifyFailure(r.value) }
    return { status: r.value?.application === 'restart-required' ? 'restart' : 'enabledOnly' }
  }

  step('inspect')
  const ins = await pm.inspect(specOf(entry), { registry })
  if (!ins?.ok) return { status: 'failed', failure: { kind: 'network', diagnostic: ins?.error?.message ?? 'inspect failed' } }
  const v = ins.value
  // The host's inspect refuses by NAME when the package is installed, whatever the version.
  // For a fresh install that means "nothing to do"; for an UPDATE it is the expected answer and we go on.
  const installedAlready = v.status === 'refused' && v.problem === 'already-installed'
  if (v.status === 'refused' && !(update && installedAlready)) {
    if (installedAlready) return { status: 'skipped' }
    return { status: 'failed', failure: { kind: v.problem === 'network' ? 'network' : v.problem === 'not-found' ? 'notfound' : 'refused', problem: v.problem, diagnostic: v.reason, registries: v.registries } }
  }
  if (v.status === 'accepted' && (v.name !== entry.npm || (v.version && v.version !== entry.version) || v.bundle === false)) {
    // The registry answered with something other than what the catalog promised. Do not install it.
    return { status: 'failed', failure: { kind: 'mismatch', diagnostic: `expected ${specOf(entry)}, registry says ${v.name}@${v.version}${v.bundle === false ? ' (not a bundle)' : ''}` } }
  }

  step('install')
  const inst = await pm.installBundle(specOf(entry), {
    enabled: false,
    requestId,
    registry: (v.status === 'accepted' ? v.registry : null) ?? registry,
    ...(approved?.length ? { approvedBuilds: approved } : {}),
  })
  if (!inst?.ok) return { status: 'failed', failure: { kind: 'failed', diagnostic: inst?.error?.message ?? 'install call failed' }, requestId, uncertain: true }
  const iv = inst.value
  if (iv.application === 'cancelled') return { status: 'cancelled' }
  if (iv.application === 'failed') return { status: 'failed', failure: classifyFailure(iv), requestId }
  if (iv.application === 'overridden') return { status: 'failed', failure: { kind: 'failed', diagnostic: 'overridden by profile configuration' } }

  // An update of something the user had switched off must stay off.
  if (update && state?.enabled === false) return { status: iv.application === 'restart-required' ? 'restart' : 'done' }

  step('enable')
  const en = await pm.setBundleEnabled(entry.npm, true)
  if (!en?.ok) return { status: 'failed', failure: { kind: 'failed', diagnostic: en?.error?.message ?? 'enable failed' }, installedNotEnabled: true }
  if (en.value?.application === 'failed') return { status: 'failed', failure: classifyFailure(en.value), installedNotEnabled: true }
  // Replacing an already-installed package only loads the new code after a restart; say so even if the host stayed quiet.
  const restart = iv.application === 'restart-required' || en.value?.application === 'restart-required' || update
  return { status: restart ? 'restart' : 'done' }
}

/**
 * Run a whole plan, in order, one plugin at a time, and STOP at the first failure
 * (what is already installed stays; nothing after it is touched).
 * `rows` = markInstalled(...). Returns {results:[{id,status,...}], stoppedAt?}
 */
export async function installPlan(pm, rows, opts = {}) {
  const results = []
  let stoppedAt
  for (const row of rows) {
    if (opts.signal?.aborted) { stoppedAt = row.entry.id; results.push({ id: row.entry.id, status: 'cancelled' }); break }
    opts.hooks?.onPluginStart?.(row.entry)
    const r = await installOne(pm, row.entry, row, { ...opts, approvedBuilds: opts.approvedBuilds?.[row.entry.id] })
    results.push({ id: row.entry.id, ...r })
    opts.hooks?.onPluginEnd?.(row.entry, r)
    if (r.status === 'failed' || r.status === 'cancelled') { stoppedAt = row.entry.id; break }
  }
  return { results, stoppedAt }
}

/**
 * Migration from a legacy package name to the current one, in the only safe order:
 *   1. install the new package WITHOUT enabling it
 *   2. disable the old one (two packages registering the same routes/viewers crash the plugin tree)
 *   3. enable the new one
 *   4. only then remove the old one (and a failure here is reported, not hidden: the old one is already disabled)
 */
export async function migrate(pm, entry, legacyName, opts = {}) {
  const hooks = opts.hooks ?? {}
  const say = (s) => hooks.onStep?.(s, entry)
  say('inspect')
  const ins = await pm.inspect(specOf(entry), { registry: opts.registry ?? null })
  if (!ins?.ok || ins.value.status === 'refused' && ins.value.problem !== 'already-installed') {
    return { status: 'failed', phase: 'inspect', failure: { kind: 'network', diagnostic: ins?.error?.message ?? ins?.value?.reason } }
  }
  if (!(ins.value.status === 'refused' && ins.value.problem === 'already-installed')) {
    say('install')
    const inst = await pm.installBundle(specOf(entry), { enabled: false, requestId: newRequestId(), registry: ins.value.registry ?? null })
    if (!inst?.ok || inst.value.application === 'failed') return { status: 'failed', phase: 'install', failure: classifyFailure(inst?.value ?? {}) }
  }
  say('disable-old')
  const off = await pm.setBundleEnabled(legacyName, false)
  if (!off?.ok || off.value?.application === 'failed') return { status: 'failed', phase: 'disable-old', failure: { kind: 'failed', diagnostic: off?.error?.message ?? 'could not disable the old package' }, oldStillEnabled: true }
  say('enable')
  const on = await pm.setBundleEnabled(entry.npm, true)
  if (!on?.ok || on.value?.application === 'failed') {
    // Put the old one back so the user is not left with neither.
    await pm.setBundleEnabled(legacyName, true)
    return { status: 'failed', phase: 'enable-new', failure: classifyFailure(on?.value ?? {}), restoredOld: true }
  }
  say('remove-old')
  const rm = await pm.removeBundle(legacyName)
  if (!rm?.ok || rm.value?.application === 'failed') {
    return { status: 'halfRemoved', failure: classifyFailure(rm?.value ?? {}), note: 'old package is disabled but not removed' }
  }
  return { status: 'done' }
}

/**
 * Uninstall. The host's uninstall is NOT atomic: it disables first, then removes, and a failure in
 * the last step leaves the plugin disabled but still installed. We detect that and say so.
 */
export async function uninstall(pm, entry) {
  const r = await pm.removeBundle(entry.npm)
  if (!r?.ok) return { status: 'failed', failure: { kind: 'failed', diagnostic: r?.error?.message ?? 'remove failed' } }
  if (r.value?.application === 'failed') {
    const list = await pm.listBundles()
    const left = list?.ok ? list.value.find((b) => b.name === entry.npm) : undefined
    return { status: left && !left.enabled ? 'halfRemoved' : 'failed', failure: classifyFailure(r.value) }
  }
  return { status: r.value?.application === 'restart-required' ? 'restart' : 'done' }
}

/** Compare installed versions with the catalog. Only center-managed entries are offered for update. */
export function pendingUpdates(catalog, bundles) {
  const have = new Map((bundles ?? []).filter((b) => b.installed).map((b) => [b.name, b.version]))
  const out = []
  for (const p of catalog.plugins) {
    if (p.updates !== 'center') continue
    const v = have.get(p.npm)
    if (v && compareSemver(v, p.version) < 0) out.push({ entry: p, from: v, to: p.version })
  }
  return out
}

export function compareSemver(a, b) {
  const pa = a.split('-')[0].split('.').map(Number)
  const pb = b.split('-')[0].split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1
  return 0
}

/** Which legacy packages are installed (so the migration banner should show). */
export function legacyInstalled(catalog, bundles) {
  const have = new Set((bundles ?? []).filter((b) => b.installed).map((b) => b.name))
  const out = []
  for (const p of catalog.plugins) for (const l of p.legacyNames ?? []) if (have.has(l)) out.push({ entry: p, legacy: l, newInstalled: have.has(p.npm) })
  return out
}
