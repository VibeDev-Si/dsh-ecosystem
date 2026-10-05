/**
 * Opt-in self-check. OFF unless the host says so: the host only answers {selfcheck:true} when the file
 * <profile>/.vdc/enable-selfcheck exists, which only a developer creates by hand.
 *
 * It makes READ-ONLY calls (listBundles, inspect) and never installs, enables, disables or removes anything.
 * It briefly opens the center's panel to prove it mounts inside the real shell, then puts the previous panel back.
 * Its report is POSTed to this machine's own /vdc/selfcheck route and written under the profile. Nothing leaves the machine.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function watchErrors() {
  const errs = []
  if (typeof window !== 'undefined') {
    window.addEventListener('error', (e) => { if (errs.length < 20) errs.push(String(e.message)) })
    window.addEventListener('unhandledrejection', (e) => { if (errs.length < 20) errs.push('unhandledrejection: ' + String(e.reason && e.reason.message || e.reason)) })
  }
  return errs
}

export async function runSelfCheck(ctx, panelId, catalog, errs, version, probeHolder, choose, E) {
  let cfg
  try {
    const r = await fetch('/vdc/config', { cache: 'no-store' })
    if (!r.ok) return
    cfg = await r.json()
  } catch { return }
  if (!cfg || cfg.selfcheck !== true) return

  const report = { plugin: '@vibedev-si/dsh-ecosystem', version, checks: {} }
  const add = (k, v) => { report.checks[k] = v }
  const safe = async (k, fn) => { try { add(k, await fn()) } catch (e) { add(k, { threw: String(e && e.message || e) }) } }

  const pm = ctx.remote && ctx.remote.pluginManager
  add('pluginManager.present', !!pm)
  add('pluginManager.methods', pm ? ['listBundles', 'inspect', 'installBundle', 'setBundleEnabled', 'removeBundle', 'cancelInstall', 'waitForInstall'].map((m) => [m, typeof pm[m]]) : null)
  add('remote.$on', typeof (ctx.remote && ctx.remote.$on))
  add('layout.selectPanel', typeof (ctx.layout && ctx.layout.selectPanel))
  add('market.render', typeof (ctx.reflect && ctx.reflect.get && ctx.reflect.get('market') && ctx.reflect.get('market').render))
  try { add('locale', ctx.locale.getLocale()) } catch (e) { add('locale', { threw: String(e) }) }

  if (pm) {
    await safe('registries()', async () => { const r = await pm.registries(); return r && r.ok ? r.value : { ok: false, error: r && r.error } })
    // Same decision the install flow makes: only considered when pnpm defaults to the official registry.
    let fastest = null
    await safe('registryProbe', async () => {
      const pr = probeHolder && probeHolder.probe
      if (!pr || typeof pr.fastest !== 'function') return { present: false, injected: !!(probeHolder && 'probe' in probeHolder) }
      const t0 = Date.now()
      const r = await pr.fastest()
      return { present: true, ms: Date.now() - t0, raw: r }
    })
    await safe('chooseRegistry', async () => { const t0 = Date.now(); fastest = await choose(pm, probeHolder && probeHolder.probe); return { chosen: fastest, ms: Date.now() - t0 } })
    await safe('listBundles', async () => {
      const r = await pm.listBundles()
      if (!r || !r.ok) return { ok: false, error: r && r.error }
      const names = new Set(r.value.filter((b) => b.installed).map((b) => b.name))
      return {
        ok: true,
        count: r.value.length,
        fieldsOfFirst: Object.keys(r.value[0] || {}),
        catalogState: catalog.plugins.map((p) => [p.npm, names.has(p.npm) ? 'installed' : 'absent']),
        legacyPresent: catalog.plugins.flatMap((p) => p.legacyNames || []).filter((n) => names.has(n)),
      }
    })
    // Read-only: asks the host what a spec points at. Used to confirm the real response shape.
    const timed = async (spec, registry) => {
      const t0 = Date.now()
      const r = await pm.inspect(spec, { registry })
      return { ms: Date.now() - t0, ...(r && r.ok ? { ok: true, value: r.value } : { ok: false, error: r && r.error }) }
    }
    await safe('inspect.notInstalled.defaultRegistry', () => timed('@vibedev-si/dsh-media-viewer@0.1.0', null))
    await safe('inspect.notInstalled.probedRegistry', () => timed('@vibedev-si/dsh-media-viewer@0.1.0', fastest))
    await safe('inspect.installedName', () => { const probe = catalog.plugins.find((p) => p.id === 'dsh-better-sidebar'); return timed(probe.npm + '@' + probe.version, null) })
  }

  // Switching the visible panel flashes the user's screen, and the host hot-reloads linked installs on every file change,
  // so doing it by default made it fire at random (it did, to a real user). It is therefore a SECOND, separate opt-in:
  // <profile>/.vdc/enable-selfcheck-mount. Without it the check stays entirely invisible.
  if (cfg.mount !== true) {
    add('panel.mounted', 'skipped: the visible mount check is off (create .vdc/enable-selfcheck-mount to run it)')
  } else {
  // Prove the panel mounts inside the real shell.
  let previous
  try { previous = ctx.layout.panelInfo && ctx.layout.panelInfo.getSnapshot().activePanelId } catch { /* optional */ }
  add('previousPanel', previous === undefined ? null : previous)
  try {
    ctx.layout.selectPanel(panelId)
    let el = null
    for (let i = 0; i < 20 && !el; i++) { await sleep(150); el = document.querySelector('[data-testid=center]') }
    add('panel.mounted', !!el)
    if (el) {
      const box = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      const vars = ['--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-brand-primary', '--dsw-alias-label-primary', '--dsw-alias-border-l1']
      const read = (node) => vars.map((v) => [v, getComputedStyle(node).getPropertyValue(v).trim() || null])
      add('panel.size', [Math.round(box.width), Math.round(box.height)])
      add('panel.cards', el.querySelectorAll('.card').length)
      add('panel.text', el.innerText.slice(0, 120))
      // Read FROM THE PANEL (variables inherit), and from its ancestors, to learn where the shell defines them.
      add('theme.onPanel', read(el))
      add('theme.onBody', read(document.body))
      add('theme.onHtml', read(document.documentElement))
      add('theme.resolved', { '--bg': cs.getPropertyValue('--bg').trim(), '--brand': cs.getPropertyValue('--brand').trim(), '--on-brand': el.style.getPropertyValue('--on-brand'), panelBackground: cs.backgroundColor, panelColor: cs.color, bodyBackground: getComputedStyle(document.body).backgroundColor })
      // The number that matters in a dark theme: can the label on a primary button actually be read?
      const btn = el.querySelector('.btn.primary')
      if (btn) { const bs = getComputedStyle(btn); add('theme.primaryButton', { color: bs.color, background: bs.backgroundColor, contrast: E && E.contrastRatio ? E.contrastRatio(bs.color, bs.backgroundColor) : null }) }
      const label = (() => { try { return Array.from(document.querySelectorAll('aside *, nav *')).filter((n) => n.children.length === 0 && /VibeDev/.test(n.textContent || '')).map((n) => n.textContent.trim()).slice(0, 6) } catch { return null } })()
      add('sidebar.labelsMentioningVibeDev', label)
      add('theme.hooks', {
        htmlClass: document.documentElement.className, htmlData: Object.assign({}, document.documentElement.dataset),
        bodyClass: document.body.className, bodyData: Object.assign({}, document.body.dataset),
        prefersDark: typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : null,
      })
      try { add('theme.snapshot', JSON.stringify(ctx.theme.getTheme()).slice(0, 600)) } catch (e) { add('theme.snapshot', 'unavailable: ' + String(e && e.message || e)) }
      add('panel.scrollable', (() => { const s = el.querySelector('.scroll'); return s ? s.scrollHeight > s.clientHeight || s.clientHeight > 0 : null })())
    }
  } catch (e) { add('panel.error', String(e && e.message || e)) }
  try { ctx.layout.selectPanel(previous === undefined ? null : previous) } catch { /* best effort */ }
  }

  add('errors', errs.slice())
  try {
    await fetch('/vdc/selfcheck', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report) })
  } catch { /* nothing to do */ }
}
