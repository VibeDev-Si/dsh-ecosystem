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

export async function runSelfCheck(ctx, panelId, catalog, errs, version) {
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
    await safe('inspect.notInstalled', async () => {
      const r = await pm.inspect('@vibedev-si/dsh-media-viewer@0.1.0', { registry: null })
      return r && r.ok ? { ok: true, value: r.value } : { ok: false, error: r && r.error }
    })
    await safe('inspect.installedName', async () => {
      const probe = catalog.plugins.find((p) => p.id === 'dsh-better-sidebar')
      const r = await pm.inspect(probe.npm + '@' + probe.version, { registry: null })
      return r && r.ok ? { ok: true, value: r.value } : { ok: false, error: r && r.error }
    })
  }

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
      const root = getComputedStyle(document.documentElement)
      add('panel.size', [Math.round(box.width), Math.round(box.height)])
      add('panel.cards', el.querySelectorAll('.card').length)
      add('panel.text', el.innerText.slice(0, 120))
      add('theme.vars', ['--dsw-alias-bg-base', '--dsw-alias-brand-primary', '--dsw-alias-label-primary'].map((v) => [v, root.getPropertyValue(v).trim() || null]))
      add('panel.scrollable', (() => { const s = el.querySelector('.scroll'); return s ? s.scrollHeight > s.clientHeight || s.clientHeight > 0 : null })())
    }
  } catch (e) { add('panel.error', String(e && e.message || e)) }
  try { ctx.layout.selectPanel(previous === undefined ? null : previous) } catch { /* best effort */ }

  add('errors', errs.slice())
  try {
    await fetch('/vdc/selfcheck', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report) })
  } catch { /* nothing to do */ }
}
