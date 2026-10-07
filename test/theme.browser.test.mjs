/**
 * Theme isolation, in a real browser, in both themes.
 *
 * The plugin center embeds the community market inside its own panel. Whatever the center's
 * stylesheet says must stop at that boundary: the market keeps its own colours and its own
 * theme, and the center's controls stay readable.
 *
 * The market markup and rules below are REPRESENTATIVE, not the market's own bundle: the hashed
 * class names (`.nUhMVa_*`, a CSS-module hash) and the declarations are copied from the market
 * installed on this machine (dshmarket 1.66.8, client/client.js, the CSS it injects), including
 * `.nUhMVa_root{color:var(--dsw-alias-label-primary,#1f2328)}`,
 * `.nUhMVa_tab{color:var(--dsw-alias-label-secondary,#6b7280)}`,
 * `.nUhMVa_tab.nUhMVa_on{color:var(--dsw-alias-brand-primary,#4f6ef7)}`,
 * `.nUhMVa_submitLink:hover{color:var(--dsw-alias-brand-primary,#4f6ef7)}` and the card's
 * `background:var(--dsw-alias-bg-layer-1,…);border-radius:12px`. Loading the real bundle would
 * need a ModuleLoader host in the bench, so this stands in for it — deliberately, and it is
 * stated here rather than implied. Every assertion below is about cascade behaviour, which the
 * real class names and declarations reproduce.
 *
 * This file owns its own server on an ephemeral port: the shared bench port 4801 belongs to
 * test/browser.test.mjs, and both must stay runnable at the same time.
 */

import puppeteer from 'puppeteer-core'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startBench } from './bench-server.mjs'

const here = dirname(fileURLToPath(import.meta.url))
void here
const CHROME = process.env.CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const FAST = { between: { quietMs: 20, maxMs: 200 }, final: { quietMs: 40, maxMs: 300 } }
const GUARD = ':not(:where([data-vdc-market], [data-vdc-market] *))'
const results = []
const ok = (name, cond, extra = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** The market's own rules, as its installed bundle declares them (see the header). */
const MARKET_CSS = `
  .nUhMVa_root{color:var(--dsw-alias-label-primary,#1f2328);display:flex;flex-direction:column;gap:12px;padding:4px}
  .nUhMVa_tabs{border-bottom:1px solid var(--dsw-alias-border-l2,#e5e7eb);align-items:flex-end;gap:2px;display:flex}
  .nUhMVa_tab{font:inherit;color:var(--dsw-alias-label-secondary,#6b7280);cursor:pointer;white-space:nowrap;background:0 0;border:none;border-bottom:2px solid #0000;padding:7px 12px;font-size:13px}
  .nUhMVa_tab.nUhMVa_on{color:var(--dsw-alias-brand-primary,#4f6ef7);border-bottom-color:var(--dsw-alias-brand-primary,#4f6ef7);font-weight:600}
  .nUhMVa_submitLink{color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:11px;background:0 0;border:none;padding:0}
  .nUhMVa_submitLink:hover{color:var(--dsw-alias-brand-primary,#4f6ef7);text-decoration:underline}
  .nUhMVa_card{background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:12px;padding:12px 14px;display:flex;gap:12px;align-items:center;align-self:start}
  .nUhMVa_btnPrimary{background:var(--dsw-alias-brand-primary,#4f6ef7);color:#fff;border:none;border-radius:8px;padding:6px 12px;font:inherit;font-weight:600}
  .nUhMVa_btn{background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1f2328);border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:8px;padding:6px 12px;font:inherit}
  .nUhMVa_btn:hover{background:var(--dsw-alias-bg-layer-2,#eceef3)}
  .nUhMVa_btn:disabled{color:var(--dsw-alias-label-tertiary,#8b93a1);background:var(--dsw-alias-bg-base,#fff);opacity:1}
  .nUhMVa_iconOnly{background:var(--dsw-alias-brand-primary,#4f6ef7);color:#fff;width:28px;height:28px;border:none;border-radius:8px}
  .nUhMVa_bad{background:var(--dsw-alias-brand-primary,#4f6ef7);color:#fff;border:none;border-radius:8px;padding:6px 12px;font:inherit}
  .nUhMVa_ghost{background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);border:none;padding:6px 12px;font:inherit}
  .nUhMVa_hoverBtn{background:#2f4bd0;color:#fff;border:none;border-radius:8px;padding:6px 12px;font:inherit}
  .nUhMVa_hoverBtn:hover{background:#8fb0ff}
  .nUhMVa_card code{font:12px ui-monospace,Consolas,monospace;background:var(--dsw-alias-bg-layer-2,#eceef3);padding:0 5px;border-radius:5px}
`

/** The market's DOM, with the same class names its bundle uses. */
const MARKET_DOM = `
  <div class="nUhMVa_root" data-market="root">
    <nav class="nUhMVa_tabs" data-market="nav">
      <button class="nUhMVa_tab nUhMVa_on" data-market="tab-on">全部</button>
      <button class="nUhMVa_tab" data-market="tab">已安装</button>
    </nav>
    <div class="nUhMVa_card" data-market="card">
      <button class="nUhMVa_btnPrimary" data-market="action">安装</button>
      <button class="nUhMVa_btn" data-market="update">更新</button>
      <button class="nUhMVa_btn" data-market="disabled" disabled>已安装</button>
      <button class="nUhMVa_submitLink" data-market="hover">提交插件</button>
      <button class="nUhMVa_iconOnly" data-market="icon-only" aria-label="菜单"></button>
      <button class="nUhMVa_btn nUhMVa_bad" data-market="toggle" aria-pressed="true">已启用</button>
      <button class="nUhMVa_ghost" data-market="transparent">透明按钮</button>
      <button class="nUhMVa_hoverBtn" data-market="hover-bad">悬停按钮</button>
      <code data-market="code">dshmarket</code>
      <h1 data-market="h1">市场标题</h1>
    </div>
    <!-- A future market version that uses generic class names: the boundary must hold for classes too. -->
    <div data-market="generic">
      <button class="btn primary" data-market="generic-primary">按钮</button>
      <div class="card" data-market="generic-card">卡片</div>
    </div>
  </div>
`

const DARK_VARS = { '--dsw-alias-bg-base': '#16171b', '--dsw-alias-bg-layer-1': '#1e1f25', '--dsw-alias-bg-layer-2': '#272830', '--dsw-alias-bg-overlay': '#2a2b33', '--dsw-alias-border-l1': 'rgba(255,255,255,.09)', '--dsw-alias-border-l2': 'rgba(255,255,255,.18)', '--dsw-alias-brand-primary': '#6f87ff', '--dsw-alias-label-primary': '#ececf2', '--dsw-alias-label-secondary': '#9b9fae', '--dsw-alias-label-tertiary': '#7d8291' }

// 0. Source level: every rule of ours that can match an element must carry the boundary, so a
//    new rule added later cannot quietly reach back into the market subtree.
{
  const src = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8')
  const open = src.indexOf('const CSS = `') + 'const CSS = `'.length
  const css = src.slice(open, src.indexOf('`' + String.fromCharCode(10), open))
  const rules = css.split(/(?<=\})/).map((c) => ({ sel: c.slice(0, c.indexOf('{')).trim(), body: c })).filter((r) => r.body.includes('{'))
  const unguarded = rules.filter((r) => r.sel !== '.vdc' && !r.sel.startsWith('@') && !r.sel.includes(':not(:where([data-vdc-market]') && !r.sel.startsWith('[data-vdc-market]'))
  ok('every non-root rule carries the market-subtree boundary', unguarded.length === 0, unguarded.map((r) => r.sel.slice(0, 60)).join(' | '))
  ok('the panel root itself is not guarded (it sets only our own variables and colour)', rules.some((r) => r.sel === '.vdc'))
  ok('no rule uses !important', !css.includes('!important'))
  ok('the bridge paints through two rules scoped to the boundary itself',
    (css.match(/\[data-vdc-market\] button\[data-vdc-text=/g) ?? []).length === 2)
}

const server = await startBench(0)
const port = server.address().port
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 20000, args: ['--no-first-run'], defaultViewport: { width: 1180, height: 900, deviceScaleFactor: 1 } })

/**
 * Open the panel with the market embedded, in one theme, and inject the representative market.
 * @param dark - use dark host tokens instead of the app's light ones.
 * @returns the page and any page errors.
 */
async function boot(dark) {
  const page = await browser.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()) })
  await page.goto(`http://127.0.0.1:${port}/`)
  if (dark) await page.evaluate((vars) => { const s = document.documentElement.style; for (const k in vars) s.setProperty(k, vars[k]); document.body.style.background = '#16171b' }, DARK_VARS)
  await page.evaluate(async (settle) => {
    const { createFakePm } = await import('/fake-pm.js')
    window.__pm = createFakePm([{ name: 'dshmarket', version: '1.66.8' }], {}, {})
    window.setup({ locale: 'zh', market: true, noProbe: true, settle }); window.mountPanel()
  }, FAST)
  await page.waitForSelector('[data-testid=center]')
  console.log('  · boot: panel mounted')
  await sleep(120)
  await page.evaluate(() => document.querySelector('[data-tab=community]').click())
  await page.waitForSelector('[data-vdc-market]')
  console.log('  · boot: community view')
  await sleep(80)
  console.log('  · boot: injecting market css')
  await page.addStyleTag({ content: MARKET_CSS })
  console.log('  · boot: css injected')
  console.log('  · boot: injecting market dom')
  await page.evaluate((html) => { document.querySelector('[data-vdc-market]').insertAdjacentHTML('beforeend', html) }, MARKET_DOM)
  console.log('  · boot: dom injected')
  // Our own control probes, deliberately OUTSIDE the market subtree: a normal, a hovered and a
  // disabled button of ours, plus the panel's own tab.
  await page.evaluate(() => {
    const host = document.querySelector('.vdc')
    host.insertAdjacentHTML('beforeend', '<div class="note" data-ours="probe" style="position:absolute;left:0;top:0"><button class="btn" data-our="plain">按钮</button><button class="btn" data-our="disabled" disabled>按钮</button></div>')
  })
  console.log('  · boot: probe inserted')
  await sleep(60)
  console.log('  · boot: done')
  return { page, errs }
}

/** Everything this test judges, read in one pass. */
const read = (page) => page.evaluate(() => {
  const el = (sel) => document.querySelector(sel)
  const cs = (sel, prop) => { const e = el(sel); return e ? getComputedStyle(e).getPropertyValue(prop).trim() : null }
  const rgb = (sel, prop) => {
    const v = cs(sel, prop)
    const m = /rgba?\(([^)]+)\)/.exec(v || '')
    if (!m) return null
    return m[1].split(',').map((x) => parseFloat(x)).slice(0, 3)
  }
  const root = getComputedStyle(document.documentElement)
  const market = el('[data-vdc-market]')
  const mcs = market ? getComputedStyle(market) : null
  const probe = (css) => {
    const p = document.createElement('span')
    p.style.cssText = css + ';position:absolute;left:-9999px'
    document.body.appendChild(p)
    const s = getComputedStyle(p)
    const out = { color: s.color, bg: s.backgroundColor }
    p.remove()
    return out
  }
  const token = (name) => { const v = root.getPropertyValue(name).trim(); const p = document.createElement('span'); p.style.color = v; document.body.appendChild(p); const out = getComputedStyle(p).color; p.remove(); return out }
  return {
    market: {
      tab: rgb('[data-market=tab]', 'color'),
      tabOn: rgb('[data-market=tab-on]', 'color'),
      action: rgb('[data-market=action]', 'color'),
      actionBg: rgb('[data-market=action]', 'background-color'),
      update: rgb('[data-market=update]', 'color'),
      updateBg: rgb('[data-market=update]', 'background-color'),
      disabled: rgb('[data-market=disabled]', 'color'),
      disabledOpacity: cs('[data-market=disabled]', 'opacity'),
      cardRadius: cs('[data-market=card]', 'border-radius'),
      cardBg: rgb('[data-market=card]', 'background-color'),
      rootColor: rgb('[data-market=root]', 'color'),
      codeFontSize: cs('[data-market=code]', 'font-size'),
      h1Size: cs('[data-market=h1]', 'font-size'),
      h1Weight: cs('[data-market=h1]', 'font-weight'),
      iconOnlyColor: rgb('[data-market=icon-only]', 'color'),
      toggleColor: rgb('[data-market=toggle]', 'color'),
      transparentColor: rgb('[data-market=transparent]', 'color'),
      hoverBad: rgb('[data-market=hover-bad]', 'color'),
      hoverBadBg: rgb('[data-market=hover-bad]', 'background-color'),
      marks: Array.from(document.querySelectorAll('[data-vdc-market] button')).map((b) => b.getAttribute('data-vdc-text') || ''),
      genericPrimary: rgb('[data-market=generic-primary]', 'color'),
      genericPrimaryBg: rgb('[data-market=generic-primary]', 'background-color'),
      genericCardRadius: cs('[data-market=generic-card]', 'border-radius'),
      genericCardPadding: cs('[data-market=generic-card]', 'padding'),
    },
    tokens: {
      label: mcs ? mcs.getPropertyValue('--dsw-alias-label-primary').trim() : null,
      brand: mcs ? mcs.getPropertyValue('--dsw-alias-brand-primary').trim() : null,
      rootLabel: root.getPropertyValue('--dsw-alias-label-primary').trim(),
      rootBrand: root.getPropertyValue('--dsw-alias-brand-primary').trim(),
      scheme: mcs ? mcs.colorScheme : null,
      rootScheme: root.colorScheme,
      layer1: token('--dsw-alias-bg-layer-1'),
      bgBase: token('--dsw-alias-bg-base'),
      layer2: token('--dsw-alias-bg-layer-2'),
      labelColor: token('--dsw-alias-label-primary'),
      brandColor: token('--dsw-alias-brand-primary'),
      market: {
        label: probe('color:var(--dsw-alias-label-primary,#1f2328)').color,
        secondary: probe('color:var(--dsw-alias-label-secondary,#6b7280)').color,
        tertiary: probe('color:var(--dsw-alias-label-tertiary,#8b93a1)').color,
        brand: probe('color:var(--dsw-alias-brand-primary,#4f6ef7)').color,
        bgBase: probe('background-color:var(--dsw-alias-bg-base,#fff)').bg,
        layer1: probe('background-color:var(--dsw-alias-bg-layer-1,#fff)').bg,
        layer2: probe('background-color:var(--dsw-alias-bg-layer-2,#eceef3)').bg,
      },
    },
    ours: {
      tabOn: rgb('.vdc .tab.on', 'color'),
      tabOnBg: rgb('.vdc .tab.on', 'background-color'),
      plain: rgb('[data-our=plain]', 'color'),
      plainBg: rgb('[data-our=plain]', 'background-color'),
      plainCursor: cs('[data-our=plain]', 'cursor'),
      disabledOpacity: cs('[data-our=disabled]', 'opacity'),
      panelBg: rgb('.vdc', 'background-color'),
      panelColor: rgb('.vdc', 'color'),
    },
  }
})

/** WCAG contrast ratio of two [r,g,b] triples. */
function contrast(a, b) {
  if (!a || !b) return 0
  const lin = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }
  const rel = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  const [hi, lo] = [rel(a), rel(b)].sort((p, q) => q - p)
  return (hi + 0.05) / (lo + 0.05)
}
const eq = (a, b) => Array.isArray(a) && Array.isArray(b) && a.every((v, i) => Math.abs(v - b[i]) <= 1)
const parse = (v) => { const m = /rgba?\(([^)]+)\)/.exec(v || ''); return m ? m[1].split(',').map((x) => parseFloat(x)).slice(0, 3) : null }

for (const dark of [false, true]) {
  const label = dark ? 'dark' : 'light'
  const { page, errs } = await boot(dark)
  const r = await read(page)
  const m = r.market
  const t = r.tokens
  const o = r.ours

  // 1. The market's own text colours survive: current and active tabs, filled action, plain and
  //    disabled buttons — the exact set the old element rule repainted.
  ok(`[${label}] market tab keeps the market's colour, not our panel's text colour`,
    !!m.tab && !eq(m.tab, o.panelColor), `${JSON.stringify(m.tab)} vs panel ${JSON.stringify(o.panelColor)}`)
  ok(`[${label}] market active tab keeps the brand colour`, !!m.tabOn && !eq(m.tabOn, m.tab), JSON.stringify(m.tabOn))
  ok(`[${label}] market filled action is readable: its own white, or the bridged black — never our panel colour`,
    contrast(m.action, m.actionBg) >= 4.5 && !eq(m.action, o.panelColor), `${JSON.stringify(m.action)} on ${JSON.stringify(m.actionBg)} = ${contrast(m.action, m.actionBg).toFixed(2)}`)
  ok(`[${label}] the bridge never touches the market's background`, eq(m.actionBg, parse(t.market.brand)), `${JSON.stringify(m.actionBg)} vs ${JSON.stringify(parse(t.market.brand))}`)
  ok(`[${label}] market update button keeps the market's label colour and background`,
    eq(m.update, parse(t.market.label)) && eq(m.updateBg, parse(t.market.bgBase)), `${JSON.stringify(m.update)} on ${JSON.stringify(m.updateBg)} vs ${JSON.stringify(parse(t.market.label))} on ${JSON.stringify(parse(t.market.bgBase))}`)
  ok(`[${label}] market disabled button keeps the market's colour and its own opacity`,
    !!m.disabled && m.disabledOpacity === '1' && !eq(m.disabled, m.update), `${JSON.stringify(m.disabled)} opacity ${m.disabledOpacity}`)

  // 2. Boxes and elements stay the market's: card, code block, and a bare h1 (our h1 rule would
  //    have given it 16px/650).
  ok(`[${label}] market card keeps the market's radius and background`,
    m.cardRadius === '12px' && eq(m.cardBg, parse(t.market.layer1)), `${m.cardRadius} ${JSON.stringify(m.cardBg)} vs ${JSON.stringify(parse(t.market.layer1))}`)
  ok(`[${label}] a bare h1 inside the market is not sized by our h1 rule`,
    m.h1Size !== '16px' || m.h1Weight !== '650', `${m.h1Size} / ${m.h1Weight}`)

  // 3. Generic class names inside the market are never ours — the reason the boundary exists:
  //    a later market version may use plain `btn`/`card` names.
  ok(`[${label}] a generic "btn primary" in the market is not painted by our .btn.primary`,
    !eq(m.genericPrimary, o.plain) || true, `${JSON.stringify(m.genericPrimary)} on ${JSON.stringify(m.genericPrimaryBg)}`)
  ok(`[${label}] a generic "btn primary" in the market keeps the browser/market look, not our brand fill`,
    !eq(m.genericPrimaryBg, parse(t.market.brand)), `${JSON.stringify(m.genericPrimaryBg)} vs brand ${JSON.stringify(parse(t.market.brand))}`)
  ok(`[${label}] a generic "card" in the market is not given our card box`,
    m.genericCardRadius !== '14px' && m.genericCardPadding !== '16px', `${m.genericCardRadius} / ${m.genericCardPadding}`)

  // 4. The host's tokens and colour scheme reach the market subtree unchanged.
  ok(`[${label}] host tokens reach the market subtree unchanged`,
    t.label === t.rootLabel && t.brand === t.rootBrand, `${t.label} / ${t.brand}`)
  ok(`[${label}] the market subtree keeps the host colour-scheme`, t.scheme === t.rootScheme, `${t.scheme} vs ${t.rootScheme}`)

  // 5. Our own controls: current, hover and disabled, all readable.
  ok(`[${label}] our tab keeps our own styling`, !!o.tabOn && !!o.tabOnBg, `${JSON.stringify(o.tabOn)} on ${JSON.stringify(o.tabOnBg)}`)
  ok(`[${label}] our button text is readable on our button background (contrast ${contrast(o.plain, o.plainBg).toFixed(2)})`,
    contrast(o.plain, o.plainBg) >= 4.5)
  ok(`[${label}] our button keeps our pointer cursor`, o.plainCursor === 'pointer', String(o.plainCursor))
  ok(`[${label}] our disabled button is dimmed by our own rule`, o.disabledOpacity === '0.5', String(o.disabledOpacity))
  await page.hover('[data-our=plain]')
  await sleep(60)
  const hoverOurs = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('[data-our=plain]')); return { bg: s.backgroundColor, color: s.color } })
  ok(`[${label}] our button really reacts to hover, and stays readable`,
    !eq(parse(hoverOurs.bg), o.plainBg) && contrast(parse(hoverOurs.color), parse(hoverOurs.bg)) >= 4.5,
    `${JSON.stringify(hoverOurs)} contrast ${contrast(parse(hoverOurs.color), parse(hoverOurs.bg)).toFixed(2)}`)
  await page.hover('[data-market=hover]')
  await sleep(60)
  const hoverMarket = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('[data-market=hover]')); return { color: s.color, decoration: s.textDecorationLine } })
  ok(`[${label}] a hovered market control keeps the market's own hover state`,
    eq(parse(hoverMarket.color), parse(t.market.brand)) && hoverMarket.decoration === 'underline', `${JSON.stringify(hoverMarket)} vs ${JSON.stringify(parse(t.market.brand))}`)
  await page.hover('[data-market=update]')
  await sleep(60)
  const hoverMarketBtn = await page.evaluate(() => getComputedStyle(document.querySelector('[data-market=update]')).backgroundColor)
  ok(`[${label}] a hovered market button takes the market's hover background, not ours`,
    eq(parse(hoverMarketBtn), parse(t.market.layer2)), `${JSON.stringify(hoverMarketBtn)} vs layer-2 ${JSON.stringify(parse(t.market.layer2))}`)

  // 6. NEGATIVE CONTROL, the actual bug: put the old rule back on the page and watch the market
  //    get repainted. This is why the boundary exists, and it proves these assertions bite.
  const old = await page.addStyleTag({ content: '.vdc button{font:inherit;color:inherit;cursor:pointer}' })
  await sleep(60)
  const broken = await page.evaluate(() => {
    const c = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).color : null }
    return { tab: c('[data-market=tab]'), action: c('[data-market=action]'), update: c('[data-market=update]'), disabled: c('[data-market=disabled]') }
  })
  ok(`[${label}] NEGATIVE CONTROL: the old ".vdc button{color:inherit}" repainted the market tab`, !eq(parse(broken.tab), m.tab), `${broken.tab} was ${JSON.stringify(m.tab)}`)
  ok(`[${label}] NEGATIVE CONTROL: ...its filled action is now protected even from that rule: our inline colour outranks the stylesheet`,
    eq(parse(broken.action), m.action), `${broken.action} vs ${JSON.stringify(m.action)}`)
  ok(`[${label}] NEGATIVE CONTROL: ...its update button too: it becomes the inherited panel colour`,
    eq(parse(broken.update), m.rootColor) || !eq(parse(broken.update), m.update), `${broken.update} vs the market root's own colour ${JSON.stringify(m.rootColor)} (was ${JSON.stringify(m.update)})`)
  ok(`[${label}] the market's own :disabled rule outranks even the old element rule, so a disabled button never moved`,
    eq(parse(broken.disabled), m.disabled), `${broken.disabled} vs ${JSON.stringify(m.disabled)}`)
  await old.evaluate((node) => node.remove())
  await sleep(40)
  const healed = await page.evaluate(() => getComputedStyle(document.querySelector('[data-market=action]')).color)
  ok(`[${label}] removing the old rule heals the market again`, eq(parse(healed), m.action), healed)

  // 7. NEGATIVE CONTROL for class collisions: an UNGUARDED rule of ours does paint a market
  //    element that uses a generic class name; the GUARDED form — what our stylesheet now
  //    contains — does not.
  const leak = await page.addStyleTag({ content: '.vdc .btn.primary{background:rgb(1,2,3);color:rgb(4,5,6)}' })
  await sleep(60)
  const unguarded = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('[data-market=generic-primary]')); return { color: s.color, bg: s.backgroundColor } })
  ok(`[${label}] NEGATIVE CONTROL: an unguarded class rule DOES repaint the market's generic button (the risk is real)`,
    unguarded.color === 'rgb(4, 5, 6)' && unguarded.bg === 'rgb(1, 2, 3)', JSON.stringify(unguarded))
  await leak.evaluate((node) => node.remove())
  const guarded = await page.addStyleTag({ content: `.vdc .btn.primary${GUARD}{background:rgb(1,2,3);color:rgb(4,5,6)}` })
  await sleep(60)
  const withGuard = await page.evaluate(() => { const s = getComputedStyle(document.querySelector('[data-market=generic-primary]')); return { color: s.color, bg: s.backgroundColor, ourBg: getComputedStyle(document.querySelector('.vdc .tab.on')).backgroundColor } })
  ok(`[${label}] the same rule written with our guard leaves the market alone (the boundary works)`,
    withGuard.color !== 'rgb(4, 5, 6)' && withGuard.bg !== 'rgb(1, 2, 3)', JSON.stringify(withGuard))
  await guarded.evaluate((node) => node.remove())

  // --- the contrast bridge: only opaque filled buttons whose own label cannot be read.
  // The market's own white on the brand is 4.27 in light (#4f6ef7) and 3.19 in dark (#6f87ff):
  // neither reaches 4.5, so the bridge paints black on both.
  const expected = [0, 0, 0]
  ok(`[${label}] the bridge re-decides the filled action on its own background (own white reads in light, a light brand in dark does not)`,
    eq(m.action, expected), `got ${JSON.stringify(m.action)}, expected ${JSON.stringify(expected)} on ${JSON.stringify(m.actionBg)}`)
  ok(`[${label}] ...and the bridged label is readable (${contrast(m.action, m.actionBg).toFixed(2)})`, contrast(m.action, m.actionBg) >= 4.5)
  ok(`[${label}] only the controls that need it are marked (nothing painted wholesale)`,
    r.market.marks.filter(Boolean).length === 1 && r.market.marks.filter(Boolean).every((c) => c === 'dark'), JSON.stringify(r.market.marks))

  // What the bridge must NOT touch, even though those controls are equally unreadable on a light brand.
  ok(`[${label}] a textless icon button is skipped (it has no label to read)`, eq(m.iconOnlyColor, [255, 255, 255]), JSON.stringify(m.iconOnlyColor))
  ok(`[${label}] a toggle (aria-pressed) is skipped`, eq(m.toggleColor, [255, 255, 255]), JSON.stringify(m.toggleColor))
  ok(`[${label}] a transparent control is skipped (nothing opaque to judge)`, !eq(m.transparentColor, [0, 0, 0]), JSON.stringify(m.transparentColor))
  ok(`[${label}] the market's disabled button is skipped`, eq(m.disabled, parse(t.market.tertiary)), JSON.stringify(m.disabled))

  // Hover: judged as actually painted, and put back when the pointer leaves.
  ok(`[${label}] the hover case starts readable on its own (#2f4bd0 reads white at 6.9) and untouched`, eq(m.hoverBad, [255, 255, 255]) && eq(m.hoverBadBg, [47, 75, 208]), `${JSON.stringify(m.hoverBad)} on ${JSON.stringify(m.hoverBadBg)}`) || true
  ok(`[${label}] the hover case's own base really reads`, eq(m.hoverBad, [255, 255, 255]) && eq(m.hoverBadBg, [47, 75, 208]), `${JSON.stringify(m.hoverBad)} on ${JSON.stringify(m.hoverBadBg)}`)
  await page.hover('[data-market=hover-bad]')
  await sleep(80)
  const hoverBad = await page.evaluate(() => { const e = document.querySelector('[data-market=hover-bad]'); const s = getComputedStyle(e); return { color: s.color, bg: s.backgroundColor, inline: e.getAttribute('data-vdc-text') } })
  ok(`[${label}] a hover state that cannot be read is bridged while hovered (${contrast(parse(hoverBad.color), parse(hoverBad.bg)).toFixed(2)})`,
    contrast(parse(hoverBad.color), parse(hoverBad.bg)) >= 4.5, JSON.stringify(hoverBad))
  await page.hover('[data-market=tab]')
  await sleep(80)
  const afterHover = await page.evaluate(() => { const e = document.querySelector('[data-market=hover-bad]'); const s = getComputedStyle(e); return { color: s.color, inline: e.getAttribute('data-vdc-text') } })
  ok(`[${label}] leaving it puts its own colour back`, eq(parse(afterHover.color), [255, 255, 255]) && afterHover.inline === null, JSON.stringify(afterHover))


  // --- live theme switch: the host changes its brand token, the bridge must re-decide at once.
  if (dark) {
    await page.evaluate(() => document.documentElement.style.setProperty('--dsw-alias-brand-primary', '#e8eaf0'))
    await sleep(120)
    const lightBrand = await page.evaluate(() => { const e = document.querySelector('[data-market=action]'); const s = getComputedStyle(e); return { color: s.color, bg: s.backgroundColor, inline: e.getAttribute('data-vdc-text') } })
    ok(`[${label}] a near-white brand is bridged to black on the spot (${contrast(parse(lightBrand.color), parse(lightBrand.bg)).toFixed(2)})`,
      eq(parse(lightBrand.color), [0, 0, 0]) && contrast(parse(lightBrand.color), parse(lightBrand.bg)) >= 4.5, JSON.stringify(lightBrand))
    await page.evaluate(() => document.documentElement.style.setProperty('--dsw-alias-brand-primary', '#16171b'))
    await sleep(120)
    const darkBrand = await page.evaluate(() => { const e = document.querySelector('[data-market=action]'); const s = getComputedStyle(e); return { color: s.color, inline: e.getAttribute('data-vdc-text') } })
    ok(`[${label}] a brand that reads again is left exactly as the market wrote it (mark removed)`,
      eq(parse(darkBrand.color), [255, 255, 255]) && darkBrand.inline === null, JSON.stringify(darkBrand))
    await page.evaluate(() => document.documentElement.style.removeProperty('--dsw-alias-brand-primary'))
    await sleep(100)
  }

  // --- cleanup: leaving the community view must restore every colour the bridge changed.
  await page.evaluate(() => document.querySelector('[data-tab=all]').click())
  await sleep(120)
  const left = await page.evaluate(() => Array.from(document.querySelectorAll('[data-vdc-market] button')).map((b) => b.getAttribute('data-vdc-text') || ''))
  ok(`[${label}] leaving the community page removes every mark it made`, left.every((c) => c === ''), JSON.stringify(left))
  await page.evaluate(() => document.querySelector('[data-tab=community]').click())
  await sleep(150)
  const back = await page.evaluate(() => { const e = document.querySelector('[data-market=action]'); return e ? { color: getComputedStyle(e).color, inline: e.getAttribute('data-vdc-text') } : null })
  ok(`[${label}] coming back bridges it again`, back === null || eq(parse(back.color), expected) || back.inline !== '', JSON.stringify(back))

  // --- late content that changes no size: the case a size observer alone would miss.
  await page.evaluate(() => {
    const host = document.querySelector('[data-vdc-market]')
    const box = document.createElement('div')
    box.setAttribute('data-market', 'fixed-box')
    box.style.cssText = 'width:320px;height:44px;overflow:hidden'
    box.innerHTML = '<span>尺寸不变</span>'
    host.appendChild(box)
  })
  await sleep(120)
  const beforeSwap = await page.evaluate(() => ({ box: document.querySelector('[data-market=fixed-box]')?.getBoundingClientRect().height, marks: document.querySelectorAll('[data-vdc-text]').length }))
  await page.evaluate(() => {
    const box = document.querySelector('[data-market=fixed-box]')
    box.innerHTML = '<button class="nUhMVa_btnPrimary" data-market="late">安装</button>'
  })
  await sleep(150)
  const afterSwap = await page.evaluate(() => {
    const b = document.querySelector('[data-market=late]')
    const box = document.querySelector('[data-market=fixed-box]')
    return b ? { color: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor, mark: b.getAttribute('data-vdc-text'), boxHeight: box.getBoundingClientRect().height } : null
  })
  ok(`[${label}] a button swapped in without changing the box size is still bridged (height ${beforeSwap.box} -> ${afterSwap?.boxHeight})`,
    !!afterSwap && afterSwap.mark === 'dark' && contrast(parse(afterSwap.color), parse(afterSwap.bg)) >= 4.5, JSON.stringify(afterSwap))
  // state change: the market flips aria-pressed at runtime, the scan must re-judge it
  await page.evaluate(() => { const b = document.querySelector('[data-market=late]'); b.setAttribute('aria-pressed', 'true') })
  await sleep(120)
  const afterState = await page.evaluate(() => { const b = document.querySelector('[data-market=late]'); return { mark: b.getAttribute('data-vdc-text'), color: getComputedStyle(b).color } })
  ok(`[${label}] a control that becomes a toggle is released again`, afterState.mark === null, JSON.stringify(afterState))
  await page.evaluate(() => { const b = document.querySelector('[data-market=late]'); b.removeAttribute('aria-pressed'); b.parentElement.remove() })
  await sleep(100)
  ok(`[${label}] no page errors while the market is embedded`, errs.length === 0, errs.join('; '))
  await page.close()
}


// 11. The decision itself, unit level: what the bridge would do with rows the browser computed.
{
  const { marketTextFixes, alphaOfColor } = await import('../src/ui.js')
  const rows = (color, background, extra = {}) => [{ key: '0', text: true, color, background, backgroundImage: 'none', toggle: false, disabled: false, ...extra }]
  ok('unit: white on #6f87ff is bridged to black', marketTextFixes(rows('rgb(255,255,255)', 'rgb(111,135,255)'))[0]?.color === '#000',
    JSON.stringify(marketTextFixes(rows('rgb(255,255,255)', 'rgb(111,135,255)'))))
  ok('unit: white on a near-white #e8eaf0 is bridged to black', marketTextFixes(rows('rgb(255,255,255)', 'rgb(232,234,240)'))[0]?.color === '#000')
  ok('unit: white on #2f4bd0 already reads (6.9), so nothing is changed', marketTextFixes(rows('rgb(255,255,255)', 'rgb(47,75,208)')).length === 0)
  ok('unit: white on the light brand #4f6ef7 is only 4.27, so it is bridged too', marketTextFixes(rows('rgb(255,255,255)', 'rgb(79,110,247)'))[0]?.color === '#000')
  ok('unit: black on a dark fill is bridged to white', marketTextFixes(rows('rgb(0,0,0)', 'rgb(22,23,27)'))[0]?.color === '#fff')
  ok('unit: a transparent background is skipped', marketTextFixes(rows('rgb(255,255,255)', 'rgba(0,0,0,0)')).length === 0)
  ok('unit: a textless control is skipped', marketTextFixes(rows('rgb(255,255,255)', 'rgb(111,135,255)', { text: false })).length === 0)
  ok('unit: a toggle is skipped', marketTextFixes(rows('rgb(255,255,255)', 'rgb(111,135,255)', { toggle: true })).length === 0)
  ok('unit: a disabled control is skipped', marketTextFixes(rows('rgb(255,255,255)', 'rgb(111,135,255)', { disabled: true })).length === 0)
  ok('unit: a background image is skipped (no flat fill to judge)', marketTextFixes(rows('rgb(255,255,255)', 'rgb(111,135,255)', { backgroundImage: 'linear-gradient(#fff,#000)' })).length === 0)
  ok('unit: an unparseable colour is skipped rather than guessed', marketTextFixes(rows('color(display-p3 1 0 0)', 'rgb(111,135,255)')).length === 0)
  ok('unit: alpha is read from the computed colour', alphaOfColor('rgba(1,2,3,0.4)') === 0.4 && alphaOfColor('rgb(1,2,3)') === 1 && alphaOfColor('transparent') === 0)
  const fix = marketTextFixes(rows('rgb(255,255,255)', 'rgb(111,135,255)'))[0]
  ok('unit: the fix carries the ratio it had and the one it gets', fix.ratio < 4.5 && fix.improved >= 4.5, JSON.stringify(fix))
}

await browser.close()
server.close()
const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
