// The online catalogue, seen in a real Chrome: the panel lists what the live catalogue names, not only what
// this client was built with.
//
// These tests are the independent UI evidence for the online catalogue, and they are deliberately built on the
// public synthetic fixtures the bench already uses: nothing here reads a user profile, and every request the
// page makes goes to the local bench server (asserted). Each test drives the panel with a scripted
// /vdc/updates answer — a catalogue, its source, and the live versions — and checks what a user would see:
//
//   - a package the client has NO snapshot for appears as a card once the online catalogue names it;
//   - installing it asks for exactly `name@version`, installs its declared dependency first, uses the registry
//     the release was verified from, and installs nothing else;
//   - a catalogue that does not list the community market says so, and disables the ways to it;
//   - an illegal catalogue (a DSH-scoped name claiming to be official) is refused as a whole, so the panel
//     falls back to the snapshot and that package can never be planned;
//   - a catalogue that could not be refreshed says so, instead of claiming the online listing.
//
// Port 0 (no fixed port to fight over), no writes outside the screenshot directory, no product source touched.
import puppeteer from 'puppeteer-core'
import { mkdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startBench, state as benchState } from './bench-server.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const SHOTS = process.env.VDC_SHOTS ?? 'C:\\vdp-tools\\release\\ecology-018-review'
const results = []
const ok = (name, cond, extra = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const server = await startBench(0)
const ORIGIN = `http://127.0.0.1:${server.address().port}`
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run'], defaultViewport: { width: 1180, height: 900, deviceScaleFactor: 1.25 } })

const CATALOG = JSON.parse(readFileSync(join(here, '..', 'catalog', 'catalog.json'), 'utf8'))
const NM = (id) => CATALOG.plugins.find((p) => p.id === id).npm
const VER = (id) => CATALOG.plugins.find((p) => p.id === id).version
const VD = NM('@vibedev-si/dsh-vibedev')
const MV = NM('@vibedev-si/dsh-media-viewer')
const FILM = NM('dsh-film')
const MARKET = 'dshmarket'
const FUTURE = '@vibedev-si/future-tool'
const FUTURE_VERSION = '0.1.1'
const OFFICIAL = 'https://registry.npmjs.org/'
const SELF = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version
const FAST = { between: { quietMs: 20, maxMs: 200 }, final: { quietMs: 40, maxMs: 300 } }

/**
 * The catalogue entry this client has never shipped: the bundled account entry, renamed. Everything the shared
 * validator checks (official scope, VibeDev-Si repository, zh+en text, icon, cmd) therefore still holds, while
 * the identity, links, command and version are the new plugin's.
 */
const futureEntry = (over = {}) => {
  const base = CATALOG.plugins.find((p) => p.id === VD)
  const { legacyNames, partners, requires, ...rest } = base
  return {
    ...rest,
    id: FUTURE,
    npm: FUTURE,
    version: FUTURE_VERSION,
    name: { zh: '未来工具（在线目录）', en: 'Future Tool (online catalogue)' },
    tagline: { zh: '只在在线目录里存在的插件，用来验证目录独立于客户端版本', en: 'A plugin that exists only in the online catalogue, proving the catalogue is independent of the client build' },
    origin: 'official',
    updates: 'center',
    tags: ['official'],
    requires: [MV],
    links: { repo: 'https://github.com/VibeDev-Si/future-tool', npm: 'https://www.npmjs.com/package/@vibedev-si/future-tool' },
    cmd: `dsh plugin add ${FUTURE}`,
    icon: { glyph: { zh: '未', en: 'FT' }, grad: ['#4d6bfe', '#8f6bff'] },
    compat: undefined,
    ...over,
  }
}

/** A catalogue as the online source would answer it: the shipped one, with `patch` applied to its entries. */
const catalogWith = (patch) => {
  const catalog = JSON.parse(JSON.stringify(CATALOG))
  patch(catalog.plugins, catalog)
  return catalog
}
const withoutMarket = () => catalogWith((plugins) => { plugins.splice(plugins.findIndex((p) => p.id === MARKET), 1) })
const withFuture = () => catalogWith((plugins) => { plugins.push(futureEntry()) })

/** One live row per package. `version` is what npm would say for it. */
const liveRow = (npm, version, registry = OFFICIAL, over = {}) => ({ name: npm, ok: true, version, publishedAt: '2026-01-01T00:00:00.000Z', registry, sizeKB: 120, sources: [], ...over })
/** The whole /vdc/updates body, as the host half answers it. */
const answer = ({ catalog = CATALOG, source = 'online', error, plugins, self, ok: okFlag = true } = {}) => ({
  ok: okFlag, partial: false, checkedAt: '2026-10-07T00:00:00.000Z',
  ...(catalog === undefined ? {} : { catalog }),
  catalogSource: source, catalogCheckedAt: '2026-10-07T00:00:00.000Z',
  ...(error === undefined ? {} : { catalogError: error }),
  plugins: plugins ?? [liveRow(VD, VER('@vibedev-si/dsh-vibedev')), liveRow(FILM, VER(FILM)), liveRow(MV, VER(MV))],
  self: self ?? { ok: true, latest: SELF, publishedAt: '2026-01-01T00:00:00.000Z', registry: OFFICIAL, sources: [] },
})

async function boot({ initial = [], scenarios = {}, locale = 'zh', dark = false, settle = FAST } = {}) {
  const page = await browser.newPage()
  const errs = []
  const outside = []
  page.on('pageerror', (e) => errs.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()) })
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon\.ico/.test(r.url())) errs.push(`HTTP ${r.status()} ${r.url()}`) })
  // No real network: every request the page makes has to go to this local bench.
  page.on('request', (r) => { if (!r.url().startsWith(ORIGIN) && !r.url().startsWith('data:')) outside.push(r.url()) })
  await page.goto(ORIGIN + '/')
  if (dark) await page.evaluate(() => { const s = document.documentElement.style; const v = { '--dsw-alias-bg-base': '#16171b', '--dsw-alias-bg-layer-1': '#1e1f25', '--dsw-alias-bg-layer-2': '#272830', '--dsw-alias-bg-overlay': '#2a2b33', '--dsw-alias-border-l1': 'rgba(255,255,255,.09)', '--dsw-alias-border-l2': 'rgba(255,255,255,.18)', '--dsw-alias-brand-primary': '#6f87ff', '--dsw-alias-label-primary': '#ececf2', '--dsw-alias-label-secondary': '#9b9fae' }; for (const k in v) s.setProperty(k, v[k]); document.body.style.background = '#16171b' })
  await page.evaluate(async (initial, scenarios, locale, settle) => {
    const { createFakePm } = await import('/fake-pm.js')
    window.__pm = createFakePm(initial, scenarios, {})
    window.setup({ locale, settle }); window.mountPanel()
  }, initial, scenarios, locale, settle)
  await page.waitForSelector('[data-testid=center]')
  // The panel asks for the catalogue when it mounts. Its status line lives in the Updates tab, so look there
  // until the answer has been applied, then come back: every assertion below then sees the settled UI.
  await click(page, '[data-tab=updates]')
  await page.waitForFunction(() => { const el = document.querySelector('[data-testid=release-status]'); return el && el.dataset.state !== 'checking' }, { timeout: 8000 })
  await click(page, '[data-tab=all]')
  await sleep(120)
  return { page, errs, outside }
}

const click = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) throw new Error('no element: ' + s); el.click() }, sel)
const clickText = (page, t, scope = '') => page.evaluate((x, sc) => { const b = [...document.querySelectorAll(`${sc} button`)].find((n) => n.textContent.includes(x)); if (!b) throw new Error('no button: ' + x); b.click() }, t, scope)
const text = (page) => page.evaluate(() => document.body.innerText)
const footer = (page) => page.evaluate(() => document.querySelector('.vdc .foot')?.innerText ?? '')
const calls = (page) => page.evaluate(() => window.__pm.calls.map((c) => [c[0], c[1], c[2]]))
const shot = async (page, file) => { await page.screenshot({ path: join(SHOTS, file) }) }

mkdirSync(SHOTS, { recursive: true })

try {
  // 1 ── a plugin only the online catalogue knows about
  {
    benchState.updates = answer({ catalog: withFuture(), plugins: [liveRow(VD, VER('@vibedev-si/dsh-vibedev')), liveRow(FILM, VER(FILM)), liveRow(MV, VER(MV)), liveRow(FUTURE, FUTURE_VERSION)] })
    const { page, errs, outside } = await boot({ initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    const card = await page.$(`.card[data-id="${FUTURE}"]`)
    ok('a package the client has no snapshot for becomes a card', !!card)
    ok('the client really had no entry for it (the bundled catalogue is the control)', !CATALOG.plugins.some((p) => p.npm === FUTURE))
    const cardText = card ? await card.evaluate((el) => el.innerText) : ''
    ok('the card explains what the online catalogue said about it', cardText.includes('未来工具') && cardText.includes(FUTURE), cardText.split('\n')[0])
    ok('the footer names the online listing as the source', (await footer(page)).includes('在线收录目录'), await footer(page))
    ok('nothing outside the local bench was requested', outside.length === 0, outside.join(' '))
    ok('no page errors', errs.length === 0, errs.join('; '))
    await page.close()
  }

  // 2 ── installing it: the exact spec, the dependency first, the verified registry, nothing else
  {
    benchState.updates = answer({ catalog: withFuture(), plugins: [liveRow(VD, VER('@vibedev-si/dsh-vibedev')), liveRow(FILM, VER(FILM)), liveRow(MV, VER(MV)), liveRow(FUTURE, FUTURE_VERSION)] })
    const { page, errs, outside } = await boot({ initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    await click(page, `.card[data-id="${FUTURE}"] .btn.primary`)
    await page.waitForSelector('[data-testid=confirm]')
    const confirm = await text(page)
    ok('the confirm names the new package and the live version it will install', confirm.includes('未来工具') && confirm.includes(FUTURE_VERSION), confirm.replace(/\n/g, ' | ').slice(-200))
    const steps = await page.evaluate(() => [...document.querySelectorAll('.log')].map((el) => el.textContent).join('\n'))
    ok('...and plans the declared dependency BEFORE it', steps.indexOf(`${MV}@`) >= 0 && steps.indexOf(`${MV}@`) < steps.indexOf(`${FUTURE}@${FUTURE_VERSION}`), steps.replace(/\n/g, ' | ').slice(0, 200))
    ok('...and plans nothing else (no other official plugin is dragged in)', !steps.includes(`${VD}@`) && !steps.includes(`${FILM}@`), steps.replace(/\n/g, ' | ').slice(0, 200))
    await click(page, '[data-testid=confirm]')
    await page.waitForFunction(() => /安装完成|安装未完成/.test(document.body.innerText), { timeout: 15000 })
    const c = await calls(page)
    const installs = c.filter((x) => x[0] === 'installBundle')
    ok('the host receives both installs, dependency first, in the planned order', installs.map((x) => x[1]).join(' , ') === [`${MV}@${VER('@vibedev-si/dsh-media-viewer')}`, `${FUTURE}@${FUTURE_VERSION}`].join(' , '), installs.map((x) => x[1]).join(' , '))
    // The registry split, as designed: a package only the online catalogue knows (or a target newer than the
    // snapshot, or an update) installs from the registry its release was verified from; a package the client
    // already knew, at the version it already shipped, keeps the host's own registry choice.
    const registryOf = (spec) => installs.find((x) => x[1] === spec)?.[2]?.registry
    ok('the online-only package installs from the registry its release was verified from', registryOf(`${FUTURE}@${FUTURE_VERSION}`) === OFFICIAL, String(registryOf(`${FUTURE}@${FUTURE_VERSION}`)))
    ok('a package the client already ships keeps the host\'s registry choice (here the probe default)', registryOf(`${MV}@${VER('@vibedev-si/dsh-media-viewer')}`) === 'https://registry.npmmirror.com/', String(registryOf(`${MV}@${VER('@vibedev-si/dsh-media-viewer')}`)))
    ok('no other package was installed, removed or toggled', !c.some((x) => [VD, FILM, MARKET].includes(x[1]) && ['installBundle', 'removeBundle', 'setBundleEnabled'].includes(x[0])), c.map((x) => x[0] + ':' + x[1]).join(' '))
    ok('nothing outside the local bench was requested', outside.length === 0, outside.join(' '))
    ok('no page errors', errs.length === 0, errs.join('; '))
    await page.close()
  }

  // 3 ── a catalogue that does not list the community market
  {
    benchState.updates = answer({ catalog: withoutMarket() })
    const { page, errs } = await boot({ initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    ok('the market is gone from the list when the catalogue does not name it', !(await page.$(`.card[data-id="${MARKET}"]`)))
    const footerButton = await page.evaluate(() => { const b = [...document.querySelectorAll('.vdc .foot button')].find((x) => x.textContent.includes('市场')); return b ? { disabled: b.disabled, text: b.textContent } : null })
    ok('the footer keeps the way to it visible but refuses to offer it', !!footerButton && footerButton.disabled === true, JSON.stringify(footerButton))
    await clickText(page, '关于 VibeDev 生态'); await sleep(120)
    const introButton = await page.evaluate(() => { const b = [...document.querySelectorAll('.vdc button')].find((x) => x.textContent.includes('安装插件市场') || x.textContent.includes('打开插件市场')); return b ? { disabled: b.disabled, text: b.textContent } : null })
    ok('the intro offers it too, also disabled', !!introButton && introButton.disabled === true, JSON.stringify(introButton))
    await click(page, '[data-tab=community]')
    await sleep(120)
    const unlisted = await page.$eval('[data-testid=market-unlisted]', (el) => el.innerText).catch(() => null)
    ok('the community tab says the catalogue does not include it', !!unlisted && unlisted.includes('未收录'), String(unlisted))
    ok('no page errors', errs.length === 0, errs.join('; '))
    await page.close()
  }

  // 4 ── an illegal catalogue is refused as a whole, and nothing in it can be planned
  {
    const illegal = catalogWith((plugins) => {
      plugins.push(futureEntry())
      plugins.push({ ...futureEntry(), id: '@deepseek-ai/dsh-plugin-x', npm: '@deepseek-ai/dsh-plugin-x', name: { zh: '冒充官方', en: 'Impersonating official' }, links: { repo: 'https://github.com/Somone/dsh-plugin-x', npm: 'https://www.npmjs.com/package/@deepseek-ai/dsh-plugin-x' }, cmd: 'dsh plugin add @deepseek-ai/dsh-plugin-x' })
    })
    benchState.updates = answer({ catalog: illegal, plugins: [liveRow(VD, VER('@vibedev-si/dsh-vibedev')), liveRow(FILM, VER(FILM)), liveRow(MV, VER(MV)), liveRow(FUTURE, FUTURE_VERSION), liveRow('@deepseek-ai/dsh-plugin-x', '9.9.9')] })
    const { page, errs } = await boot({ initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    ok('the impersonating entry never becomes a card', !(await page.$('.card[data-id="@deepseek-ai/dsh-plugin-x"]')))
    ok('...and neither does the valid entry that travelled with it: the catalogue was refused as a whole', !(await page.$(`.card[data-id="${FUTURE}"]`)))
    ok('the snapshot is what is shown (its own date is in the footer)', (await footer(page)).includes(CATALOG.updated), await footer(page))
    ok('a refused online catalog is never labelled as the online listing', !(await footer(page)).includes('在线收录目录') && (await footer(page)).includes('在线目录未能刷新'), await footer(page))
    ok('the three official plugins are still listed from the snapshot', (await page.evaluate((ids) => ids.every((id) => !!document.querySelector(`.card[data-id="${id}"]`)), [VD, FILM, MV])))
    ok('no install can be built for the refused package', (await calls(page)).every((x) => x[1] !== FUTURE && x[1] !== '@deepseek-ai/dsh-plugin-x'))
    ok('no page errors', errs.length === 0, errs.join('; '))
    await page.close()
  }

  // 5 ── the catalogue could not be refreshed, while the versions answered
  {
    benchState.updates = answer({ catalog: CATALOG, source: 'bundled', error: 'HTTP 503', plugins: [liveRow(VD, VER('@vibedev-si/dsh-vibedev')), liveRow(FILM, VER(FILM)), liveRow(MV, VER(MV))] })
    const { page, errs } = await boot({ initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    const f = await footer(page)
    ok('the footer says the online catalogue could not be refreshed', f.includes('在线目录未能刷新'), f)
    ok('...and never claims the online listing', !f.includes('在线收录目录'), f)
    ok('the confirmed versions are still shown', (await page.evaluate((ids) => ids.every((id) => !!document.querySelector(`.card[data-id="${id}"]`)), [VD, FILM, MV])))
    ok('no page errors', errs.length === 0, errs.join('; '))
    await page.close()
  }

  // 6 ── a catalogue that carries no suites still lists its plugins, with no suite offered
  for (const [how, patch] of [['suites: []', (catalog) => { catalog.suites = [] }], ['no suites key at all', (catalog) => { delete catalog.suites }]]) {
    benchState.updates = answer({ catalog: catalogWith((plugins, catalog) => { plugins.push(futureEntry()); patch(catalog) }), plugins: [liveRow(VD, VER('@vibedev-si/dsh-vibedev')), liveRow(FILM, VER(FILM)), liveRow(MV, VER(MV)), liveRow(FUTURE, FUTURE_VERSION)] })
    const { page, errs } = await boot({ initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    ok(`a catalogue with ${how}: its plugins are still listed`, !!(await page.$(`.card[data-id="${FUTURE}"]`)))
    ok(`a catalogue with ${how}: no suite is offered (there is nothing to offer)`, !(await text(page)).includes('一键安装套装'))
    ok(`a catalogue with ${how}: no page errors`, errs.length === 0, errs.join('; '))
    await page.close()
  }

  // 7 ── a catalogue whose text field is not text is refused as a whole
  {
    const bad = catalogWith((plugins) => { plugins.push(futureEntry({ sizeNote: { zh: { nested: true }, en: 'Approx 12 MB' } })) })
    benchState.updates = answer({ catalog: bad, plugins: [liveRow(VD, VER('@vibedev-si/dsh-vibedev')), liveRow(FILM, VER(FILM)), liveRow(MV, VER(MV)), liveRow(FUTURE, FUTURE_VERSION)] })
    const { page, errs } = await boot({ initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    ok('an entry whose size note is not text never becomes a card', !(await page.$(`.card[data-id="${FUTURE}"]`)))
    ok('...and the three snapshot cards are still there', (await page.evaluate((ids) => ids.every((id) => !!document.querySelector(`.card[data-id="${id}"]`)), [VD, FILM, MV])))
    ok('...with nothing broken in the list (no page errors)', errs.length === 0, errs.join('; '))
    await page.close()
  }

  // 8 ── the screenshots: the whole plugin list, both themes, from the online catalogue
  {
    for (const [theme, file] of [['light', 'online-light.png'], ['dark', 'online-dark.png']]) {
      benchState.updates = answer({ catalog: withFuture(), plugins: [liveRow(VD, VER('@vibedev-si/dsh-vibedev')), liveRow(FILM, VER(FILM)), liveRow(MV, VER(MV)), liveRow(FUTURE, FUTURE_VERSION)] })
      const { page, errs } = await boot({ initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }], dark: theme === 'dark' })
      await sleep(400)
      await shot(page, file)
      // Only the bench's synthetic names are on screen: no workspace, profile or user data is involved.
      const body = await text(page)
      ok(`${theme} screenshot written and shows the online catalogue's plugin list`, body.includes('未来工具') && body.includes(VD), join(SHOTS, file))
      ok(`${theme} page has no errors`, errs.length === 0, errs.join('; '))
      await page.close()
    }
  }
} catch (e) {
  ok('test run completed without throwing', false, String(e && e.stack || e))
} finally {
  await browser.close(); server.close()
}
const bad = results.filter((x) => !x).length
console.log(`\n${results.length - bad}/${results.length} passed`)
process.exit(bad ? 1 : 0)
