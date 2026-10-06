/**
 * The Plugin Center screen. One React component tree, driven entirely by:
 *   - the catalog (static data),
 *   - `host` : { pm, locale, openUrl?, copy?, renderMarket?, onChanged?, onLocale?, chooseRegistry?, settle? }
 * so the SAME code runs inside VibeDev and inside the Chrome test bench with a fake `pm`.
 *
 * Colours come only from the host's --dsw-alias-* variables (fallbacks are for the test bench).
 */
import * as E from './engine.js'
import { STR, L, pick, fmtSize } from './strings.js'

export function createCenter(React, catalog, host) {
  const h = React.createElement
  const { useState, useEffect, useRef, useCallback, useMemo } = React
  const FRAG = React.Fragment

  const PLUGINS = catalog.plugins
  const byId = (id) => PLUGINS.find((p) => p.id === id)
  const MARKET = 'dshmarket'
  let LANG = 'zh' // set at the top of every render; icon glyphs are letters in English, characters in Chinese

  /* ── style ─────────────────────────────────────────────────────────────── */
  const CSS = `
.vdc{--bg:var(--dsw-alias-bg-base,#fff);--l1:var(--dsw-alias-bg-layer-1,#f6f7f9);--l2:var(--dsw-alias-bg-layer-2,#eceef3);--ov:var(--dsw-alias-bg-overlay,#fff);
--b1:var(--dsw-alias-border-l1,rgba(20,24,40,.09));--b2:var(--dsw-alias-border-l2,rgba(20,24,40,.18));--brand:var(--dsw-alias-brand-primary,#4d6bfe);
--t1:var(--dsw-alias-label-primary,#1b1d24);--t2:var(--dsw-alias-label-secondary,#6c7080);--ok:var(--dsw-alias-state-success-primary,#1f9d62);
--warn:var(--dsw-alias-state-warn-primary,#c98a00);--err:var(--dsw-alias-state-error-primary,#d9363e);--idle:var(--dsw-alias-state-idle-primary,#9aa0ad);
position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--bg);color:var(--t1);font:14px/1.55 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;overflow:hidden}
.vdc *{box-sizing:border-box}.vdc button{font:inherit;color:inherit;cursor:pointer}.vdc svg{flex:none}
.vdc .top{display:flex;align-items:center;gap:18px;padding:12px 24px;border-bottom:1px solid var(--b1);background:var(--bg);flex:none;flex-wrap:wrap}
.vdc .brand{display:flex;align-items:center;gap:10px}.vdc .logo{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#4d6bfe,#8f6bff);display:grid;place-items:center;color:#fff}
.vdc h1{font-size:16px;margin:0;font-weight:650}.vdc .pill{font-size:11px;padding:1px 8px;border-radius:99px;border:1px solid var(--b2);color:var(--t2)}
.vdc .tabs{display:flex;gap:4px}.vdc .tab{border:0;background:transparent;padding:6px 12px;border-radius:8px;color:var(--t2);font-weight:550}
.vdc .tab:hover{background:var(--l1)}.vdc .tab.on{background:var(--l2);color:var(--t1)}.vdc .tab .n{margin-left:5px;font-size:11px;padding:0 6px;border-radius:99px;background:var(--brand);color:var(--on-brand,#fff)}
.vdc .sp{flex:1}.vdc .ghost{border:1px solid var(--b2);background:transparent;border-radius:8px;padding:6px 12px}.vdc .ghost:hover{background:var(--l1)}
.vdc .scroll{flex:1;overflow:auto;min-height:0}.vdc .wrap{max-width:1060px;margin:0 auto;padding:20px 24px 56px}
.vdc .banner{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:12px;border:1px solid color-mix(in srgb,var(--warn) 45%,var(--b1));background:color-mix(in srgb,var(--warn) 9%,var(--bg));margin-bottom:16px}
.vdc .banner .grow{flex:1}.vdc .banner small{display:block;color:var(--t2);margin-top:2px}
.vdc .intro{border:1px solid var(--b1);border-radius:16px;padding:18px 20px;background:linear-gradient(135deg,color-mix(in srgb,var(--brand) 8%,var(--bg)),var(--bg) 60%);margin-bottom:16px}
.vdc .intro h2{margin:0 0 4px;font-size:18px}.vdc .intro .lead{margin:0 0 14px;color:var(--t2)}
.vdc .three{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}
.vdc .fact{background:var(--bg);border:1px solid var(--b1);border-radius:12px;padding:12px 14px}.vdc .fact b{display:block;margin-bottom:2px}.vdc .fact span{color:var(--t2);font-size:13px}
.vdc .ic{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;background:color-mix(in srgb,var(--brand) 14%,transparent);color:var(--brand);margin-bottom:8px}
.vdc .not{margin-top:12px;font-size:13px;color:var(--t2)}.vdc .lnk{color:var(--brand);font-weight:600;cursor:pointer;background:none;border:0;padding:0}
.vdc .suite{border:1px solid var(--b2);border-radius:16px;padding:16px 18px;margin-bottom:20px;background:var(--l1);display:grid;grid-template-columns:1fr auto;gap:12px 20px;align-items:center}
.vdc .suite h3{margin:0;font-size:16px;display:flex;align-items:center;gap:8px}.vdc .suite p{margin:2px 0 0;color:var(--t2)}.vdc .suite .r{text-align:right}.vdc .suite .r small{display:block;color:var(--t2);margin-top:6px;font-size:12px}
.vdc .chips{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px;align-items:center}.vdc .chip{display:flex;align-items:center;gap:7px;padding:5px 10px 5px 6px;border-radius:99px;background:var(--bg);border:1px solid var(--b1);font-size:13px}
.vdc .chip .st{width:7px;height:7px;border-radius:50%;background:var(--idle)}.vdc .chip.done .st{background:var(--ok)}.vdc .arrow{color:var(--idle)}
.vdc .btn{border:1px solid var(--b2);background:var(--bg);padding:7px 14px;border-radius:9px;font-weight:600;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.vdc .btn:hover{background:var(--l1)}.vdc .btn.primary{background:var(--brand);border-color:var(--brand);color:var(--on-brand,#fff)}.vdc .btn.primary:hover{filter:brightness(1.08)}
.vdc .btn.big{padding:10px 20px}.vdc .btn.sm{padding:5px 9px}.vdc .btn[disabled]{opacity:.5;cursor:default}
.vdc .btn.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,var(--b1));background:color-mix(in srgb,var(--ok) 8%,var(--bg));pointer-events:none}
.vdc .btn.warn{background:color-mix(in srgb,var(--warn) 14%,var(--bg));border-color:color-mix(in srgb,var(--warn) 50%,var(--b1));color:var(--warn)}.vdc .btn.idle{color:var(--t2)}
.vdc .sec{display:flex;align-items:baseline;gap:10px;margin:6px 0 12px;flex-wrap:wrap}.vdc .sec h3{margin:0;font-size:15px}.vdc .sec span{color:var(--t2);font-size:13px}
.vdc .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;margin-bottom:22px}
.vdc .card{border:1px solid var(--b1);border-radius:14px;padding:16px;background:var(--bg);display:flex;flex-direction:column;gap:10px;cursor:pointer;transition:border-color .15s,box-shadow .15s}
.vdc .card:hover{border-color:var(--b2);box-shadow:0 4px 18px rgba(0,0,0,.06)}.vdc .card .hd{display:flex;gap:12px;align-items:center}
.vdc .gl{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;color:#fff;font-weight:700;font-size:18px;flex:none}
.vdc .nm{font-weight:650;font-size:15px}.vdc .sub{color:var(--t2);font-size:12px;word-break:break-all}.vdc .tg{flex:1;font-size:13px}
.vdc .tags{display:flex;flex-wrap:wrap;gap:6px}.vdc .tag{font-size:11px;padding:1px 8px;border-radius:99px;background:var(--l2);color:var(--t2);white-space:nowrap}
.vdc .tag.off{background:color-mix(in srgb,var(--brand) 14%,transparent);color:var(--brand);font-weight:600}.vdc .tag.acct{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}
.vdc .tag.role{background:color-mix(in srgb,var(--ok) 14%,transparent);color:var(--ok);font-weight:600}
.vdc .rels{display:flex;flex-direction:column;gap:6px}.vdc .rel{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.vdc .rel .rn{font-weight:500}.vdc .rel .rs{color:var(--t2);font-size:13px}.vdc .rel .lnk{margin-left:auto}
.vdc .ft{display:flex;align-items:center;gap:10px;position:relative}.vdc .ft .meta{flex:1;color:var(--t2);font-size:12px}.vdc .acts{display:flex;gap:6px;align-items:center;position:relative}
.vdc .dep{font-size:12px;color:var(--t2);display:flex;gap:6px;align-items:center}.vdc .dep.miss{color:var(--warn)}
.vdc .menu{position:absolute;right:0;bottom:calc(100% + 6px);min-width:150px;background:var(--ov);border:1px solid var(--b2);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:4px;z-index:6}
.vdc .menu button{display:block;width:100%;text-align:left;border:0;background:transparent;padding:7px 10px;border-radius:7px;font-size:13px}.vdc .menu button:hover{background:var(--l1)}.vdc .menu .danger{color:var(--err)}
.vdc .mask{position:absolute;inset:0;background:rgba(0,0,0,.35);z-index:20}
.vdc .drawer{position:absolute;top:0;right:0;bottom:0;width:440px;max-width:94%;background:var(--ov);border-left:1px solid var(--b2);z-index:21;display:flex;flex-direction:column}
.vdc .dh{padding:18px 20px 12px;border-bottom:1px solid var(--b1)}.vdc .dh .row{display:flex;gap:12px;align-items:center}.vdc .dh h2{margin:0;font-size:17px}
.vdc .x{margin-left:auto;border:0;background:transparent;font-size:20px;color:var(--t2);width:30px;height:30px;border-radius:8px}.vdc .x:hover{background:var(--l1)}
.vdc .db{flex:1;overflow:auto;padding:14px 20px 24px}.vdc .db h4{margin:18px 0 6px;font-size:12px;letter-spacing:.5px;color:var(--t2);text-transform:uppercase}
.vdc .db ul{margin:0;padding-left:18px}.vdc .db li{margin:3px 0}.vdc .kv{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:13px}.vdc .kv dt{color:var(--t2)}.vdc .kv dd{margin:0}
.vdc .cap{display:flex;gap:10px;padding:8px 10px;border:1px solid var(--b1);border-radius:10px;margin-bottom:6px;font-size:13px}.vdc .cap b{min-width:78px;white-space:nowrap}.vdc .cap span{color:var(--t2)}
.vdc pre.cmd{margin:6px 0;padding:8px 10px;border-radius:8px;background:var(--l1);border:1px solid var(--b1);font:12px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-all}
.vdc .links button{color:var(--brand);margin-right:14px;font-size:13px;background:none;border:0;padding:0}
.vdc .dfoot{padding:12px 20px;border-top:1px solid var(--b1);display:flex;gap:10px;align-items:center}.vdc .dfoot .grow{flex:1;color:var(--t2);font-size:12px}
.vdc .mask2{z-index:30}.vdc .modal{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:600px;max-width:94%;max-height:92%;background:var(--ov);border:1px solid var(--b2);border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.28);z-index:31;display:flex;flex-direction:column}
.vdc .mh{padding:18px 22px 6px}.vdc .mh h2{margin:0;font-size:17px}.vdc .mh p{margin:2px 0 0;color:var(--t2);font-size:13px}.vdc .mb{padding:10px 22px;overflow:auto}
.vdc .mf{padding:14px 22px 18px;display:flex;gap:10px;justify-content:flex-end;align-items:center;flex-wrap:wrap}.vdc .mf .grow{flex:1;color:var(--t2);font-size:12px}
.vdc .row3{display:flex;gap:12px;align-items:center;padding:10px 12px;border:1px solid var(--b1);border-radius:12px;margin-bottom:8px}.vdc .row3 .gl{width:32px;height:32px;font-size:14px;border-radius:9px}
.vdc .row3 .m{flex:1;min-width:0}.vdc .row3 .m div{font-size:12px;color:var(--t2)}.vdc .row3.skip{opacity:.6}
.vdc .stat{font-size:12px;color:var(--t2);display:flex;align-items:center;gap:6px;white-space:nowrap}.vdc .spin{width:14px;height:14px;border-radius:50%;border:2px solid var(--b2);border-top-color:var(--brand);animation:vdcsp .8s linear infinite}
@keyframes vdcsp{to{transform:rotate(360deg)}}
.vdc .dotc{width:14px;height:14px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:10px}.vdc .dotc.ok{background:var(--ok)}.vdc .dotc.err{background:var(--err)}.vdc .dotc.wait{background:var(--idle);opacity:.5}.vdc .dotc.hold{background:var(--warn)}
.vdc .bar{height:6px;border-radius:99px;background:var(--l2);overflow:hidden;margin:6px 0 12px}.vdc .bar i{display:block;height:100%;background:var(--brand);border-radius:99px;transition:width .3s}
.vdc .note{font-size:12px;color:var(--t2);margin:8px 0}.vdc .res{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:12px;margin:6px 0 10px}
.vdc .res.ok{background:color-mix(in srgb,var(--ok) 10%,var(--bg));border:1px solid color-mix(in srgb,var(--ok) 35%,var(--b1))}
.vdc .res.err{background:color-mix(in srgb,var(--err) 9%,var(--bg));border:1px solid color-mix(in srgb,var(--err) 35%,var(--b1))}
.vdc .res.warn{background:color-mix(in srgb,var(--warn) 10%,var(--bg));border:1px solid color-mix(in srgb,var(--warn) 40%,var(--b1))}
.vdc .res b{display:block}.vdc .res span{color:var(--t2);font-size:13px}.vdc details{margin:6px 0;font-size:13px}.vdc summary{cursor:pointer;color:var(--t2)}
.vdc .log{margin-top:6px;padding:8px 10px;border-radius:8px;background:var(--l1);border:1px solid var(--b1);font:11.5px/1.55 ui-monospace,Consolas,monospace;color:var(--t2);max-height:120px;overflow:auto;white-space:pre-wrap}
.vdc .next{margin-top:8px;padding:10px 12px;border-radius:10px;background:var(--l1);font-size:13px}.vdc .next li{margin:2px 0}
.vdc .foot{margin-top:6px;padding-top:16px;border-top:1px solid var(--b1);display:flex;gap:18px;color:var(--t2);font-size:13px;flex-wrap:wrap}
.vdc .empty{max-width:560px;margin:56px auto;text-align:center;display:flex;flex-direction:column;align-items:center;gap:10px}.vdc .empty .gl{width:56px;height:56px;border-radius:16px;font-size:24px}
.vdc .empty h2{margin:6px 0 0;font-size:20px}.vdc .empty p{margin:0 0 6px;color:var(--t2)}
.vdc .embed{border:1px solid var(--b1);border-radius:16px;overflow:hidden}.vdc .embed-h{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--b1);background:var(--l1)}
.vdc code{font:12px ui-monospace,Consolas,monospace;background:var(--l2);padding:0 5px;border-radius:5px}
`

  /* ── icons ─────────────────────────────────────────────────────────────── */
  const svg = (w, kids, extra) => h('svg', Object.assign({ width: w, height: w, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, extra || {}), kids)
  const path = (d, k) => h('path', { d, key: k || d })
  const I = {
    logo: () => svg(18, [path('M10 3H5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h1a2 2 0 1 1 0 4H5a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h5v-2a2 2 0 1 1 4 0v2h5a2 2 0 0 0 2-2v-5h-2a2 2 0 1 1 0-4h2V5a2 2 0 0 0-2-2h-5v1a2 2 0 1 1-4 0z')]),
    down: () => svg(15, [path('M12 4v12m0 0l-5-5m5 5l5-5M5 20h14')], { strokeWidth: 2.2 }),
    check: (w) => svg(w || 12, [path('M5 12l5 5L20 7')], { strokeWidth: 3.5 }),
    shield: () => svg(16, [path('M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', 'a'), path('M9 12l2 2 4-4', 'b')]),
    bolt: () => svg(16, [path('M13 2L4 14h7l-1 8 9-12h-7z')]),
    star: (w) => svg(w || 16, [path('M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z')]),
    warn: (w) => svg(w || 18, [path('M12 3l10 18H2z', 'a'), path('M12 10v5M12 18v.5', 'b')], { stroke: 'var(--warn)' }),
    ok: () => svg(20, [h('circle', { cx: 12, cy: 12, r: 9, key: 'c' }), path('M8 12.5l3 3 5-6', 'p')], { stroke: 'var(--ok)', strokeWidth: 2.2 }),
    err: () => svg(20, [h('circle', { cx: 12, cy: 12, r: 9, key: 'c' }), path('M9 9l6 6M15 9l-6 6', 'p')], { stroke: 'var(--err)', strokeWidth: 2.2 }),
    arrow: () => svg(14, [path('M5 12h14m-5-5l5 5-5 5')]),
  }
  const Glyph = (p, cls) => h('div', { className: cls || 'gl', style: { background: `linear-gradient(135deg,${p.icon.grad[0]},${p.icon.grad[1]})` } }, L(p.icon.glyph, LANG))

  /* ── pure helpers ──────────────────────────────────────────────────────── */
  const tagInfo = (t, S) => ({
    official: [S.tagOfficial, 'off'], community: [S.tagCommunity, ''], needsAccount: [S.tagNeedsAccount, 'acct'], paid: [S.tagPaid, ''],
    needsHost02: [S.tagNeedsHost02, ''], needsSidebar: [S.tagNeedsSidebar, ''], dependency: [S.tagDependency, 'role'], companion: [S.tagCompanion, 'role'], tested: [S.tagTested, 'role'],
  }[t])
  const sizeOf = (list) => {
    const kb = list.reduce((a, p) => a + p.sizeKB, 0)
    return kb < 1024 ? '< 1 MB' : fmtSize(kb)
  }

  /* ── component ─────────────────────────────────────────────────────────── */
  function Center() {
    const lang = pick(host.locale?.())
    LANG = lang
    const S = STR[lang]
    const [, bumpLocale] = useState(0)
    useEffect(() => (host.onLocale ? host.onLocale(() => bumpLocale((n) => n + 1)) : undefined), [])
    // Label colour on primary buttons: black or white, whichever reads on the host's CURRENT brand colour.
    const rootRef = useRef(null)
    useEffect(() => {
      const el = rootRef.current
      if (!el) return undefined
      const apply = () => {
        try {
          const probe = document.createElement('span')
          probe.style.cssText = 'position:absolute;width:0;height:0;background:var(--brand)'
          el.appendChild(probe); const bg = getComputedStyle(probe).backgroundColor; el.removeChild(probe)
          el.style.setProperty('--on-brand', E.readableTextOn(bg))
        } catch { /* keep the CSS fallback */ }
      }
      apply()
      const mo = typeof MutationObserver === 'function' ? new MutationObserver(apply) : null
      if (mo) { mo.observe(document.documentElement, { attributes: true }); mo.observe(document.body, { attributes: true }) }
      const timer = setInterval(apply, 1500) // themes that swap a stylesheet change no attribute
      return () => { mo && mo.disconnect(); clearInterval(timer) }
    }, [])
    const [bundles, setBundles] = useState(null) // null = loading, false = unavailable
    const [view, setView] = useState('all')
    const [intro, setIntro] = useState(false)
    const [drawer, setDrawer] = useState(null)
    const [menu, setMenu] = useState(null)
    const [modal, setModal] = useState(null) // {mode:'confirm'|'run'|'result'|'migrate'|'uninstall', ...}
    const aborter = useRef(null)
    const [selfUpd, setSelfUpd] = useState(null) // null | {kind:'checking'} | judgeSelfUpdate(...)
    const [copied, setCopied] = useState(false)
    // Plugins replaced underneath this page (updated, or removed and put back). See engine.trackLoadedChanges.
    const tracker = useRef({ prev: null, removed: [], dirty: [] })
    const [replaced, setReplaced] = useState([])

    const refresh = useCallback(async () => {
      if (!host.pm) { setBundles(false); return }
      try {
        const r = await E.readBundleInventory(host.pm)
        setBundles(r?.ok ? r.value : false)
        if (r?.ok) {
          tracker.current = E.trackLoadedChanges(tracker.current, r.value)
          setReplaced((old) => (old.length === tracker.current.dirty.length ? old : tracker.current.dirty))
        }
      } catch { setBundles(false) }
    }, [])
    useEffect(() => { refresh(); return host.onChanged?.(refresh) }, [refresh])

    const have = useMemo(() => new Map((bundles || []).filter(E.bundlePresent).map((b) => [b.name, b])), [bundles])
    const isIn = (p) => have.has(p.npm)
    const isOn = (p) => !!have.get(p.npm)?.enabled
    const isProvided = (p) => E.providedByApp(have.get(p.npm))
    const shownVersion = (p) => isProvided(p) ? have.get(p.npm)?.version ?? p.version : p.version
    const missingDeps = (p) => (p.requires || []).filter((d) => !isIn(byId(d)) || isProvided(byId(d)) && !isOn(byId(d)))
    const updates = useMemo(() => (bundles ? E.pendingUpdates(catalog, bundles) : []), [bundles])
    const legacy = useMemo(() => (bundles ? E.legacyInstalled(catalog, bundles).filter((x) => !x.newInstalled || true) : []), [bundles])

    const official = PLUGINS.filter((p) => p.origin === 'official')
    const companions = PLUGINS.filter((p) => p.role === 'dependency' || p.role === 'companion')
    const marketIn = isIn(byId(MARKET))

    const tagEls = (p) => {
      const tg = (p.tags || []).slice()
      if (p.reviewed) tg.push('tested')
      return tg.map((t) => { const i = tagInfo(t, S); return i ? h('span', { key: t, className: 'tag ' + i[1] }, i[0]) : null })
    }
    const roleEl = (role) => { const i = tagInfo(role, S); return i ? h('span', { className: 'tag ' + i[1] }, i[0]) : null }
    const relationState = (r) => r.provided ? S.provided : r.installed ? (r.enabled ? S.enabled : S.disabled) : S.notInstalled
    /** One declared relation: what it is, what this Host has, and the way to it. Never an install button. */
    const relationEls = (ids, kind) => h('div', { className: 'rels', 'data-testid': 'rel-' + kind }, ids
      .map((id) => (byId(id) === undefined ? null : E.relationsOf({ [kind]: [id] }, byId, bundles || [])[0]))
      .filter(Boolean)
      .map((r) => h('div', { className: 'rel', key: kind + ':' + r.id, 'data-rel': r.id },
        h('span', { className: 'rn' }, L(r.entry.name, lang)),
        roleEl(r.entry.role),
        h('span', { className: 'rs' }, relationState(r)),
        h('button', { className: 'lnk', onClick: () => setDrawer(r.id) }, r.present ? S.viewConfigure : S.view))))
    /** A plugin needed as well as paired with is listed once, under what it is needed for. */
    const partnerIds = (p) => { const required = new Set(p.requires || []); return (p.partners || []).filter((id) => !required.has(id)) }

    /* ── install flow ────────────────────────────────────────────────────── */
    const openInstall = (ids, title, opts = {}) => {
      setDrawer(null); setMenu(null)
      const rows = opts.update
        ? ids.map((id) => ({ entry: byId(id), installed: true, enabled: true, update: updates.find((u) => u.entry.id === id) }))
        : E.markInstalled(E.resolvePlan(catalog, ids), bundles || [])
      setModal({ mode: 'confirm', rows, title, update: !!opts.update })
    }
    const start = async (rows, title, update, approved) => {
      const run = { rows: rows.map((r) => ({ ...r, st: E.needsInstall(r, update) ? 'wait' : 'skip', sub: '' })), log: [], title, update, cur: null, approved: approved || {} }
      aborter.current = new AbortController()
      setModal({ mode: 'run', run: { ...run } })
      const upd = () => setModal({ mode: 'run', run: { ...run, rows: run.rows.map((r) => ({ ...r })) } })
      const todo = run.rows.filter((r) => r.st !== 'skip')
      // Like the official Plugins page: ask the host which registry answers fastest (it matters on mainland-China networks).
      const registry = (await host.chooseRegistry?.()) ?? null
      run.log.push(`start: ${todo.length}`, `registry: ${registry || 'default'}`)
      const results = []
      // Let the host finish applying one plugin before the next change (see engine.waitQuiet for why).
      const T = (host.settle && host.settle()) || {}
      const between = T.between || { quietMs: 1200, maxMs: 6000 }
      const closing = T.final || { quietMs: 2500, maxMs: 12000 }
      let first = true
      for (const row of run.rows) {
        if (row.st === 'skip') continue
        if (aborter.current.signal.aborted) { row.st = 'wait'; results.push({ id: row.entry.id, status: 'cancelled' }); break }
        if (!first) { run.waiting = true; upd(); await E.waitQuiet(host.onChanged, between); run.waiting = false }
        first = false
        run.cur = row; row.st = 'run'; row.sub = S.stInspect; upd()
        const state = update ? { installed: true, enabled: row.enabled } : row
        const r = await E.installOne(host.pm, row.entry, state, {
          update,
          registry,
          approvedBuilds: run.approved[row.entry.id],
          hooks: {
            onStep: (s) => {
              row.sub = s === 'inspect' ? S.stInspect : s === 'install' ? S.stInstall : s === 'disable-old' ? S.stOldOff : s === 'remove-old' ? S.stOldRemove : S.stEnable
              row.late = s !== 'inspect' && s !== 'install' // past the install nothing can be cancelled, the switch steps included
              run.log.push(`${s} ${s.endsWith('-old') ? row.legacy : E.specOf(row.entry)}`); upd()
            },
            onRequest: (id) => { row.requestId = id },
          },
        })
        results.push({ id: row.entry.id, ...r })
        if (r.status === 'failed' || r.status === 'cancelled') {
          row.st = r.failure?.kind === 'builds' ? 'hold' : 'err'
          row.failure = r.failure; run.log.push(`! ${r.failure?.kind || r.status}: ${r.failure?.diagnostic || ''}`)
          break
        }
        row.st = 'ok'; row.outcome = r.status; run.cur = null; run.log.push(`ok ${row.entry.id} (${r.status})`); upd()
      }
      const failed = results.find((x) => x.status === 'failed' || x.status === 'cancelled')
      const restart = results.some((x) => x.status === 'restart')
      // Only wait when something was actually changed: a failed or cancelled run has nothing left to apply.
      if (!failed && results.some((x) => x.status === 'done' || x.status === 'enabledOnly' || x.status === 'restart')) { run.settling = true; run.cur = null; upd(); await E.waitQuiet(host.onChanged, closing); run.settling = false }
      await refresh()
      setModal({ mode: 'result', run: { ...run, rows: run.rows.map((r) => ({ ...r })) }, results, failed, restart, update, title })
    }
    const cancelRun = async () => {
      aborter.current?.abort()
      const cur = modal?.run?.cur
      if (cur?.requestId && host.pm?.cancelInstall) { try { await host.pm.cancelInstall(cur.requestId) } catch { /* best effort */ } }
    }

    const doMigrate = async (x) => {
      setModal({ mode: 'migrate', x, phase: 'run', step: 'inspect' })
      const registry = (await host.chooseRegistry?.()) ?? null
      const r = await E.migrate(host.pm, x.entry, x.legacy, { registry, hooks: { onStep: (s) => setModal((m) => (m && m.mode === 'migrate' ? { ...m, step: s } : m)) } })
      await refresh()
      setModal({ mode: 'migrate', x, phase: 'done', result: r })
    }
    const doUninstall = async (p) => {
      setMenu(null)
      const r = await E.uninstall(host.pm, p)
      await refresh()
      if (r.status === 'done' || r.status === 'restart') return
      setModal({ mode: 'uninstall', p, result: r })
    }
    const toggle = async (p, on) => { setMenu(null); const r = await host.pm.setBundleEnabled(p.npm, on); await refresh(); return r }

    /* ── pieces ──────────────────────────────────────────────────────────── */
    // "Is there a newer center?": one read of npm, made by the host half, only when the user clicks.
    const checkSelf = async () => {
      setSelfUpd({ kind: 'checking' })
      const answer = await (host.checkLatest ? host.checkLatest() : Promise.resolve(undefined))
      setSelfUpd(E.judgeSelfUpdate(host.version?.() ?? '0.0.0', answer))
    }
    const SELF_PKG = '@vibedev-si/dsh-ecosystem'
    const copyPkg = () => { host.copy?.(SELF_PKG); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    const stateBtn = (p) => {
      if (isProvided(p)) return h('span', { className: 'btn ' + (isOn(p) ? 'ok' : ''), 'data-testid': 'provided', title: S.providedNote }, S.provided, ' · ', isOn(p) ? S.enabled : S.disabled)
      if (isIn(p)) {
        const on = isOn(p)
        const up = updates.find((u) => u.entry.id === p.id)
        const main = up
          ? h('button', { className: 'btn warn', onClick: (e) => { e.stopPropagation(); openInstall([p.id], `${S.updateTo(up.to)}`, { update: true }) } }, I.down(), ' ', S.updateTo(up.to))
          : !on ? h('button', { className: 'btn', onClick: (e) => { e.stopPropagation(); toggle(p, true) } }, S.enable)
          : h('span', { className: 'btn ok' }, I.check(), ' ', S.enabled)
        return h('span', { className: 'acts' }, main,
          h('button', { className: 'btn sm idle', onClick: (e) => { e.stopPropagation(); setMenu(menu === p.id ? null : p.id) } }, S.manage),
          menu === p.id && h('div', { className: 'menu', onClick: (e) => e.stopPropagation() },
            h('button', { onClick: () => { setMenu(null); setDrawer(p.id) } }, S.details),
            h('button', { onClick: () => toggle(p, !on) }, on ? S.disable : S.enable),
            h('button', { className: 'danger', onClick: () => doUninstall(p) }, S.uninstall)))
      }
      const m = missingDeps(p)
      return h('button', { className: 'btn primary', disabled: !host.pm || bundles === false, onClick: (e) => { e.stopPropagation(); openInstall([p.id], `${S.install} ${L(p.name, lang)}${m.length ? '' : ''}`) } }, I.down(), ' ', m.length ? S.installWithDeps : S.install)
    }
    const Card = (p) => {
      const m = missingDeps(p)
      const dep = (p.requires || []).length
        ? h('div', { className: 'dep ' + (m.length ? 'miss' : '') }, m.length ? I.warn(14) : h('span', { className: 'dotc ok' }, I.check(9)),
          S.needs((p.requires || []).map((d) => L(byId(d).name, lang)).join(', ')), m.length ? S.willInstall : S.satisfied)
        : null
      return h('div', { className: 'card', key: p.id, 'data-id': p.id, onClick: () => setDrawer(p.id) },
        h('div', { className: 'hd' }, Glyph(p), h('div', null, h('div', { className: 'nm' }, L(p.name, lang)), h('div', { className: 'sub' }, `${p.npm} · ${shownVersion(p)}`))),
        h('div', { className: 'tg' }, L(p.tagline, lang)),
        h('div', { className: 'tags' }, tagEls(p)),
        dep,
        h('div', { className: 'ft' }, h('div', { className: 'meta' }, p.sizeNote ? L(p.sizeNote, lang) : fmtSize(p.sizeKB)), stateBtn(p)))
    }

    const Suite = () => {
      const s = catalog.suites[0]
      const items = s.items.map(byId)
      const todo = items.filter((p) => !isIn(p) || !isOn(p) || isProvided(p) && legacy.some((x) => x.entry.id === p.id))
      const filmish = todo.some((p) => p.sizeKB > 10000)
      const chips = []
      items.forEach((p, i) => {
        if (i) chips.push(h('span', { className: 'arrow', key: 'a' + i }, I.arrow()))
        chips.push(h('div', { className: 'chip ' + (isIn(p) ? 'done' : ''), key: p.id }, Glyph(p, 'gl'), L(p.name, lang), h('span', { className: 'st' })))
      })
      chips.forEach((c) => c)
      return h('div', { className: 'suite' },
        h('div', null, h('h3', null, I.star(18), ' ', L(s.name, lang)), h('p', null, L(s.tagline, lang))),
        h('div', { className: 'r' }, todo.length
          ? [h('button', { key: 'b', className: 'btn primary big', disabled: !host.pm || bundles === false, onClick: () => openInstall(s.items, `${S.install} ${L(s.name, lang)}`) }, I.down(), ' ', S.suiteInstall),
            h('small', { key: 's' }, S.suiteWill(todo.length, items.length - todo.length, filmish ? '~12 MB' : S.sizeSmall))]
          : h('span', { className: 'btn ok big' }, I.check(), ' ', S.suiteDone)),
        h('div', { className: 'chips' }, chips))
    }

    // Shown for as long as this page lives: a restart makes a new page and the notice goes away by itself.
    const NoRefresh = () => {
      if (!replaced.length) return null
      const names = replaced.map((n) => { const p = PLUGINS.find((x) => x.npm === n); return p ? L(p.name, lang) : n }).join(lang === 'zh' ? '\u3001' : ', ')
      return h('div', { className: 'banner', 'data-testid': 'no-refresh', role: 'alert' }, I.warn(),
        h('div', { className: 'grow' }, h('b', null, S.noRefreshT), h('small', null, S.noRefreshB(names))))
    }

    const SelfUpdate = () => {
      if (!selfUpd) return null
      const cur = host.version?.() ?? ''
      const close = h('button', { className: 'x', key: 'x', title: S.dismiss, onClick: () => setSelfUpd(null) }, '\u00d7')
      const at = (d) => d.toLocaleString()
      if (selfUpd.kind === 'checking') return h('div', { className: 'note', 'data-testid': 'self-update', 'data-kind': 'checking', style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 } }, h('span', { className: 'spin' }), S.checking)
      if (selfUpd.kind === 'same' || selfUpd.kind === 'ahead') return h('div', { className: 'res ok', 'data-testid': 'self-update', 'data-kind': selfUpd.kind }, I.ok(), h('div', { style: { flex: 1 } }, h('span', null, selfUpd.kind === 'same' ? S.selfOk(cur) : S.selfAhead(cur, selfUpd.latest))), close)
      if (selfUpd.kind === 'unavailable') {
        const list = (selfUpd.sources || []).map((s) => { let host0 = s.registry; try { host0 = new URL(s.registry).host } catch { /* keep as is */ } return `${host0} (${s.error})` }).join(', ')
        return h('div', { className: 'res warn', 'data-testid': 'self-update', 'data-kind': 'unavailable' }, I.warn(), h('div', { style: { flex: 1 } }, h('b', null, S.selfFailT), h('span', null, S.selfFailB(list))), close)
      }
      const cd = E.cooldownState(selfUpd.publishedAt)
      return h('div', { className: 'res warn', 'data-testid': 'self-update', 'data-kind': 'newer' }, I.warn(), h('div', { style: { flex: 1 } },
        h('b', null, S.selfNewT(selfUpd.latest, cur)), h('span', null, S.selfNewB),
        h('pre', { className: 'cmd', 'data-testid': 'self-pkg' }, SELF_PKG),
        cd.active && h('div', { className: 'note', 'data-testid': 'self-cooldown' }, S.selfCool(at(new Date(selfUpd.publishedAt)), at(cd.endsAt))),
        h('div', { style: { display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' } },
          h('button', { className: 'btn primary sm', 'data-testid': 'copy-self', onClick: copyPkg }, copied ? S.copiedPkg : S.copyPkg),
          h('button', { className: 'btn sm', 'data-testid': 'view-self', onClick: () => host.openUrl?.(`https://github.com/VibeDev-Si/dsh-ecosystem/tree/v${selfUpd.latest}`) }, S.viewVersion))), close)
    }

    const Intro = () => h('div', { className: 'intro' },
      h('h2', null, S.introTitle), h('p', { className: 'lead' }, S.introLead),
      h('div', { className: 'three' },
        h('div', { className: 'fact' }, h('div', { className: 'ic' }, I.shield()), h('b', null, S.f1t), h('span', null, S.f1d)),
        h('div', { className: 'fact' }, h('div', { className: 'ic' }, I.bolt()), h('b', null, S.f2t), h('span', null, S.f2d)),
        h('div', { className: 'fact' }, h('div', { className: 'ic' }, I.star()), h('b', null, S.f3t), h('span', null, S.f3d))),
      h('div', { className: 'not' }, I.arrow(), ' ', S.introMarketNo,
        h('button', { className: 'lnk', onClick: () => (marketIn ? setView('community') : openInstall([MARKET], `${S.install} ${L(byId(MARKET).name, lang)}`)) }, marketIn ? S.openMarket : S.installMarket)))

    const Banner = () => legacy.map((x) => h('div', { className: 'banner', key: x.legacy, 'data-testid': 'migrate-banner' }, I.warn(),
      h('div', { className: 'grow' }, h('b', null, S.migrateTitle(x.legacy)), ' ', S.migrateBody(x.legacy, x.entry.npm), h('small', null, x.provided ? S.providedMigration : S.migrateOrder)),
      h('button', { className: 'btn primary', onClick: () => doMigrate(x) }, S.migrateBtn)))

    const Community = () => {
      const p = byId(MARKET)
      if (!marketIn) return h('div', { className: 'empty' }, Glyph(p), h('h2', null, S.communityEmptyT), h('p', null, S.communityEmptyB),
        h('button', { className: 'btn primary big', disabled: !host.pm, onClick: () => openInstall([MARKET], `${S.install} ${L(p.name, lang)}`) }, I.down(), ' ', S.installMarket), h('div', { className: 'note' }, S.communityNote))
      const embedded = host.renderMarket?.()
      return h('div', { className: 'embed' },
        h('div', { className: 'embed-h' }, h('b', null, S.tabCommunity), h('span', { className: 'pill' }, S.communityViaMarket), h('span', { className: 'sp' }), h('button', { className: 'btn sm', onClick: () => setDrawer(MARKET) }, S.communityAbout)),
        h('div', { style: { padding: 16 } }, embedded || h('div', { className: 'note', 'data-testid': 'no-embed' }, S.communityNoEmbed)))
    }

    const Main = () => {
      if (view === 'community') return Community()
      let list = official
      if (view === 'installed') list = official.filter(isIn)
      if (view === 'updates') list = updates.map((u) => u.entry)
      return [
        view === 'all' && intro && h(Intro, { key: 'i' }),
        view === 'all' && h(Suite, { key: 's' }),
        h('div', { className: 'sec', key: 'h' }, h('h3', null, S.official), h('span', null, S.officialSub(official.length))),
        list.length ? h('div', { className: 'grid', key: 'g' }, list.map(Card))
          : h('div', { className: 'note', key: 'n', style: { padding: '30px 0', textAlign: 'center' } }, view === 'updates' ? S.allUpToDate : S.nothingInstalled),
        view === 'all' && [
          h('div', { className: 'sec', key: 'dh' }, h('h3', null, S.deps), h('span', null, S.depsSub)),
          h('div', { className: 'grid', key: 'dg' }, companions.map(Card)),
        ],
      ]
    }

    const Drawer = () => {
      const p = drawer && byId(drawer)
      if (!p) return null
      const m = missingDeps(p)
      const caps = (p.capabilities || [])
      return [
        h('div', { className: 'mask', key: 'm', onClick: () => setDrawer(null) }),
        h('aside', { className: 'drawer', key: 'd', 'data-testid': 'drawer' },
          h('div', { className: 'dh' }, h('div', { className: 'row' }, Glyph(p), h('div', null, h('h2', null, L(p.name, lang)), h('div', { className: 'sub' }, `${p.npm} · ${shownVersion(p)} · ${p.origin === 'official' ? S.officialSrc : S.communitySrc(p.author)}`)),
            h('button', { className: 'x', onClick: () => setDrawer(null) }, '×')), h('div', { className: 'tags', style: { marginTop: 10 } }, tagEls(p))),
          h('div', { className: 'db' },
            h('div', null, L(p.tagline, lang)),
            h('h4', null, S.does), h('ul', null, (p.does[lang] || p.does.en).map((d, i) => h('li', { key: i }, d))),
            h('h4', null, S.needsH),
            h('dl', { className: 'kv' },
              h('dt', null, S.prereq), h('dd', null, (p.requires || []).length ? relationEls(p.requires, 'requires') : S.none),
              h('dt', null, S.partners), h('dd', null, partnerIds(p).length ? relationEls(partnerIds(p), 'partners') : S.none),
              h('dt', null, S.size), h('dd', null, fmtSize(p.sizeKB))),
            E.oldCanvas(p, have.get(p.npm)) ? h('div', { className: 'note', 'data-testid': 'old-canvas' }, S.oldCanvasNote,
              h('button', { className: 'btn', 'data-testid': 'old-canvas-upgrade', onClick: () => openInstall([p.id], S.updateTo(shownVersion(p)), { update: true }) }, S.upgradeCanvas)) : null,
            h('h4', null, S.capsH), caps.map((c) => h('div', { className: 'cap', key: c.key }, h('b', null, capLabel(c.key, lang)), h('span', null, L(c.text, lang)))),
            h('h4', null, S.sourceH),
            h('dl', { className: 'kv' },
              h('dt', null, S.source), h('dd', null, p.origin === 'official' ? S.officialSrc : S.communitySrc(p.author)),
              h('dt', null, S.review), h('dd', null, p.origin === 'official' ? S.officialReview : p.reviewed ? S.reviewedBy(p.reviewed.tested.join(', '), p.reviewed.date) : S.notReviewed),
              p.compat ? [h('dt', { key: 'a' }, S.compat), h('dd', { key: 'b' }, `${S.compatS[p.compat.s]}: ${L(p.compat.why, lang)}`)] : null),
            h('h4', null, isProvided(p) ? S.provided : S.manualH), isProvided(p) ? h('div', { className: 'note', 'data-testid': 'provided-note' }, S.providedNote) : [h('pre', { className: 'cmd', key: 'cmd' }, p.cmd), h('div', { className: 'note', key: 'note' }, S.manualNote)],
            h('div', { className: 'links' }, h('button', { onClick: () => host.openUrl?.(p.links.repo) }, S.repo), h('button', { onClick: () => host.openUrl?.(p.links.npm) }, S.npm), !isProvided(p) && h('button', { onClick: () => host.copy?.(p.cmd) }, S.copyCmd))),
          h('div', { className: 'dfoot' }, h('div', { className: 'grow' }, isProvided(p) ? S.provided : isIn(p) ? (isOn(p) ? S.enabled : S.disabled) : m.length ? S.willInstall : ''), isIn(p) ? h('button', { className: 'btn', disabled: true }, isProvided(p) ? S.provided : isOn(p) ? S.enabled : S.disabled)
            : h('button', { className: 'btn primary big', disabled: !host.pm, onClick: () => openInstall([p.id], `${S.install} ${L(p.name, lang)}`) }, I.down(), ' ', m.length ? S.installWithDeps : S.install))),
      ]
    }
    const capLabel = (k, lg) => ({
      network: lg === 'zh' ? '联网' : 'Network', writeFiles: lg === 'zh' ? '写入文件' : 'Writes files', readFiles: lg === 'zh' ? '读取文件' : 'Reads files', credentials: lg === 'zh' ? '凭据' : 'Credentials',
      cost: lg === 'zh' ? '费用' : 'Cost', agentTools: lg === 'zh' ? 'Agent 工具' : 'Agent tools', localRoute: lg === 'zh' ? '本机路由' : 'Local route', pageScripts: lg === 'zh' ? '页面脚本' : 'Page scripts',
      community: lg === 'zh' ? '社区插件' : 'Community', fileAccess: lg === 'zh' ? '文件访问' : 'File access', writeConfig: lg === 'zh' ? '写入配置' : 'Writes config',
    }[k] || k)

    /* ── modals ──────────────────────────────────────────────────────────── */
    const stIcon = (r) => {
      if (r.st === 'skip') return h('span', { className: 'stat' }, S.stSkip)
      if (r.st === 'wait') return h('span', { className: 'stat' }, h('span', { className: 'dotc wait' }), S.stWait)
      if (r.st === 'ok') return h('span', { className: 'stat', style: { color: 'var(--ok)' } }, h('span', { className: 'dotc ok' }, I.check(9)), S.stDone)
      if (r.st === 'hold') return h('span', { className: 'stat', style: { color: 'var(--warn)' } }, h('span', { className: 'dotc hold' }, '!'), S.stHold)
      if (r.st === 'err') return h('span', { className: 'stat', style: { color: 'var(--err)' } }, h('span', { className: 'dotc err' }, '!'), S.stFail)
      return h('span', { className: 'stat' }, h('span', { className: 'spin' }), r.sub)
    }
    const Row = (r) => h('div', { className: 'row3 ' + (r.st === 'skip' ? 'skip' : ''), key: r.entry.id }, Glyph(r.entry, 'gl'),
      h('div', { className: 'm' }, h('b', null, L(r.entry.name, lang)), ' ', h('span', { style: { color: 'var(--t2)', fontWeight: 400 } }, r.update ? `${r.update.from} → ${r.update.to}` : r.entry.version),
        h('div', null, r.st === 'skip' ? (r.provided ? S.provided + ' · ' + S.alreadyInstalled : S.alreadyInstalled) : r.update ? S.afterUpdateRefresh : r.legacy ? `${r.entry.npm} · ${S.replacesOld(r.legacy)}` : r.entry.npm)), stIcon(r))

    const Confirm = () => {
      const { rows, title, update } = modal
      const todo = rows.filter((r) => E.needsInstall(r, update))
      const accts = update ? [] : todo.filter((r) => (r.entry.tags || []).includes('needsAccount'))
      const switching = update ? [] : todo.filter((r) => r.legacy)
      return [
        h('div', { className: 'mh', key: 'h' }, h('h2', null, title), h('p', null, update ? S.willUpdateN(todo.length, sizeOf(todo.map((r) => r.entry))) : S.willInstallN(todo.length, rows.length - todo.length, sizeOf(todo.map((r) => r.entry))))),
        h('div', { className: 'mb', key: 'b' },
          rows.map((r) => Row({ ...r, st: E.needsInstall(r, update) ? 'wait-confirm' : 'skip', sub: '' })).map((el, i) => React.cloneElement(el, { key: i })),
          (() => {
            if (!update) return null
            const fresh = todo.filter((r) => E.cooldownState(r.entry.publishedAt).active)
            if (!fresh.length) return h('div', { className: 'note' }, S.updateKeeps)
            const end = new Date(Math.max(...fresh.map((r) => E.cooldownState(r.entry.publishedAt).endsAt.getTime())))
            return h('div', { className: 'res warn', 'data-testid': 'cooldown-note' }, I.warn(), h('div', null, h('span', null, S.coolUpdate(fresh.map((r) => `${L(r.entry.name, lang)} ${r.entry.version}`).join(lang === 'zh' ? '\u3001' : ', '), end.toLocaleString()))))
          })(),
          accts.length ? h('div', { className: 'res warn' }, I.warn(), h('div', null, h('b', null, S.acctTitle), h('span', null, S.acctBody(accts.map((r) => L(r.entry.name, lang)).join(', '))))) : null,
          switching.length ? h('div', { className: 'note', 'data-testid': 'switch-note' }, S.switchNote(switching.map((r) => r.legacy).join(', '))) : null,
          h('details', null, h('summary', null, S.stepsH), h('div', { className: 'log' }, todo.map((r) => r.legacy && !update
            ? `1 inspect  ${E.specOf(r.entry)}\n2 install enabled:false\n3 disable  ${r.legacy}\n4 enable   -> applied\n5 remove   ${r.legacy}`
            : `1 inspect  ${E.specOf(r.entry)}\n2 ${update ? 'update ' : 'install'} enabled:false\n3 enable   -> applied`).join('\n\n') + '\n\n' + S.stepsFoot))),
        h('div', { className: 'mf', key: 'f' }, h('div', { className: 'grow' }, S.consent(update)), h('button', { className: 'btn', onClick: () => setModal(null) }, S.cancel),
          h('button', { className: 'btn primary big', 'data-testid': 'confirm', onClick: () => start(rows, title, update) }, S.confirmInstall(todo.length, update))),
      ]
    }
    const Run = () => {
      const { run } = modal
      const todo = run.rows.filter((r) => r.st !== 'skip')
      const done = todo.filter((r) => r.st === 'ok').length
      const pct = todo.length ? Math.round(((done + (run.cur ? 0.5 : 0)) / todo.length) * 100) : 100
      return [
        h('div', { className: 'mh', key: 'h' }, h('h2', null, `${S.installing}: ${run.title.replace(/^[^ ]+ /, '')}`), h('p', { 'data-testid': 'progress' }, run.settling ? S.settling : run.waiting ? S.waitingHost : S.progress(done, todo.length))),
        h('div', { className: 'mb', key: 'b' }, h('div', { className: 'bar' }, h('i', { style: { width: Math.min(pct, 100) + '%' } })), run.rows.map(Row),
          h('details', { open: true }, h('summary', null, S.logH), h('div', { className: 'log' }, run.log.join('\n')))),
        h('div', { className: 'mf', key: 'f' }, h('div', { className: 'grow' }, run.cur && run.cur.late ? S.cancelHintLate : S.cancelHintOk), h('button', { className: 'btn', 'data-testid': 'cancel', disabled: !!(run.cur && run.cur.late), onClick: cancelRun }, S.cancelInstall)),
      ]
    }
    const failText = (f) => {
      switch (f.kind) {
        case 'network': return [S.fNetworkT, S.fNetworkB(f.registries ? f.registries.length : 0, f.diagnostic), 'err']
        case 'builds': return [S.fBuildsT, S.fBuildsB(f.pendingBuilds.join(', ')), 'warn']
        case 'incompat': return [S.fIncompatT, S.fIncompatB((f.incompatible || []).map((x) => `${x.name}@${x.version}: ${x.runtimeVersion} (${Object.entries(x.peers).map(([a, b]) => `${a} ${b}`).join(', ')}). `).join('')), 'err']
        case 'notfound': return [S.fNotFoundT, S.fNotFoundB, 'err']
        case 'mismatch': return [S.fMismatchT, S.fMismatchB(f.diagnostic || ''), 'err']
        case 'exempt': return [S.fExemptT, S.fExemptB(f.culprit, E.cooldownEnds(f.publishedAt)?.toLocaleString()), 'err']
        case 'busy': return [S.fBusyT, S.fBusyB, 'err']
        case 'provided': return [S.providedBlockedT, S.providedBlockedB, 'warn']
        case 'refused': return [S.fRefusedT, f.diagnostic || '', 'err']
        default: return [S.fFailedT, f.diagnostic ? f.diagnostic.slice(0, 400) : S.fFailedB, 'err']
      }
    }
    const Result = () => {
      const { run, results, failed, restart, update } = modal
      const todo = run.rows.filter((r) => r.st !== 'skip')
      const done = todo.filter((r) => r.st === 'ok')
      const failedRow = run.rows.find((r) => r.st === 'err' || r.st === 'hold')
      // An old package name that was switched off but could not be removed (the migrate banner offers to finish it).
      const leftOld = (results || []).some((x) => x.legacyLeft) && h('div', { className: 'res warn', key: 'old', 'data-testid': 'legacy-left' }, I.warn(), h('div', null, h('span', null, S.migHalf)))
      let head, extra, acts, title
      if (!failed && !restart) {
        title = S.doneTitle
        head = h('div', { className: 'res ok' }, I.ok(), h('div', null, h('b', null, S.doneHead(done.length)), h('span', null, S.doneLoaded)))
        const ids = done.map((r) => r.entry.id)
        extra = [leftOld, h('div', { className: 'next', key: 'next' }, h('b', null, S.nextH), h('ul', null,
          ids.includes('dsh-film') && h('li', { key: 1 }, S.nextFilm), ids.includes('@vibedev-si/dsh-vibedev') && h('li', { key: 2 }, S.nextVibedev),
          ids.includes('@vibedev-si/dsh-media-viewer') && h('li', { key: 3 }, S.nextViewer), ids.includes(MARKET) && h('li', { key: 4 }, S.nextMarket),
          !marketIn && !ids.includes(MARKET) && h('li', { key: 5 }, S.nextMarketHint)))]
        // No "reload the page" button, on purpose: the official Plugins page never reloads either (the host loads an
        // enabled plugin itself), and a reload pressed while the host was still applying the last change crashed a real user's boot.
        acts = h('button', { className: 'btn primary big', 'data-testid': 'done', onClick: () => setModal(null) }, S.gotIt)
      } else if (!failed && restart) {
        title = S.restartTitle
        head = h('div', { className: 'res warn' }, I.warn(), h('div', null, h('b', null, S.restartHead), h('span', null, S.restartBody(done.length))))
        extra = leftOld
        acts = h('button', { className: 'btn primary big', onClick: () => setModal(null) }, S.gotIt)
      } else {
        title = S.failTitle
        const f = failedRow?.failure || { kind: 'failed' }
        const [t, b, tone] = failed?.status === 'cancelled' ? [S.cancelInstall, '', 'warn'] : failText(f)
        head = h('div', { className: 'res ' + tone, 'data-testid': 'fail', 'data-kind': f.kind }, tone === 'warn' ? I.warn() : I.err(), h('div', null, h('b', null, t), h('span', null, b)))
        extra = [
          // After a failed switch, turning the new one on by hand would run both: say what happened to the old one instead.
          failed?.restoredOld ? h('div', { className: 'note', key: 1, 'data-testid': 'restored-old' }, S.migRestored)
            : failed?.oldStillEnabled ? h('div', { className: 'note', key: 1, 'data-testid': 'old-still-on' }, S.oldStillOn(failedRow?.legacy ?? ''))
            : failed?.installedNotEnabled && h('div', { className: 'note', key: 1 }, S.installedNotEnabled),
          h('div', { className: 'note', key: 2 }, (done.length ? S.keptDone(done.length) : '') + (f.kind === 'builds' ? S.noChangeHold : S.noChangeFail)),
          failed?.uncertain && h('div', { className: 'res warn', key: 3 }, I.warn(), h('div', null, h('b', null, S.uncertainT), h('span', null, S.uncertainB))),
        ]
        const retryNow = () => start(run.rows.map((r) => ({ ...r, installed: r.st === 'ok' || r.installed && r.enabled, enabled: r.st === 'ok' || r.enabled })), run.title, update)
        acts = f.kind === 'provided' ? h('button', { className: 'btn', onClick: () => setModal(null) }, S.gotIt) : f.kind === 'builds'
          ? [h('button', { className: 'btn', key: 's', onClick: () => setModal(null) }, S.skipThis), h('button', { className: 'btn primary big', key: 'r', 'data-testid': 'approve', onClick: () => start(run.rows.map((r) => ({ ...r, installed: r.st === 'ok' || (r.installed && r.enabled), enabled: r.st === 'ok' || r.enabled })), run.title, update, { [failedRow.entry.id]: f.pendingBuilds }) }, S.approveRetry)]
          : [h('button', { className: 'btn', key: 'c', onClick: () => { host.copy?.(failedRow ? failedRow.entry.cmd : ''); } }, S.copyCmd), h('button', { className: 'btn', key: 'x', onClick: () => setModal(null) }, S.later),
            f.kind !== 'incompat' && f.kind !== 'mismatch' && h('button', { className: 'btn primary big', key: 'r', 'data-testid': 'retry', onClick: failed?.uncertain ? async () => { await refresh(); setModal(null) } : retryNow }, failed?.uncertain ? S.recheck : S.retry)]
      }
      return [
        h('div', { className: 'mh', key: 'h' }, h('h2', null, title), h('p', null, S.doneSub(done.length, todo.length))),
        h('div', { className: 'mb', key: 'b' }, head, run.rows.map(Row), extra),
        h('div', { className: 'mf', key: 'f' }, acts),
      ]
    }
    const Migrate = () => {
      const { x, phase, step, result } = modal
      const steps = x.provided ? ['disable-old', 'remove-old'] : ['inspect', 'install', 'disable-old', 'enable', 'remove-old']
      if (phase === 'run') return [h('div', { className: 'mh', key: 'h' }, h('h2', null, S.migrating), h('p', null, x.provided ? S.providedMigration : S.migrateOrder)),
        h('div', { className: 'mb', key: 'b' }, steps.map((s, i) => h('div', { className: 'row3', key: s }, h('div', { className: 'm' }, h('b', null, `${i + 1}. ${s}`)), steps.indexOf(step) === i ? h('span', { className: 'stat' }, h('span', { className: 'spin' })) : steps.indexOf(step) > i ? h('span', { className: 'dotc ok' }, I.check(9)) : null)))]
      const ok = result.status === 'done', half = result.status === 'halfRemoved'
      return [h('div', { className: 'mh', key: 'h' }, h('h2', null, ok || half ? S.doneTitle : S.failTitle)),
        h('div', { className: 'mb', key: 'b' }, h('div', { className: 'res ' + (ok ? 'ok' : half ? 'warn' : 'err'), 'data-testid': 'mig-result', 'data-status': result.status }, ok ? I.ok() : half ? I.warn() : I.err(), h('div', null, h('b', null, ok ? S.migDone : half ? S.migHalf : result.restoredOld ? S.migRestored : result.failure?.kind === 'provided' ? S.providedBlockedT : S.fFailedT), h('span', null, !ok && !half && !result.restoredOld ? (result.failure?.kind === 'provided' ? S.providedBlockedB : result.failure?.diagnostic || '').slice(0, 300) : '')))),
        h('div', { className: 'mf', key: 'f' }, h('button', { className: 'btn primary big', onClick: () => setModal(null) }, S.gotIt))]
    }
    const UninstallResult = () => {
      const { p, result } = modal
      const f = result.failure || { kind: 'failed' }
      const [t, b] = failText(f)
      return [h('div', { className: 'mh', key: 'h' }, h('h2', null, result.status === 'halfRemoved' ? S.halfRemovedT : S.fFailedT)),
        h('div', { className: 'mb', key: 'b' }, h('div', { className: 'res warn', 'data-testid': 'half' }, I.warn(), h('div', null, h('b', null, result.status === 'halfRemoved' ? S.halfRemovedT : t), h('span', null, result.status === 'halfRemoved' ? S.halfRemovedB : b))),
          result.status === 'halfRemoved' && h('div', { className: 'res err' }, I.err(), h('div', null, h('b', null, t), h('span', null, b))), Row({ entry: p, st: 'err', sub: '' })),
        h('div', { className: 'mf', key: 'f' }, h('button', { className: 'btn', onClick: () => setModal(null) }, S.later),
          result.status === 'halfRemoved' && h('button', { className: 'btn', onClick: async () => { await toggle(p, true); setModal(null) } }, S.reenable),
          h('button', { className: 'btn primary big', onClick: async () => { setModal(null); await doUninstall(p) } }, S.retryUninstall))]
    }

    const modalBody = !modal ? null : modal.mode === 'confirm' ? Confirm() : modal.mode === 'run' ? Run() : modal.mode === 'result' ? Result() : modal.mode === 'migrate' ? Migrate() : UninstallResult()

    const counts = { inst: official.filter(isIn).length, upd: updates.length }
    return h('div', { className: 'vdc', ref: rootRef, 'data-testid': 'center', onClick: () => menu && setMenu(null) },
      h('style', null, CSS),
      h('header', { className: 'top' },
        h('div', { className: 'brand' }, h('div', { className: 'logo' }, I.logo()), h('h1', null, S.title), h('span', { className: 'pill' }, S.preview), host.version ? h('span', { className: 'pill', 'data-testid': 'version', title: S.title }, S.versionOf(host.version())) : null),
        h('nav', { className: 'tabs' }, [['all', S.tabAll, 0], ['installed', S.tabInstalled, counts.inst], ['updates', S.tabUpdates, counts.upd], ['community', S.tabCommunity, 0]].map(([k, t, c]) => h('button', { key: k, 'data-tab': k, className: 'tab ' + (view === k ? 'on' : ''), onClick: () => setView(k) }, t, c ? h('span', { className: 'n' }, c) : null))),
        h('span', { className: 'sp' }), host.checkLatest ? h('button', { className: 'ghost', 'data-testid': 'check-update', disabled: selfUpd?.kind === 'checking', onClick: checkSelf }, S.checkUpdate) : null, h('button', { className: 'ghost', onClick: () => setIntro(!intro) }, S.about)),
      h('div', { className: 'scroll' }, h('div', { className: 'wrap' },
        bundles === false && h('div', { className: 'banner', 'data-testid': 'no-manager' }, I.warn(), h('div', { className: 'grow' }, h('b', null, S.loadFail), h('small', null, host.pm ? S.loadFailB : S.noManager))),
        NoRefresh(), Banner(), SelfUpdate(), Main(),
        h('div', { className: 'foot' }, h('span', null, S.footMore, h('button', { className: 'lnk', onClick: () => (marketIn ? setView('community') : openInstall([MARKET], `${S.install} ${L(byId(MARKET).name, lang)}`)) }, marketIn ? S.openMarket.replace(' →', '') : S.installMarket.replace(' →', ''))),
          h('span', null, S.footFeedback, ' ', h('button', { className: 'lnk', onClick: () => host.openUrl?.('https://github.com/VibeDev-Si/dsh-ecosystem/issues') }, 'VibeDev-Si · GitHub')), h('span', null, S.footCatalog(catalog.updated))))),
      Drawer(),
      modal && [h('div', { className: 'mask mask2', key: 'mk' }), h('section', { className: 'modal', key: 'md', 'data-mode': modal.mode }, modalBody)])
  }
  return Center
}
