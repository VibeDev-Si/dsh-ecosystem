// The live-release screen, in a real Chrome: /vdc/updates drives the Updates tab.
//
// What this file is for (the bug it pins): the panel's catalogue ships inside the package, so the tab used to be
// empty for anyone whose installed versions equalled the pins of the center they were running, while the pinned
// community market showed the real npm releases next to it. These tests drive the panel with a scripted
// /vdc/updates answer and check that a verified release becomes an update row (even when the bundled catalogue
// is older), that a mirror-only or failed answer never claims everything is current, that an app-supplied
// component is only ever offered as an app update, and that the center itself offers a copyable spec and never
// an install.
import puppeteer from 'puppeteer-core'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startBench, state as benchState } from './bench-server.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const results = []
const ok = (name, cond, extra = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Port 0: the OS picks a free port, so this file never fights another run for a fixed one.
const server = await startBench(0)
const ORIGIN = `http://127.0.0.1:${server.address().port}`
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run'], defaultViewport: { width: 1180, height: 860, deviceScaleFactor: 1.25 } })

const CATALOG = JSON.parse(readFileSync(join(here, '..', 'catalog', 'catalog.json'), 'utf8'))
const SELF = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version
const entry = (id) => CATALOG.plugins.find((p) => p.id === id)
const ver = (id) => entry(id).version
const VD = '@vibedev-si/dsh-vibedev'
const MV = '@vibedev-si/dsh-media-viewer'
const FILM = 'dsh-film'
const CENTER_MANAGED = CATALOG.plugins.filter((p) => p.origin === 'official' && p.updates === 'center').map((p) => p.npm)

const OFFICIAL = 'https://registry.npmjs.org/'
const MIRROR = 'https://registry.npmmirror.com/'
const OLD_PUB = '2026-01-01T00:00:00.000Z'
const LIVE = '9.9.0'
const FAST = { between: { quietMs: 20, maxMs: 200 }, final: { quietMs: 40, maxMs: 300 } }

/** One scripted /vdc/updates answer. `registry` drives the mirror-fallback case. */
const batch = ({ latest = LIVE, registry = OFFICIAL, degraded = false, selfRegistry, selfLatest, names = CENTER_MANAGED, ok = true, partial = false, plugins } = {}) => ({
  ok, partial, checkedAt: OLD_PUB,
  plugins: plugins ?? names.map((name) => ({ name, ok: true, version: latest, publishedAt: OLD_PUB, registry, sizeKB: 120, ...(degraded ? { degraded: true } : {}) })),
  self: { ok: true, latest: selfLatest ?? latest, publishedAt: OLD_PUB, registry: selfRegistry ?? registry, ...(degraded ? { degraded: true } : {}) },
})

async function boot({ initial = [], scenarios = {}, locale = 'zh', market = false, delay = 0, listDelay = 0, settle = FAST, keepMemory = false } = {}) {
  const page = await browser.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()) })
  // A failed request is reported WITH its url, so a real missing resource is never hidden by ignoring the message.
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon\.ico/.test(r.url())) errs.push(`HTTP ${r.status()} ${r.url()}`) })
  await page.goto(ORIGIN + '/')
  await page.evaluate(async (initial, scenarios, delay, locale, market, settle, keepMemory, listDelay) => {
    const { createFakePm } = await import('/fake-pm.js')
    window.__pm = createFakePm(initial, scenarios, { delay, listDelay })
    window.setup({ locale, market, settle, keepMemory }); window.mountPanel()
  }, initial, scenarios, delay, locale, market, settle, keepMemory, listDelay)
  await page.waitForSelector('[data-testid=center]')
  return { page, errs }
}

const click = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel)
const clickText = (page, t, scope = '') => page.evaluate((x, sc) => { const b = [...document.querySelectorAll(`${sc} button`)].find((n) => n.textContent.includes(x)); if (!b) throw new Error('no button: ' + x); b.click() }, t, scope)
const text = (page) => page.evaluate(() => document.body.innerText)
const calls = (page) => page.evaluate(() => window.__pm.calls.map((c) => [c[0], c[1], c[2]]))
const state = (page) => page.evaluate(() => document.querySelector('[data-testid=release-status]')?.dataset.state)
const status = (page) => page.evaluate(() => document.querySelector('[data-testid=release-status]')?.innerText || '')
const badge = (page) => page.evaluate(() => document.querySelector('[data-tab=updates] .n')?.textContent ?? null)
/** The Updates tab, and its status line settled (the panel asks the route once when it mounts). */
async function openUpdates(page) {
  await click(page, '[data-tab=updates]')
  await page.waitForFunction(() => { const el = document.querySelector('[data-testid=release-status]'); return el && el.dataset.state !== 'checking' }, { timeout: 8000 })
}

try {
  // 1 ── one batch when the panel mounts, nothing on a timer
  {
    benchState.updates = undefined; benchState.latest = undefined; benchState.updatesHits = 0; benchState.updatesDelay = 0; benchState.latestDelay = 0
    const { page, errs } = await boot()
    await openUpdates(page)
    ok('opening the panel asks the route once', benchState.updatesHits === 1, 'hits=' + benchState.updatesHits)
    ok('the verified answer is reported as verified', (await state(page)) === 'verified', await status(page))
    ok('the status says the versions were verified on the official registry', (await status(page)).includes('版本已通过官方 npm 核验'))
    await sleep(2600)
    ok('PRIVACY: nothing is requested on a timer (2.6 s later still one batch)', benchState.updatesHits === 1, 'hits=' + benchState.updatesHits)
    await click(page, '[data-tab=all]'); await click(page, '[data-tab=updates]'); await sleep(200)
    ok('reopening the tab does not ask again and does not lose the verified state', benchState.updatesHits === 1 && (await state(page)) === 'verified', 'hits=' + benchState.updatesHits + ' state=' + await state(page))
    ok('no page errors', errs.length === 0, errs.join('; '))
    await page.close()
  }

  // 2 ── the reported bug: a live release newer than the bundled catalogue is offered, even for the center itself
  {
    benchState.updates = batch(); benchState.updatesHits = 0
    const { page, errs } = await boot({ initial: CENTER_MANAGED.map((name) => ({ name, version: ver(name), enabled: true })) })
    await openUpdates(page)
    ok('the badge counts the three live plugin updates and the center itself', (await badge(page)) === '4', 'badge=' + await badge(page))
    const rows = await page.evaluate((names) => names.map((n) => !!document.querySelector(`.card[data-id="${n}"] .btn.warn`)), CENTER_MANAGED)
    ok('every center-managed plugin has an update button (the bundled catalogue was older than npm)', rows.every(Boolean), JSON.stringify(rows))
    ok('the update button names the live version, not the pinned one', (await page.$eval(`.card[data-id="${MV}"] .btn.warn`, (el) => el.innerText)).includes(LIVE))
    ok('the center itself is listed as a row of its own', await page.evaluate(() => !!document.querySelector('[data-testid=self-update-row]')))
    ok('the bundled pin really is older than the live answer (otherwise this test proves nothing)', CATALOG.plugins.every((p) => p.updates !== 'center' || p.version !== LIVE))
    ok('no page errors', errs.length === 0, errs.join('; '))
    await page.close()
  }

  // 3 ── a mirror-only answer is honest: the rows appear, the all-clear does not
  {
    benchState.updates = batch({ registry: MIRROR, degraded: true }); benchState.updatesHits = 0
    const { page, errs } = await boot({ initial: CENTER_MANAGED.map((name) => ({ name, version: ver(name), enabled: true })) })
    await openUpdates(page)
    ok('a mirror-only answer is NOT reported as verified', (await state(page)) === 'unavailable', await status(page))
    ok('...and the status spells out that some versions were not verified officially', (await status(page)).includes('部分版本未能从官方 npm 核验'))
    ok('...and it never says everything is up to date', !(await text(page)).includes('已核验，已安装的 VibeDev 插件暂无正式版更新'))
    ok('the mirror-verified release is still offered (a mirror is honest, not useless)', (await badge(page)) === '4', 'badge=' + await badge(page))
    ok('no page errors', errs.length === 0, errs.join('; '))
    await page.close()
  }

  // 4 ── a failed read keeps the bundled snapshot and never claims everything is current
  {
    benchState.updates = 500; benchState.updatesHits = 0
    const { page, errs } = await boot({ initial: [{ name: MV, version: '0.1.0', enabled: true }, { name: FILM, version: '0.3.0', enabled: true }] })
    await openUpdates(page)
    ok('a failed read is reported as unavailable', (await state(page)) === 'unavailable', await status(page))
    ok('...and never as "everything is up to date"', !(await text(page)).includes('已核验，已安装的 VibeDev 插件暂无正式版更新'))
    const snap = await page.evaluate((names) => names.map((n) => !!document.querySelector(`.card[data-id="${n}"] .btn.warn`)), [MV, FILM])
    ok('the bundled catalogue still offers its known updates (the snapshot is kept)', snap.every(Boolean), JSON.stringify(snap))
    ok('the failed read is NOT counted as a verified update for the center', !(await page.evaluate(() => !!document.querySelector('[data-testid=self-update-row]'))))
    // The 500 is what this test scripted; anything else failing would be a real page error.
    const others = errs.filter((e) => !/^HTTP 500 .*\/vdc\/updates/.test(e))
    ok('the only failed request is the scripted one (no other page errors)', others.length === 0 && errs.some((e) => /HTTP 500 .*\/vdc\/updates/.test(e)), errs.join('; '))
    await page.close()
  }

  // 5 ── an app-supplied component is only ever an app update
  {
    benchState.updates = batch(); benchState.updatesHits = 0
    const account = { name: VD, version: ver(VD), installed: false, enabled: false, liveEnabled: true, removable: false, optional: false, rows: [{ rowId: 'dsh-vibedev', moduleName: VD, entryId: 'include:dsh-vibedev' }] }
    const { page, errs } = await boot({ initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }, account] })
    await openUpdates(page)
    const appRow = await page.evaluate(() => { const el = document.querySelector(`[data-testid=app-update-row][data-app="@vibedev-si/dsh-vibedev"]`); return el ? { text: el.innerText, buttons: el.querySelectorAll('button').length } : null })
    ok('the app-supplied account is offered as an app update', !!appRow && appRow.text.includes('升级应用'), appRow && appRow.text.split('\n')[0])
    ok('...with NO install button and no npm spec to run', !!appRow && appRow.buttons === 0 && !appRow.text.includes('@vibedev-si/dsh-vibedev@'))
    ok('...and it is not in the ordinary update list next to real npm updates', !(await page.evaluate((n) => !!document.querySelector(`.grid .card[data-id="${n}"] .btn.warn`), VD)))
    const shown = await page.evaluate(() => document.querySelectorAll('[data-testid=app-update-row], [data-testid=self-update-row]').length)
    ok('the badge counts exactly the rows shown (the app update and the center itself), never an installable duplicate', (await badge(page)) === String(shown) && shown === 2, 'badge=' + await badge(page) + ' rows=' + shown)
    ok('no page errors', errs.length === 0, errs.join('; '))
    await page.close()
  }

  // 6 ── clicking a live update: the frozen spec reaches the host, the registry is the verified one, disable is kept
  {
    benchState.updates = batch({ registry: OFFICIAL }); benchState.updatesHits = 0
    // Deliberately DISABLED and at the bundled pin: the update must not switch it on behind the user's back.
    const { page, errs } = await boot({ initial: [{ name: MV, version: ver(MV), enabled: false }, { name: 'dsh-better-sidebar', version: '0.24.1' }] })
    await openUpdates(page)
    await click(page, `.card[data-id="${MV}"] .btn.warn`)
    await page.waitForSelector('[data-testid=confirm]')
    const confirm = await text(page)
    ok('the confirm shows the installed version and the frozen live target', confirm.includes(`${ver(MV)} → ${LIVE}`), confirm.replace(/\n/g, ' | ').slice(0, 160))
    // The collapsed "what will run" block still carries the exact spec, which is what gets frozen.
    const steps = await page.evaluate(() => [...document.querySelectorAll('.log')].map((el) => el.textContent).join('\n'))
    ok('...and its steps pin the exact name@version it will install', steps.includes(`${MV}@${LIVE}`), steps.replace(/\n/g, ' | ').slice(0, 160))
    ok('...and it is the live version, not the pinned one', !steps.includes(`${MV}@${ver(MV)}`))
    await click(page, '[data-testid=confirm]')
    await page.waitForFunction(() => !document.querySelector('[data-testid=confirm]'), { timeout: 12000 })
    const c = await calls(page)
    const install = c.find((x) => x[0] === 'installBundle')
    ok('the host receives the frozen name@version, not the pinned one', install?.[1] === `${MV}@${LIVE}`, String(install?.[1]))
    ok('the install uses the registry the release was verified from, not the mirror the probe prefers', install?.[2]?.registry === OFFICIAL, String(install?.[2]?.registry))
    ok('a plugin the user had switched off stays off (no enable call)', !c.some((x) => x[0] === 'setBundleEnabled' && x[1] === MV), JSON.stringify(c.map((x) => x[0])))
    ok('...and it is installed disabled', install?.[2]?.enabled === false, String(install?.[2]?.enabled))
    ok('...with the bundle still disabled in the inventory', (await page.evaluate((n) => window.__pm.bundles.get(n)?.enabled === false, MV)))
    ok('no page errors', errs.length === 0, errs.join('; '))
    await page.close()
  }

  // 7 ── the center's own row: a copyable spec, never an install
  {
    benchState.updates = batch({ selfLatest: LIVE }); benchState.updatesHits = 0
    const { page, errs } = await boot()
    await page.evaluate(() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { value: { writeText: (x) => { window.__copied.push(x); return Promise.resolve() } }, configurable: true }) })
    await openUpdates(page)
    const row = await page.evaluate(() => { const el = document.querySelector('[data-testid=self-update-row]'); return el ? { text: el.innerText, buttons: el.querySelectorAll('button').length, testids: [...el.querySelectorAll('button')].map((b) => b.dataset.testid), dangerous: el.querySelectorAll('.btn.warn, .btn.primary').length } : null })
    ok('the center lists its own newer release', !!row && row.text.includes(SELF) && row.text.includes(LIVE), row && row.text.split('\n')[0])
    ok('...with the exact spec to run', (await page.$eval('[data-testid=self-update-spec]', (el) => el.textContent)) === `@vibedev-si/dsh-ecosystem@${LIVE}`)
    ok('...and it explains the manual, app-restarting way to do it', !!row && row.text.includes('完全退出并重开应用'))
    ok('...and offers NO install button (the center cannot update itself)', !!row && row.dangerous === 0 && row.testids.join() === 'copy-self-update', JSON.stringify(row))
    await click(page, '[data-testid=copy-self-update]'); await sleep(150)
    ok('copying gives exactly the name@version spec', (await page.evaluate(() => window.__copied)).join() === `@vibedev-si/dsh-ecosystem@${LIVE}`, await page.evaluate(() => JSON.stringify(window.__copied)))
    const c = await calls(page)
    ok('nothing was installed, removed or toggled for the center', !c.some((x) => [VD, MV, FILM, '@vibedev-si/dsh-ecosystem'].includes(x[1]) && ['installBundle', 'setBundleEnabled', 'removeBundle'].includes(x[0])), JSON.stringify(c.map((x) => x[0])))
    ok('no page errors', errs.length === 0, errs.join('; '))
    await page.close()
  }

  // 8 ── 关于 stays hidden until clicked
  {
    benchState.updates = batch(); benchState.updatesHits = 0
    const { page, errs } = await boot()
    ok('the about panel is hidden by default', !(await text(page)).includes('VibeDev 团队出品的插件，集中在这里'))
    await clickText(page, '关于 VibeDev 生态')
    await sleep(120)
    ok('clicking 关于 expands it', (await text(page)).includes('VibeDev 团队出品的插件，集中在这里'))
    ok('no page errors', errs.length === 0, errs.join('; '))
    await page.close()
  }

  // 9 ── a double click while a check is running is coalesced into one batch
  {
    benchState.updates = batch(); benchState.updatesHits = 0; benchState.updatesDelay = 400
    const { page, errs } = await boot()
    await sleep(80)
    await click(page, '[data-testid=check-update]'); await click(page, '[data-testid=check-update]')
    await sleep(700)
    ok('two clicks during the mount check add no request', benchState.updatesHits === 1, 'hits=' + benchState.updatesHits)
    benchState.updatesDelay = 0
    await click(page, '[data-testid=check-update]')
    await sleep(500)
    ok('a later explicit click does ask again (one request per deliberate click)', benchState.updatesHits === 2, 'hits=' + benchState.updatesHits)
    ok('no page errors', errs.length === 0, errs.join('; '))
    await page.close()
  }

  // 10 ── the English screen says the same honest thing
  {
    benchState.updates = batch({ registry: MIRROR, degraded: true }); benchState.updatesHits = 0
    const { page, errs } = await boot({ locale: 'en' })
    await openUpdates(page)
    const s = await status(page)
    ok('English: an unverified answer is spelled out and never claims everything is current', s.includes('could not be verified on the official npm registry') && !/[\u4e00-\u9fff]/.test(s), s.slice(0, 120))
    ok('English: the ecosystem is named without any leftover 插件中心 wording', (await text(page)).includes('VibeDev Ecosystem') && !(await text(page)).includes('插件中心'))
    ok('no page errors', errs.length === 0, errs.join('; '))
    await page.close()
  }
  // 20 ── a host that updates app-owned packages in place (VibeDev Next reports `application`)
  const owned = (name, application, extra = {}) => ({ name, version: application.selected === 'profile' ? application.local : application.shipped,
    installed: application.local !== undefined, enabled: false, liveEnabled: true, removable: application.local !== undefined, optional: false,
    rows: [{ rowId: name, moduleName: name, entryId: 'include:' + name }], application, ...extra })
  {
    benchState.updates = batch({ registry: OFFICIAL }); benchState.updatesHits = 0
    const { page, errs } = await boot({ initial: [owned(VD, { shipped: '0.0.1', selected: 'installation' })] })
    await openUpdates(page)
    ok('updatable built-in: the account plugin is a real update row, not "comes with the app"', await page.evaluate((n) => !!document.querySelector(`.card[data-id="${n}"] [data-testid=update-built-in]`), VD)
      && !(await page.evaluate(() => !!document.querySelector('[data-testid=app-update-row]'))))
    await click(page, `.card[data-id="${VD}"] [data-testid=update-built-in]`)
    await page.waitForSelector('[data-testid=confirm]')
    await click(page, '[data-testid=confirm]')
    await page.waitForFunction(() => document.querySelector('.modal')?.dataset.mode === 'result', { timeout: 12000 })
    const c = await calls(page)
    const install = c.find((x) => x[0] === 'installBundle')
    ok('...the exact live version goes into the profile, unselected', install?.[1] === `${VD}@${LIVE}` && install?.[2]?.enabled === false && install?.[2]?.saveExact === true, JSON.stringify(install))
    ok('...nothing is switched on (the app layers run it)', !c.some((x) => x[0] === 'setBundleEnabled'))
    ok('...and the result asks for a restart', (await text(page)).includes('需要重启'))
    ok('no page errors', errs.length === 0, errs.join('; '))
    await page.close()
  }
  {
    benchState.updates = batch({ selfLatest: LIVE, registry: OFFICIAL }); benchState.updatesHits = 0
    const { page, errs } = await boot({ initial: [owned('@vibedev-si/dsh-ecosystem', { shipped: SELF, selected: 'installation' })] })
    await openUpdates(page)
    const row = await page.evaluate(() => { const el = document.querySelector('[data-testid=self-update-row]'); return el ? { text: el.innerText, updatable: el.hasAttribute('data-updatable') } : null })
    ok('updatable built-in: the center offers to update itself', !!row?.updatable && row.text.includes('也可以直接更新') && !!(await page.$('[data-testid=update-self-row]')), JSON.stringify(row))
    await click(page, '[data-testid=update-self-row]')
    await page.waitForSelector('[data-testid=built-in-result]', { timeout: 12000 })
    ok('...its result is "downloaded, restart to apply"', await page.$eval('[data-testid=built-in-result]', (el, v) => el.dataset.status === 'restart' && el.innerText.includes(`已下载 ${v}`) && el.innerText.includes('重启'), LIVE))
    const c = await calls(page)
    ok('...installing exactly its own name@version from the verified registry', c.some((x) => x[0] === 'installBundle' && x[1] === `@vibedev-si/dsh-ecosystem@${LIVE}` && x[2]?.registry === OFFICIAL), JSON.stringify(c.filter((x) => x[0] === 'installBundle')))
    await click(page, '[data-testid=built-in-done]'); await sleep(150)
    ok('...and the row then says it waits for the restart, with no second update button', (await page.$eval('[data-testid=self-update-row]', (el) => el.innerText)).includes('重启 VibeDev Next 后生效') && !(await page.$('[data-testid=update-self-row]')))
    ok('no page errors', errs.length === 0, errs.join('; '))
    await page.close()
  }
  {
    benchState.updates = batch({ registry: OFFICIAL }); benchState.updatesHits = 0
    const { page, errs } = await boot({ initial: [owned(VD, { shipped: '0.0.1', local: LIVE, selected: 'profile' })] })
    await click(page, `.card[data-id="${VD}"]`)
    await page.waitForSelector('[data-testid=built-in-updated]')
    ok('updatable built-in: the detail says an update is running and names the shipped version', (await page.$eval('[data-testid=built-in-updated]', (el) => el.innerText)).includes('0.0.1'))
    await click(page, '[data-testid=restore-built-in]')
    await page.waitForSelector('[data-testid=built-in-result]', { timeout: 12000 })
    const c = await calls(page)
    ok('...restore removes only the profile copy, and asks for a restart', c.some((x) => x[0] === 'removeBundle' && x[1] === VD) && (await page.$eval('[data-testid=built-in-result]', (el) => el.dataset.status)) === 'restart')
    ok('...after which the shipped version is shown again', (await page.evaluate((n) => window.__pm.bundles.get(n)?.version, VD)) === '0.0.1')
    ok('no page errors', errs.length === 0, errs.join('; '))
    await page.close()
  }
  // ── no flash: the page opens on the newest catalog it knows, and never offers 安装 for a plugin it has not checked ──
  {
    benchState.updates = batch(); benchState.updatesHits = 0; benchState.updatesDelay = 1500
    const filmVersion = (page) => page.evaluate((id) => document.querySelector(`.card[data-id="${id}"] .sub`)?.textContent ?? '', FILM)
    const pending = (page, id) => page.evaluate((x) => !!document.querySelector(`.card[data-id="${x}"] [data-testid=state-pending]`), id)
    const installButton = (page, id) => page.evaluate((x) => !!document.querySelector(`.card[data-id="${x}"] .btn.primary`), id)
    const enabledBadge = (page, id) => page.evaluate((x) => !!document.querySelector(`.card[data-id="${x}"] .btn.ok`), id)
    // An installed plugin's card shows its state (已启用, or 更新到 x once a newer release is known) with a 管理 menu.
    const installedState = (page, id) => page.evaluate((x) => !!document.querySelector(`.card[data-id="${x}"] .acts`), id)
    // First visit ever: nothing kept. The installed list takes 700 ms, the release check 1.5 s.
    const { page, errs } = await boot({ initial: [{ name: MV, version: ver(MV), enabled: true }], listDelay: 700 })
    ok('first frame: an installed plugin shows no 安装 button before the installed list arrives', !(await installButton(page, MV)) && await pending(page, MV))
    ok('first frame: nor does a plugin that is not installed', !(await installButton(page, FILM)) && await pending(page, FILM))
    const suiteHeight = () => page.evaluate(() => document.querySelector('.suite')?.getBoundingClientRect().height ?? 0)
    const before = await suiteHeight()
    await page.waitForFunction((id) => !!document.querySelector(`.card[data-id="${id}"] .btn.ok`), { timeout: 5000 }, MV)
    const after = await suiteHeight()
    ok('the suite box keeps its height when the installed list arrives (nothing below it moves)', before > 0 && Math.abs(before - after) < 0.5, `before ${before} after ${after}`)
    ok('...then the installed plugin shows as enabled, the other one as installable', await enabledBadge(page, MV) && await installButton(page, FILM))
    await page.waitForFunction((id, v) => (document.querySelector(`.card[data-id="${id}"] .sub`)?.textContent ?? '').includes(v), { timeout: 8000 }, FILM, LIVE)
    ok('...and the live release replaces the shipped version once checked', (await filmVersion(page)).includes(LIVE), await filmVersion(page))

    // Coming back to the page in the same session: everything is already known.
    const hits = benchState.updatesHits
    await page.evaluate(() => window.mountPanel())
    ok('re-entry: the live version is there at once, not the shipped one', (await filmVersion(page)).includes(LIVE), await filmVersion(page))
    ok('re-entry: the installed state is there at once (no placeholder, no 安装 for an installed plugin)', await installedState(page, MV) && !(await pending(page, MV)) && !(await installButton(page, MV)))
    await sleep(1700)
    // 0.1.15: a check under a minute old is this opening's answer (the host would serve it from its one-minute cache anyway).
    ok('re-entry within a minute reuses the check just made (no second request)', benchState.updatesHits === hits, `hits ${hits} -> ${benchState.updatesHits}`)
    ok('no page errors', errs.length === 0, errs.join('; '))
    await page.close()

    // After an app restart (a new page): the kept answer is shown at once, but never as checked just now.
    const next = await boot({ initial: [{ name: MV, version: ver(MV), enabled: true }], listDelay: 700, keepMemory: true })
    ok('restart: the live version kept from the last visit is shown at once', (await filmVersion(next.page)).includes(LIVE), await filmVersion(next.page))
    await click(next.page, '[data-tab=updates]')
    ok('restart: while the new check runs, the status says checking, not verified', (await state(next.page)) === 'checking', String(await state(next.page)))
    await next.page.waitForFunction(() => document.querySelector('[data-testid=release-status]')?.dataset.state === 'verified', { timeout: 8000 })
    ok('...and verified once the check answers', (await state(next.page)) === 'verified')
    ok('no page errors', next.errs.length === 0, next.errs.join('; '))
    await next.page.close()

    // A kept answer the validator refuses is never shown: the shipped catalog stands.
    const forged = { ...batch(), keptAt: new Date().toISOString(), catalog: { ...CATALOG, updated: '2099-01-01', plugins: [{ ...entry(FILM), links: { ...entry(FILM).links, repo: 'https://evil.test/x' }, version: '7.7.7' }, ...CATALOG.plugins.filter((p) => p.id !== FILM)] } }
    const third = await browser.newPage()
    await third.goto(ORIGIN + '/')
    await third.evaluate((v) => localStorage.setItem('vibedev-ecosystem:last-updates:v1', JSON.stringify(v)), forged)
    await third.close()
    benchState.updatesDelay = 3000
    const fourth = await boot({ keepMemory: true })
    ok('a kept catalog the validator refuses is not shown', !(await filmVersion(fourth.page)).includes('7.7.7'), await filmVersion(fourth.page))
    ok('no page errors', fourth.errs.length === 0, fourth.errs.join('; '))
    await fourth.page.close()
    benchState.updatesDelay = 0
  }
  // ── 0.1.15: one check at app start, a dot on the sidebar entry, a banner on the first page ──
  {
    benchState.updates = batch(); benchState.updatesHits = 0; benchState.updatesDelay = 300
    const page = await browser.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()) })
    await page.goto(ORIGIN + '/')
    // The app loads the client half at boot; nobody opens the page.
    await page.evaluate(async (initial) => {
      const { createFakePm } = await import('/fake-pm.js')
      window.__pm = createFakePm(initial, {}, {})
      window.setup({ locale: 'zh', settle: { between: { quietMs: 20, maxMs: 200 }, final: { quietMs: 40, maxMs: 300 } } })
      const entry = window.__reg.slots.find((s) => s.decl && s.decl.name === 'sidebar.panellist')
      const host = document.createElement('div'); host.id = 'sidebar-entry'; document.body.appendChild(host)
      window.__entryRoot = ReactDOM.createRoot(host)
      window.__entryRoot.render(window.React.createElement(entry.comp, { size: 18 }))
    }, [{ name: MV, version: ver(MV), enabled: true }])
    const dot = () => page.evaluate(() => document.querySelector('#sidebar-entry [data-vdc-update-badge]')?.getAttribute('data-vdc-update-badge') ?? null)
    ok('before the startup check the sidebar entry has no dot', (await dot()) === null)
    await page.waitForFunction(() => !!document.querySelector('#sidebar-entry [data-vdc-update-badge]'), { timeout: 8000 })
    // The installed media viewer has a newer release, and so does this center: two.
    ok('after the startup check the sidebar entry shows the dot, counting the updates', (await dot()) === '2', String(await dot()))
    ok('its tooltip says how many', (await page.evaluate(() => document.querySelector('#sidebar-entry [data-vdc-update-badge]').title)).includes('2 个更新可用'))
    ok('the startup check asked the route once, without the page being opened', benchState.updatesHits === 1, 'hits=' + benchState.updatesHits)
    await sleep(2600)
    ok('PRIVACY: and nothing more on a timer', benchState.updatesHits === 1, 'hits=' + benchState.updatesHits)

    // Opening the page within the minute reuses that check.
    await page.evaluate(() => window.mountPanel())
    await page.waitForSelector('[data-testid=updates-banner]', { timeout: 5000 })
    ok('opening the page right after does not ask again', benchState.updatesHits === 1, 'hits=' + benchState.updatesHits)
    const banner = await page.$eval('[data-testid=updates-banner]', (el) => el.innerText)
    ok('the first page shows a banner with the number and what can be updated', banner.includes('有 2 个更新可用') && banner.includes('媒体预览') && banner.includes('VibeDev 生态'), banner.replace(/\n/g, ' | '))
    ok('the banner and the Updates tab show the same number as the dot', (await badge(page)) === '2')
    await click(page, '[data-testid=updates-banner-open]')
    ok('its button opens the Updates tab', await page.evaluate(() => document.querySelector('[data-tab=updates]').classList.contains('on')))
    ok('...where the check counts as verified, not as checking', (await state(page)) === 'verified', String(await state(page)))
    // An explicit check always asks.
    await click(page, '[data-testid=release-status] button')
    await page.waitForFunction(() => document.querySelector('[data-testid=release-status]')?.dataset.state === 'verified', { timeout: 8000 })
    ok('"check for updates" always asks the route', benchState.updatesHits === 2, 'hits=' + benchState.updatesHits)

    // Updating the media viewer elsewhere (the Plugins page): the dot follows, without going online.
    await page.evaluate((name) => { window.__pm.bundles.get(name).version = '9.9.0'; window.__fireChanged() }, MV)
    await page.waitForFunction(() => document.querySelector('#sidebar-entry [data-vdc-update-badge]')?.getAttribute('data-vdc-update-badge') === '1', { timeout: 5000 })
    ok('after a plugin changes, the dot counts one fewer', (await dot()) === '1')
    ok('...and that took no request', benchState.updatesHits === 2, 'hits=' + benchState.updatesHits)
    ok('no page errors', errs.length === 0, errs.join('; '))
    await page.close()
    benchState.updatesDelay = 0
  }

  // ── nothing to update: no dot, no banner ──
  {
    benchState.updates = batch({ latest: SELF, names: [] }); benchState.updatesHits = 0
    const { page, errs } = await boot({ initial: [{ name: MV, version: ver(MV), enabled: true }] })
    await page.evaluate(() => {
      const entry = window.__reg.slots.find((s) => s.decl && s.decl.name === 'sidebar.panellist')
      const host = document.createElement('div'); host.id = 'sidebar-entry'; document.body.appendChild(host)
      ReactDOM.createRoot(host).render(window.React.createElement(entry.comp, { size: 18 }))
    })
    await openUpdates(page)
    await sleep(300)
    ok('up to date: no banner on the first page', await page.evaluate(() => { document.querySelector('[data-tab=all]').click(); return !document.querySelector('[data-testid=updates-banner]') }))
    ok('up to date: no dot on the sidebar entry', await page.evaluate(() => !document.querySelector('#sidebar-entry [data-vdc-update-badge]')))
    ok('no page errors', errs.length === 0, errs.join('; '))
    await page.close()
  }
} catch (e) {
  ok('test run completed without throwing', false, String(e && e.stack || e))
} finally {
  await browser.close(); server.close()
}
const bad = results.filter((x) => !x).length
console.log(`\n${results.length - bad}/${results.length} passed`)
process.exit(bad ? 1 : 0)
