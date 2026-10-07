import puppeteer from 'puppeteer-core'
import { mkdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startBench, state as benchState } from './bench-server.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const SHOTS = process.env.SHOTS ?? join(here, '..', 'shots')
mkdirSync(SHOTS, { recursive: true })
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const results = []
const ok = (name, cond, extra = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const server = await startBench(4801)
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-first-run'], defaultViewport: { width: 1180, height: 860, deviceScaleFactor: 1.25 } })
const MV = '@vibedev-si/dsh-media-viewer'
const VD = '@vibedev-si/dsh-vibedev' // formerly dsh-media
// Versions come from the catalog (the install allow-list), so bumping one there never needs a test edit.
const CATALOG = JSON.parse(readFileSync(join(here, '..', 'catalog', 'catalog.json'), 'utf8'))
const spec = (id) => { const p = CATALOG.plugins.find((x) => x.id === id); return `${p.npm}@${p.version}` }
const ver = (id) => CATALOG.plugins.find((x) => x.id === id).version
const pub = (id) => CATALOG.plugins.find((x) => x.id === id).publishedAt

const FAST = { between: { quietMs: 20, maxMs: 200 }, final: { quietMs: 40, maxMs: 300 } }
async function boot({ initial = [], scenarios = {}, delay = 0, locale = 'zh', market = false, dark = false, noProbe = false, fastest, resolved, brand, settle = FAST } = {}) {
  const page = await browser.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()) })
  // A failed request is reported WITH its url, so a real missing resource is not hidden by ignoring the message.
  page.on('response', (r) => { if (r.status() >= 400 && !/favicon\.ico/.test(r.url())) errs.push(`HTTP ${r.status()} ${r.url()}`) })
  await page.goto('http://127.0.0.1:4801/')
  if (dark) await page.evaluate(() => { const s = document.documentElement.style; const v = { '--dsw-alias-bg-base': '#16171b', '--dsw-alias-bg-layer-1': '#1e1f25', '--dsw-alias-bg-layer-2': '#272830', '--dsw-alias-bg-overlay': '#2a2b33', '--dsw-alias-border-l1': 'rgba(255,255,255,.09)', '--dsw-alias-border-l2': 'rgba(255,255,255,.18)', '--dsw-alias-brand-primary': '#6f87ff', '--dsw-alias-label-primary': '#ececf2', '--dsw-alias-label-secondary': '#9b9fae' }; for (const k in v) s.setProperty(k, v[k]); document.body.style.background = '#16171b' })
  if (brand) await page.evaluate((b) => document.documentElement.style.setProperty('--dsw-alias-brand-primary', b), brand)
  await page.evaluate(async (initial, scenarios, delay, locale, market, noProbe, fastest, resolved, settle) => {
    const { createFakePm } = await import('/fake-pm.js')
    window.__pm = createFakePm(initial, scenarios, { delay, resolved })
    window.setup({ locale, market, noProbe, fastest, settle }); window.mountPanel()
  }, initial, scenarios, delay, locale, market, noProbe, fastest, resolved, settle)
  await page.waitForSelector('[data-testid=center]')
  await sleep(150)
  return { page, errs }
}
const click = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel)
const clickText = (page, text, scope = '') => page.evaluate((t, sc) => { const b = [...document.querySelectorAll(`${sc} button`)].find((x) => x.textContent.includes(t)); if (!b) throw new Error('no button: ' + t); b.click() }, text, scope)
const text = (page) => page.evaluate(() => document.body.innerText)
const calls = (page) => page.evaluate(() => window.__pm.calls.map((c) => [c[0], c[1], c[2]]))
const shot = (page, n) => page.screenshot({ path: join(SHOTS, n + '.png') })
const waitText = (page, t, ms = 15000) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout: ms }, t)

try {
  // 0 ── registration, the way the host will see it
  {
    const { page, errs } = await boot()
    const reg = await page.evaluate(() => ({ injected: window.__reg.injected, decls: window.__reg.slots.filter((s) => s.decl).map((s) => s.decl) }))
    ok('registers the main panel and the sidebar icon', reg.injected.includes('main') && reg.injected.includes('sidebar.panellist'), reg.injected.join(','))
    ok('panel key and sidebar id match (so selectPanel opens it)', reg.decls.some((d) => d.name === 'main' && d.key === 'vibedev-center') && reg.decls.some((d) => d.name === 'sidebar.panellist' && d.id === 'vibedev-center'))
    ok('no page errors on first render', errs.length === 0, errs.join('; '))
    await page.close()
  }

  // 1 ── first screen
  {
    const { page } = await boot({ initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    const t = await text(page)
    // The "what is this" panel is collapsed by default (0.1.7): the first screen has to offer the way to it.
    ok('the first screen keeps the explanation collapsed, with "关于" to open it', !t.includes('VibeDev 团队出品的插件') && t.includes('关于 VibeDev 生态'))
    await clickText(page, '关于 VibeDev 生态'); await sleep(120)
    ok('...and clicking it explains what this is', (await text(page)).includes('VibeDev 团队出品的插件'))
    ok('shows 3 official cards + 2 companions', (await page.evaluate(() => document.querySelectorAll('.card').length)) === 5)
    ok('suite says it will install 3 (sidebar already there)', t.includes('将安装 3 个插件（已装 1 个）'))
    ok('account + billing is visible on the card', t.includes('需要 VibeDev 账号') && t.includes('按用量计费'))
    ok('community plugins are labelled as such', (await page.evaluate(() => [...document.querySelectorAll('.card[data-id=dshmarket] .tag')].map((x) => x.textContent))).includes('DSH 社区市场插件'))
    await shot(page, '01-home'); await page.close()
  }

  // 2 ── one-click suite: confirm -> run -> result, with the right call order
  {
    const { page, errs } = await boot({ initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }], delay: 40 })
    await clickText(page, '一键安装套装')
    await page.waitForSelector('[data-testid=confirm]')
    const t = await text(page)
    ok('confirm sheet lists what will happen and warns about the account', t.includes('将安装 3 个插件') && t.includes('需要 VibeDev 账号，按用量计费'))
    ok('nothing is installed before the user confirms', (await calls(page)).filter((c) => c[0] === 'installBundle').length === 0)
    await shot(page, '02-confirm')
    await click(page, '[data-testid=confirm]')
    await waitText(page, '正在安装')
    await shot(page, '03-running')
    await waitText(page, '安装完成')
    const c = await calls(page)
    const installs = c.filter((x) => x[0] === 'installBundle')
    ok('installed exactly the 3 missing, with exact versions', installs.map((x) => x[1]).join() === [VD, 'dsh-film', MV].map(spec).join(), installs.map((x) => x[1]).join())
    ok('every install was requested NOT enabled', installs.every((x) => x[2].enabled === false))
    ok('each plugin enabled only after its own install', (() => { const seq = c.map((x) => x[0] + ':' + x[1]); return [VD, 'dsh-film', MV].every((n) => seq.indexOf('setBundleEnabled:' + n) > seq.findIndex((s) => s.startsWith('installBundle:' + n))) })())
    const t2 = await text(page)
    ok('result explains what to do next, per plugin', t2.includes('已安装并启用 3 个插件') && t2.includes('剧本') && t2.includes('生成一张') && t2.includes('媒体画廊'))
    ok('sidebar was not reinstalled', !installs.some((x) => String(x[1]).startsWith('dsh-better-sidebar')))
    await shot(page, '04-success')
    ok('no page errors during the whole flow', errs.length === 0, errs.join('; '))
    await page.close()
  }

  // 3 ── single plugin whose prerequisite is missing: installs both, prerequisite first
  {
    const { page } = await boot()
    await page.evaluate(() => document.querySelector('.card[data-id="@vibedev-si/dsh-media-viewer"] .btn.primary').click())
    await page.waitForSelector('[data-testid=confirm]')
    ok('confirm sheet lists the prerequisite too', (await text(page)).includes('Better Sidebar'))
    await shot(page, '05-confirm-with-dep')
    await click(page, '[data-testid=confirm]'); await waitText(page, '安装完成')
    ok('prerequisite installed before the plugin', (await calls(page)).filter((x) => x[0] === 'installBundle').map((x) => x[1]).join() === `dsh-better-sidebar@0.24.1,${spec(MV)}`)
    await page.close()
  }

  // 4 ── failures: each must be explained, be recoverable, and leave nothing behind
  const failCase = async (name, scenario, expectKind, expectText, shotName) => {
    const { page } = await boot({ initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }], scenarios: { 'dsh-film': scenario } })
    await clickText(page, '一键安装套装'); await page.waitForSelector('[data-testid=confirm]'); await click(page, '[data-testid=confirm]')
    await page.waitForSelector('[data-testid=fail]', { timeout: 15000 })
    const kind = await page.evaluate(() => document.querySelector('[data-testid=fail]').dataset.kind)
    const t = await text(page)
    ok(`failure "${name}" is classified as ${expectKind}`, kind === expectKind, kind)
    ok(`failure "${name}" explains itself`, t.includes(expectText), expectText)
    const has = await page.evaluate(() => [...window.__pm.bundles.keys()])
    ok(`failure "${name}" leaves the failed plugin out and keeps the finished one`, !has.includes('dsh-film') && has.includes(VD) && !has.includes('@vibedev-si/dsh-media-viewer'), has.join())
    ok(`failure "${name}" says whether the configuration was touched`, /没有改动|没有改动你的插件配置|不会改动|未改动|你确认之前/.test(t))
    await shot(page, shotName); return page
  }
  let p = await failCase('network', { network: true }, 'network', '无法下载插件', '06-fail-network')
  ok('network failure offers retry + copy command', (await text(p)).includes('重试') && (await text(p)).includes('复制安装命令')); await p.close()
  p = await failCase('incompatible', { incompat: true }, 'incompat', '当前 VibeDev 版本不满足要求', '07-fail-incompat')
  ok('incompatible shows the versions involved and does NOT offer a pointless retry', (await text(p)).includes('0.1.7') && !(await text(p)).includes('重试')); await p.close()
  p = await failCase('cooldown', { cooldown: true }, 'exempt', '新版本冷却期', '08-fail-cooldown')
  ok('cooldown names the offending package', (await text(p)).includes('dsh-film@0.3.0')); await p.close()
  p = await failCase('not found', { notFound: true }, 'notfound', '在 npm 上找不到', '08b-fail-notfound'); await p.close()
  p = await failCase('registry mismatch', { nameOverride: 'evil-film' }, 'mismatch', '已拦截', '08c-fail-mismatch')
  ok('mismatch never calls installBundle', !(await calls(p)).some((c) => c[0] === 'installBundle' && String(c[1]).startsWith('dsh-film'))); await p.close()

  // 5 ── build scripts: amber, and approval is passed on retry
  {
    const { page } = await boot({ initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }], scenarios: { 'dsh-film': { builds: true } } })
    await clickText(page, '一键安装套装'); await page.waitForSelector('[data-testid=confirm]'); await click(page, '[data-testid=confirm]')
    await page.waitForSelector('[data-testid=fail]')
    const t = await text(page)
    ok('pending build scripts are shown as a decision, naming the packages', t.includes('esbuild') && t.includes('protobufjs') && t.includes('待你决定'))
    ok('pending build scripts say nothing changed until the user confirms', t.includes('你确认之前没有改动插件配置'))
    await shot(page, '09-builds')
    await click(page, '[data-testid=approve]'); await waitText(page, '安装完成')
    const call = (await calls(page)).filter((c) => c[0] === 'installBundle' && String(c[1]).startsWith('dsh-film')).pop()
    ok('approval is sent as approvedBuilds with the same package names', JSON.stringify(call[2].approvedBuilds) === '["esbuild","protobufjs"]', JSON.stringify(call[2].approvedBuilds))
    ok('after approval, the remaining plugins continue', (await calls(page)).some((c) => c[0] === 'installBundle' && c[1] === spec(MV)))
    await page.close()
  }

  // 6 ── restart-required is its own outcome
  {
    const { page } = await boot({ initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }], scenarios: { 'dsh-film': { restartOnInstall: true } } })
    await clickText(page, '一键安装套装'); await page.waitForSelector('[data-testid=confirm]'); await click(page, '[data-testid=confirm]')
    await waitText(page, '需要重启')
    const t = await text(page)
    ok('restart-required is not reported as plain success', !t.includes('立即刷新页面') && t.includes('不会替你重启应用'))
    await shot(page, '10-restart'); await page.close()
  }

  // 7 ── cancel
  {
    const { page } = await boot({ initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }], delay: 350 })
    await clickText(page, '一键安装套装'); await page.waitForSelector('[data-testid=confirm]'); await click(page, '[data-testid=confirm]')
    await page.waitForFunction(() => window.__pm.calls.some(c => c[0] === 'inspect') && document.querySelector('[data-testid=cancel]:not([disabled])'), { timeout: 10000 })
    await click(page, '[data-testid=cancel]:not([disabled])')
    await page.waitForFunction(() => /安装未完成|安装完成/.test(document.body.innerText), { timeout: 15000 })
    const has = await page.evaluate(() => [...window.__pm.bundles.keys()])
    ok('cancel stops before the later plugins', !has.includes('@vibedev-si/dsh-media-viewer') && !has.includes('dsh-film'), has.join())
    ok('cancel asks the host to cancel the running request', (await calls(page)).some((c) => c[0] === 'cancelInstall'), (await calls(page)).map((c) => c[0]).join(','))
    await page.close()
  }

  // 8 ── management: disable / enable / uninstall (clean), uninstall (half-removed: the real incident)
  {
    const { page } = await boot({ initial: [{ name: 'dsh-film', version: ver('dsh-film') }, { name: 'dsh-better-sidebar', version: '0.24.1' }], delay: 20 })
    await page.evaluate(() => document.querySelector('.card[data-id=dsh-film] .btn.idle').click())
    await sleep(100); await shot(page, '11-manage-menu')
    await clickText(page, '停用（保留数据）', '.menu'); await sleep(250)
    ok('disable calls setBundleEnabled(false) and the card shows Enable', (await calls(page)).some((c) => c[0] === 'setBundleEnabled' && c[1] === 'dsh-film' && c[2] === false) && (await page.evaluate(() => document.querySelector('.card[data-id=dsh-film] .ft').innerText.includes('启用'))))
    await page.evaluate(() => document.querySelector('.card[data-id=dsh-film] .btn.idle').click()); await sleep(80)
    await clickText(page, '卸载', '.menu'); await sleep(300)
    ok('clean uninstall removes it and the card returns to Install', !(await page.evaluate(() => window.__pm.bundles.has('dsh-film'))) && (await page.evaluate(() => document.querySelector('.card[data-id=dsh-film] .ft').innerText.includes('安装'))))
    await page.close()
  }
  {
    const { page } = await boot({ initial: [{ name: 'dsh-film', version: '0.3.0' }, { name: 'dsh-better-sidebar', version: '0.24.1' }], scenarios: { 'dsh-film': { removeFailsLast: true } } })
    await page.evaluate(() => document.querySelector('.card[data-id=dsh-film] .btn.idle').click()); await sleep(80)
    await clickText(page, '卸载', '.menu')
    await page.waitForSelector('[data-testid=half]')
    const t = await text(page)
    ok('half-removed uninstall is explained (disabled but still installed)', t.includes('已被停用，但没有卸载干净') && t.includes('已停用、仍安装'))
    ok('half-removed names the real cause (pnpm cooldown)', t.includes('冷却期'))
    ok('half-removed offers re-enable and retry', t.includes('重新启用') && t.includes('重试卸载'))
    await shot(page, '12-half-removed')
    await clickText(page, '重新启用'); await sleep(250)
    ok('re-enable brings the plugin back', await page.evaluate(() => window.__pm.bundles.get('dsh-film').enabled === true))
    await page.close()
  }

  // 9 ── migration: the old package name
  {
    const { page } = await boot({ initial: [{ name: 'dsh-media-viewer', version: '0.1.0' }, { name: 'dsh-better-sidebar', version: '0.24.1' }], delay: 30 })
    ok('legacy package triggers the migration banner', await page.evaluate(() => !!document.querySelector('[data-testid=migrate-banner]')))
    await shot(page, '13-migrate-banner')
    await clickText(page, '一键切换'); await page.waitForSelector('[data-testid=mig-result]', { timeout: 15000 })
    const st = await page.evaluate(() => document.querySelector('[data-testid=mig-result]').dataset.status)
    ok('migration succeeds', st === 'done', st)
    const state = await page.evaluate(() => ({ old: window.__pm.bundles.has('dsh-media-viewer'), nw: window.__pm.bundles.get('@vibedev-si/dsh-media-viewer') }))
    ok('old package gone, new package installed and enabled', !state.old && state.nw?.enabled === true)
    const seq = (await calls(page)).map((c) => c[0] + ':' + c[1])
    ok('order: new installed -> old disabled -> new enabled -> old removed', seq.findIndex((s) => s.startsWith('installBundle:@vibedev-si')) < seq.indexOf('setBundleEnabled:dsh-media-viewer') && seq.indexOf('setBundleEnabled:dsh-media-viewer') < seq.indexOf('setBundleEnabled:@vibedev-si/dsh-media-viewer') && seq.indexOf('setBundleEnabled:@vibedev-si/dsh-media-viewer') < seq.indexOf('removeBundle:dsh-media-viewer'), seq.join(' | '))
    await clickText(page, '知道了', '.modal'); await sleep(200)
    ok('banner disappears after migration', await page.evaluate(() => !document.querySelector('[data-testid=migrate-banner]')))
    await page.close()
  }
  {
    const { page } = await boot({ initial: [{ name: 'dsh-media-viewer', version: '0.1.0' }], scenarios: { [MV]: { enableFails: true } } })
    await clickText(page, '一键切换'); await page.waitForSelector('[data-testid=mig-result]')
    ok('failed migration puts the old package back (user is never left with neither)', await page.evaluate(() => window.__pm.bundles.get('dsh-media-viewer').enabled === true) && (await text(page)).includes('重新启用'))
    await shot(page, '14-migrate-restored'); await page.close()
  }
  {
    // The card's own Install (or a suite, or a prerequisite) while the old name is installed: the same switch, never both on.
    const { page } = await boot({ initial: [{ name: 'dsh-media-viewer', version: '0.1.0' }, { name: 'dsh-better-sidebar', version: '0.24.1' }], delay: 20 })
    await page.evaluate((id) => document.querySelector(`.card[data-id="${id}"] .btn.primary`).click(), MV); await page.waitForSelector('[data-testid=confirm]')
    ok('install confirm says it replaces the old package', await page.evaluate(() => !!document.querySelector('[data-testid=switch-note]')) && (await text(page)).includes('替换旧包 dsh-media-viewer'))
    await click(page, '[data-testid=confirm]'); await waitText(page, '安装完成')
    const seq = (await calls(page)).map((c) => c[0] + ':' + c[1] + (c[0] === 'setBundleEnabled' ? ':' + c[2] : ''))
    const both = seq.indexOf(`setBundleEnabled:${MV}:true`) < seq.indexOf('setBundleEnabled:dsh-media-viewer:false')
    ok('install: old off before new on, old removed after', !both && seq.indexOf(`setBundleEnabled:${MV}:true`) < seq.indexOf('removeBundle:dsh-media-viewer'), seq.join(' | '))
    const state = await page.evaluate(() => ({ old: window.__pm.bundles.has('dsh-media-viewer'), nw: window.__pm.bundles.get('@vibedev-si/dsh-media-viewer') }))
    ok('install: old package gone, new one on, no banner left', !state.old && state.nw?.enabled === true && await page.evaluate(() => !document.querySelector('[data-testid=migrate-banner]')))
    await page.close()
  }
  {
    const { page } = await boot({ initial: [{ name: 'dsh-media-viewer', version: '0.1.0' }, { name: 'dsh-better-sidebar', version: '0.24.1' }], scenarios: { [MV]: { enableFails: true } } })
    await page.evaluate((id) => document.querySelector(`.card[data-id="${id}"] .btn.primary`).click(), MV); await page.waitForSelector('[data-testid=confirm]')
    await click(page, '[data-testid=confirm]'); await page.waitForSelector('[data-testid=fail]', { timeout: 15000 })
    ok('install switch that fails turns the old one back on and says so (not "enable it by hand")', await page.evaluate(() => window.__pm.bundles.get('dsh-media-viewer').enabled === true && !!document.querySelector('[data-testid=restored-old]')))
    await page.close()
  }

  // 10 ── updates
  {
    const { page } = await boot({ initial: [{ name: 'dsh-film', version: '0.2.0' }, { name: 'dshmarket', version: '1.0.0' }, { name: 'dsh-better-sidebar', version: '0.24.1' }] })
    const badge = await page.evaluate(() => document.querySelector('[data-tab=updates] .n')?.textContent)
    ok('updates tab counts only center-managed plugins (the market updates itself)', badge === '1', String(badge))
    ok(`card offers "update to ${ver('dsh-film')}"`, (await text(page)).includes('更新到 ' + ver('dsh-film')))
    await page.evaluate((p) => { Date.now = () => Date.parse(p) + 3 * 24 * 3600 * 1000 }, pub('dsh-film'))
    await page.evaluate(() => document.querySelector('.card[data-id=dsh-film] .btn.warn').click())
    await page.waitForSelector('[data-testid=confirm]')
    ok('update confirm shows from -> to and the plain reassurance (clock pinned past the first day, so no cooldown warning)', (await text(page)).includes('0.2.0 → ' + ver('dsh-film')) && (await text(page)).includes('更新不会改动你的工作区里的项目文件') && !(await page.evaluate(() => !!document.querySelector('[data-testid=cooldown-note]'))))
    await shot(page, '15-update-confirm')
    await click(page, '[data-testid=confirm]'); await waitText(page, '安装完成')
    ok('update installs the exact catalog version', (await calls(page)).some((c) => c[0] === 'installBundle' && c[1] === spec('dsh-film')))
    await page.close()
  }

  // 11 ── community tab (the marketplace companion)
  {
    const { page } = await boot()
    await click(page, '[data-tab=community]'); await sleep(100)
    ok('community tab without the market offers a one-click install', (await text(page)).includes('一键安装插件市场'))
    await shot(page, '16-community-empty')
    await clickText(page, '一键安装插件市场', '.empty'); await page.waitForSelector('[data-testid=confirm]')
    await click(page, '[data-testid=confirm]'); await waitText(page, '安装完成')
    ok('market installed as a plain companion (exact catalog version)', (await calls(page)).some((c) => c[0] === 'installBundle' && c[1] === 'dshmarket@1.66.8'))
    ok('the market is a companion: the suite never installs it', !(await calls(page)).some((c) => c[0] === 'installBundle' && c[1] !== 'dshmarket@1.66.8'), 'only the market itself was installed')
    await page.close()
  }
  {
    const { page } = await boot({ initial: [{ name: 'dshmarket', version: '1.66.8' }], market: true })
    await click(page, '[data-tab=community]'); await sleep(150)
    ok('community tab embeds the market UI when it exposes render()', await page.evaluate(() => !!document.querySelector('[data-testid=market-embed]')))
    await shot(page, '17-community-embedded'); await page.close()
  }
  {
    const { page } = await boot({ initial: [{ name: 'dshmarket', version: '1.66.8' }], market: false })
    await click(page, '[data-tab=community]'); await sleep(150)
    ok('if the market cannot be embedded, the tab says so instead of showing nothing', await page.evaluate(() => !!document.querySelector('[data-testid=no-embed]')))
    await page.close()
  }

  // 12 ── resilience: pluginManager missing / listBundles failing
  {
    const { page } = await boot()
    await page.evaluate(() => { window.__pm.listBundles = async () => ({ ok: false, error: { message: 'down' } }); window.mountPanel() }); await sleep(300)
    ok('plugin manager unavailable -> clear message, install buttons disabled, no crash', (await page.evaluate(() => !!document.querySelector('[data-testid=no-manager]'))) && (await page.evaluate(() => [...document.querySelectorAll('.card .btn.primary')].every((b) => b.disabled))))
    await shot(page, '18-no-manager'); await page.close()
  }

  // 13 ── details drawer
  {
    const { page } = await boot()
    await page.evaluate(() => document.querySelector('.card[data-id=dshmarket]').click()); await page.waitForSelector('[data-testid=drawer]')
    const t = await text(page)
    ok('drawer shows permissions, review status and compatibility for a community plugin', t.includes('权限与费用') && t.includes('本中心未审查其代码') && t.includes('可能兼容'))
    await shot(page, '19-drawer'); await page.close()
  }

  // 13b ── declared relations in the drawer, and the old canvas
  {
    const { page, errs } = await boot({ initial: [{ name: 'dsh-film', version: '0.1.4' }, { name: VD, version: '0.2.1' }] })
    await page.evaluate(() => document.querySelector('.card[data-id="dsh-film"]').click()); await page.waitForSelector('[data-testid=drawer]')
    const rels = await page.evaluate(() => [...document.querySelectorAll('[data-testid^=rel-] .rel')]
      .map((r) => ({ id: r.dataset.rel, role: r.querySelector('.tag')?.textContent, state: r.querySelector('.rs')?.textContent, action: r.querySelector('.lnk')?.textContent })))
    ok('every declared relation names its role, what the Host has, and one way to it',
      rels.length >= 2 // account (required) + viewer (partner)
      && rels.every((r) => !!r.role && !!r.state && (r.action === '查看' || r.action === '查看与配置')), JSON.stringify(rels))
    ok('an installed relation offers view-and-configure; a missing one offers view',
      rels.find((r) => r.id === VD)?.action === '查看与配置' && rels.find((r) => r.id === MV)?.action === '查看', JSON.stringify(rels))
    ok('no relation carries an install button (nothing can be installed twice)',
      (await page.evaluate(() => document.querySelectorAll('[data-testid^=rel-] button').length)) === rels.length
      && !(await page.evaluate(() => [...document.querySelectorAll('[data-testid^=rel-] button')].some((b) => /安装/.test(b.textContent)))))
    const t = await text(page)
    ok('an installed 0.1 canvas says so and promises the work is kept', t.includes('旧画布') && t.includes('film/ 作品'))
    await shot(page, '19b-relations')
    await click(page, '[data-testid=old-canvas-upgrade]'); await page.waitForSelector('[data-testid=confirm]')
    const upgrade = await text(page)
    ok('the upgrade goes through the ordinary confirm, is named as an update, and installs nothing yet',
      upgrade.includes('更新到') && (await calls(page)).every((c) => c[0] !== 'installBundle'), upgrade.slice(0, 80))
    await clickText(page, '取消')
    // A relation itself opens the other plugin's own page: the same drawer state, no new navigation.
    await page.evaluate(() => document.querySelector('.card[data-id="dsh-film"]').click()); await page.waitForSelector('[data-testid=drawer]')
    await page.evaluate((mv) => [...document.querySelectorAll('[data-testid=rel-partners] .rel')].find((r) => r.dataset.rel === mv)?.querySelector('.lnk')?.click(), MV)
    await sleep(80)
    ok('following a relation opens that plugin\'s own page', (await text(page)).includes('媒体预览') && (await page.evaluate(() => !!document.querySelector('[data-testid=drawer]'))))
    ok('no page errors while drawing relations', errs.length === 0, errs.join('; '))
    await page.close()
  }

  // 14 ── English + dark
  {
    const { page } = await boot({ locale: 'en', initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    const t = await text(page)
    ok('English UI uses the catalog English text', t.includes('VibeDev Ecosystem') && t.includes('Install the suite') && t.includes('Needs a VibeDev account') && !/[\u4e00-\u9fff]/.test(t), (t.match(/[\u4e00-\u9fff]+/g) || []).slice(0, 5).join('|'))
    await shot(page, '20-english'); await page.close()
  }
  {
    const { page } = await boot({ dark: true, initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    await shot(page, '21-dark'); await page.close()
  }
  // 15 ── regressions found by the REAL-GUI self-check (the fake host had hidden all three)
  {
    // The real getLocale() is { active, locales } (the bench now returns that shape). A Chinese user must get Chinese.
    const { page } = await boot({ locale: 'zh', initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    const t = await text(page)
    ok('REAL locale shape: a zh user gets the Chinese UI (it rendered English in the real GUI)', t.includes('VibeDev 生态') && t.includes('一键安装套装') && !t.includes('Install the suite'))
    await page.evaluate(() => window.__setLocale('en')); await sleep(200)
    ok('switching language while the panel is open re-renders it', (await text(page)).includes('Install the suite') && !(await text(page)).includes('一键安装套装'))
    await page.evaluate(() => window.__setLocale('zh')); await sleep(200)
    ok('and switches back', (await text(page)).includes('一键安装套装'))
    await page.close()
  }
  {
    // Registry: the official page asks the host for the fastest one; so must we, once per run, for inspect AND install.
    const { page } = await boot({ initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    await clickText(page, '一键安装套装'); await page.waitForSelector('[data-testid=confirm]'); await click(page, '[data-testid=confirm]'); await waitText(page, '安装完成')
    const c = await calls(page)
    ok('the fastest registry reported by the host is used for every inspect and install', c.filter((x) => x[0] === 'inspect' || x[0] === 'installBundle').every((x) => x[2].registry === 'https://registry.npmmirror.com/'), JSON.stringify(c.filter((x) => x[0] === 'inspect').map((x) => x[2])))
    ok('the probe is asked once per run, not once per plugin', (await page.evaluate(() => window.__probeCalls)) === 1)
    await page.close()
  }
  {
    const { page } = await boot({ delay: 120, initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    await clickText(page, '一键安装套装'); await page.waitForSelector('[data-testid=confirm]'); await click(page, '[data-testid=confirm]')
    await page.waitForFunction(() => document.body.innerText.includes('registry: https://registry.npmmirror.com'), { timeout: 10000 })
    ok('the chosen registry is shown in the progress log', true)
    await page.close()
  }
  {
    const { page } = await boot({ noProbe: true, initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    await clickText(page, '一键安装套装'); await page.waitForSelector('[data-testid=confirm]'); await click(page, '[data-testid=confirm]'); await waitText(page, '安装完成')
    ok('without a registry probe the install still works, on the host default', (await calls(page)).filter((x) => x[0] === 'inspect').every((x) => x[2].registry === null))
    await page.close()
  }
  {
    const { page } = await boot({ fastest: null, initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    await clickText(page, '一键安装套装'); await page.waitForSelector('[data-testid=confirm]'); await click(page, '[data-testid=confirm]'); await waitText(page, '安装完成')
    ok('a probe that finds nothing falls back to the host default', (await calls(page)).filter((x) => x[0] === 'inspect').every((x) => x[2].registry === null))
    await page.close()
  }
  {
    // What the real host really answered on this machine: one registry, timed out. The text must not claim more than that.
    const realAnswer = { status: 'refused', problem: 'network', reason: 'pnpm view timed out after 20000ms', registries: [null] }
    const { page } = await boot({ scenarios: { [VD]: { inspect: realAnswer } } })
    await page.evaluate((id) => document.querySelector(`.card[data-id="${id}"] .btn.primary`).click(), VD); await page.waitForSelector('[data-testid=confirm]'); await click(page, '[data-testid=confirm]')
    await page.waitForSelector('[data-testid=fail]')
    const t = await text(page)
    ok('network text reports ONE registry honestly and shows the host reason', t.includes('没能连上 npm 源') && t.includes('timed out after 20000ms') && !t.includes('已依次尝试'), t.match(/没能连上[^\n]*/)?.[0])
    await shot(page, '22-network-honest'); await page.close()
  }
  {
    const two = { status: 'refused', problem: 'network', reason: 'ETIMEDOUT', registries: [null, 'https://registry.npmmirror.com'] }
    const { page } = await boot({ scenarios: { [VD]: { inspect: two } } })
    await page.evaluate((id) => document.querySelector(`.card[data-id="${id}"] .btn.primary`).click(), VD); await page.waitForSelector('[data-testid=confirm]'); await click(page, '[data-testid=confirm]')
    await page.waitForSelector('[data-testid=fail]')
    ok('when the host really tried two registries, the text says so', (await text(page)).includes('已依次尝试 2 个源'))
    await page.close()
  }
  // 16 ── found when a user could not see the entry, and by reading the real screenshot
  {
    const { page } = await boot({ locale: 'zh' })
    const label = await page.evaluate(() => window.__reg.slots.filter((s) => s.decl && s.decl.name === 'sidebar.panellist')[0].decl.label())
    ok('sidebar entry is labelled "VibeDev 生态" (the panel is the ecosystem, not only a plugin centre), not a bare "VibeDev" that hides next to the brand name', label === 'VibeDev 生态', label)
    await page.evaluate(() => window.__setLocale('en'))
    ok('the sidebar label follows the language', (await page.evaluate(() => window.__reg.slots.filter((s) => s.decl && s.decl.name === 'sidebar.panellist')[0].decl.label())) === 'VibeDev Ecosystem')
    await page.close()
  }
  {
    // YOUR machine: pnpm already defaults to the mirror -> the official page does not probe, and neither may we.
    const { page } = await boot({ resolved: 'https://registry.npmmirror.com', initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    await clickText(page, '一键安装套装'); await page.waitForSelector('[data-testid=confirm]'); await click(page, '[data-testid=confirm]'); await waitText(page, '安装完成')
    ok('pnpm already on the mirror: no probe call, host default used throughout', (await page.evaluate(() => window.__probeCalls || 0)) === 0 && (await calls(page)).filter((x) => x[0] === 'inspect' || x[0] === 'installBundle').every((x) => x[2].registry === null))
    await page.close()
  }
  {
    const { page } = await boot({ fastest: 'https://registry.npmjs.org/', initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    await clickText(page, '一键安装套装'); await page.waitForSelector('[data-testid=confirm]'); await click(page, '[data-testid=confirm]'); await waitText(page, '安装完成')
    ok('if the official registry is the fastest, the mirror is NOT forced', (await calls(page)).filter((x) => x[0] === 'inspect').every((x) => x[2].registry === null))
    await page.close()
  }
  {
    // The registry probe is read through ctx.inject, as the real host demands; reading it directly throws there.
    const { page, errs } = await boot({ noProbe: true })
    ok('a host without the probe service still loads and renders', (await page.evaluate(() => document.querySelectorAll('.card').length)) === 5 && errs.length === 0, errs.join('; '))
    await page.close()
  }
  // contrast of the label on primary buttons, light theme and dark theme, and a live theme switch
  const btnColor = (page) => page.evaluate(() => { const b = document.querySelector('.btn.primary'); const s = getComputedStyle(b); return { color: s.color, bg: s.backgroundColor } })
  const lum = (rgb) => { const m = /(\d+)[, ]+(\d+)[, ]+(\d+)/.exec(rgb); const [r, g, b] = [m[1], m[2], m[3]].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  {
    const { page } = await boot({ brand: '#0f1115', initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    const c = await btnColor(page)
    ok('REAL light theme (brand #0f1115): primary button text is light and readable', lum(c.color) > 0.5 && ratio(c.color, c.bg) >= 4.5, `${c.color} on ${c.bg} = ${ratio(c.color, c.bg).toFixed(1)}:1`)
    await shot(page, '23-light-real-brand')
    await page.close()
  }
  {
    const { page } = await boot({ dark: true, brand: '#e8eaf0', initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    const c = await btnColor(page)
    ok('dark theme with a LIGHT brand: primary button text turns dark (white-on-white would be unreadable)', lum(c.color) < 0.2 && ratio(c.color, c.bg) >= 4.5, `${c.color} on ${c.bg} = ${ratio(c.color, c.bg).toFixed(1)}:1`)
    await shot(page, '24-dark-light-brand')
    await page.close()
  }
  {
    const { page } = await boot({ brand: '#4d6bfe', initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    const c = await btnColor(page)
    ok('a mid-tone brand (the worst case for contrast) still reaches 4.5:1', ratio(c.color, c.bg) >= 4.5, `${c.color} on ${c.bg} = ${ratio(c.color, c.bg).toFixed(2)}:1`)
    await page.close()
  }
  {
    const { page } = await boot({ brand: '#0f1115', initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    await page.evaluate(() => document.documentElement.style.setProperty('--dsw-alias-brand-primary', '#e8eaf0'))
    await page.waitForFunction(() => { const s = getComputedStyle(document.querySelector('.btn.primary')); return /^rgb\(0, 0, 0\)/.test(s.color) }, { timeout: 5000 })
    ok('switching the theme while the panel is open re-picks the label colour (no reload)', true)
    await page.close()
  }
  // 17 ── the flash: the self-check must never switch the user's visible panel unless explicitly asked to
  const runSelfCheck = async (config) => {
    benchState.config = config; benchState.reports.length = 0
    const { page } = await boot({ initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    await page.waitForFunction(() => true)
    const t0 = Date.now()
    while (Date.now() - t0 < 9000 && !benchState.reports.length && config.selfcheck) await sleep(250)
    await sleep(config.selfcheck ? 400 : 3500) // when it is off, wait past the 2.5 s start delay to prove nothing happens
    const out = { switches: await page.evaluate(() => window.__panelSwitches || []), report: benchState.reports[0] }
    await page.close()
    return out
  }
  {
    const r = await runSelfCheck({ selfcheck: false, mount: false })
    ok('self-check OFF: no panel switch and no report at all', r.switches.length === 0 && !r.report, JSON.stringify(r.switches))
  }
  {
    const r = await runSelfCheck({ selfcheck: true, mount: false })
    ok('self-check ON, mount off: it reports, but NEVER switches the visible panel (the cause of the flash)', !!r.report && r.switches.length === 0, JSON.stringify(r.switches))
    ok('...and the report says the mount check was skipped, honestly', typeof r.report?.checks?.['panel.mounted'] === 'string' && /skipped/.test(r.report.checks['panel.mounted']), String(r.report?.checks?.['panel.mounted']))
    ok('...while still reading the non-visible facts (pluginManager, listBundles)', r.report?.checks?.['pluginManager.present'] === true && r.report?.checks?.listBundles?.ok === true)
  }
  {
    const r = await runSelfCheck({ selfcheck: true, mount: true })
    ok('self-check ON + mount ON: it switches to the center and then BACK to the previous panel', r.switches.length === 2 && r.switches[0] === 'vibedev-center' && r.switches[1] === 'conversation', JSON.stringify(r.switches))
    ok('...and reports the panel mounted', r.report?.checks?.['panel.mounted'] === true)
  }
  {
    // A page that merely renders (no self-check) must not even ask for config more than once per load.
    benchState.config = { selfcheck: false, mount: false }; benchState.configHits = 0
    const { page } = await boot()
    await sleep(3500)
    ok('a normal load asks the host for the self-check config exactly once', benchState.configHits === 1, `hits=${benchState.configHits}`)
    await page.close()
  }
  // 18 ── found by a real crash: the "reload the page" button pressed seconds after a 4-plugin install
  {
    const { page } = await boot({ initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    let navs = 0; page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs++ })
    await clickText(page, '一键安装套装'); await page.waitForSelector('[data-testid=confirm]'); await click(page, '[data-testid=confirm]'); await waitText(page, '安装完成')
    const t = await text(page)
    const buttons = await page.evaluate(() => [...document.querySelectorAll('.modal button')].map((b) => b.textContent.trim()))
    ok('the done screen has NO reload / refresh button (the official page has none either)', !buttons.some((b) => /刷新|Reload|重新加载/.test(b)), buttons.join(' | '))
    ok('it says plainly that no reload is needed, and what to do if nothing appears', t.includes('不需要刷新页面') && t.includes('完全退出并重新打开 VibeDev'))
    ok('its only action is a plain "知道了"', buttons.includes('知道了'))
    await click(page, '[data-testid=done]'); await sleep(200)
    ok('the page itself was never navigated or reloaded by the center', navs === 0, `navigations=${navs}`)
    await shot(page, '25-done-no-reload'); await page.close()
  }
  {
    // Final settle: the result must not appear while the host is still sending changes.
    const { page } = await boot({ settle: { between: { quietMs: 20, maxMs: 200 }, final: { quietMs: 500, maxMs: 4000 } }, initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }, { name: VD, version: ver(VD) }, { name: 'dsh-film', version: ver('dsh-film') }] })
    await page.evaluate(() => { document.querySelector('.card[data-id="@vibedev-si/dsh-media-viewer"] .btn.primary').click() })
    await page.waitForSelector('[data-testid=confirm]'); await click(page, '[data-testid=confirm]')
    await page.waitForFunction(() => /等 VibeDev 加载完/.test(document.body.innerText), { timeout: 8000 })
    ok('after the last plugin the center says it is waiting for VibeDev to finish loading', true)
    let tLast = 0
    for (let i = 0; i < 8; i++) { await page.evaluate(() => window.__fireChanged()); tLast = Date.now(); await sleep(150) }   // the host keeps updating for about 1 s
    const stillWaiting = await page.evaluate(() => /等 VibeDev 加载完/.test(document.body.innerText) && !document.body.innerText.includes('安装完成'))
    ok('while the host keeps sending changes the center does NOT yet show "done"', stillWaiting)
    await waitText(page, '安装完成', 6000)
    const quietFor = Date.now() - tLast
    ok('...and shows it only after the host has been quiet for the full quiet period (500 ms) since its LAST change', quietFor >= 480, `quiet for ${quietFor} ms before done`)
    await page.close()
  }
  {
    const { page } = await boot({ settle: { between: { quietMs: 20, maxMs: 200 }, final: { quietMs: 300, maxMs: 900 } }, initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }, { name: VD, version: ver(VD) }, { name: 'dsh-film', version: ver('dsh-film') }] })
    await page.evaluate(() => { document.querySelector('.card[data-id="@vibedev-si/dsh-media-viewer"] .btn.primary').click() })
    await page.waitForSelector('[data-testid=confirm]'); await click(page, '[data-testid=confirm]')
    await page.waitForFunction(() => /等 VibeDev 加载完/.test(document.body.innerText), { timeout: 8000 })
    const t0 = Date.now(); const iv = setInterval(() => page.evaluate(() => window.__fireChanged()).catch(() => {}), 60)
    await waitText(page, '安装完成', 6000); clearInterval(iv)
    ok('a host that never goes quiet cannot hold the result back beyond maxMs', Date.now() - t0 < 2500, `${Date.now() - t0} ms`)
    await page.close()
  }
  {
    // Between plugins: the next plugin is not touched while the host is still applying the previous one.
    const { page } = await boot({ settle: { between: { quietMs: 400, maxMs: 3000 }, final: { quietMs: 20, maxMs: 200 } }, initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    await page.evaluate(() => { const pm = window.__pm; window.__t = []; for (const k of ['inspect', 'installBundle', 'setBundleEnabled']) { const o = pm[k].bind(pm); pm[k] = (...a) => { window.__t.push([k, String(a[0]), Date.now()]); return o(...a) } } })
    await clickText(page, '一键安装套装'); await page.waitForSelector('[data-testid=confirm]'); await click(page, '[data-testid=confirm]')
    await page.waitForFunction(() => window.__t.some((x) => x[0] === 'setBundleEnabled' && x[1] === '@vibedev-si/dsh-vibedev'), { timeout: 8000 })
    const tEnabled = await page.evaluate(() => window.__t.find((x) => x[0] === 'setBundleEnabled' && x[1] === '@vibedev-si/dsh-vibedev')[2])
    let tBusyEnd = 0
    for (let i = 0; i < 6; i++) { await page.evaluate(() => window.__fireChanged()); tBusyEnd = Date.now(); await sleep(100) }   // host busy for about 0.5 s
    await waitText(page, '安装完成', 10000)
    const next = await page.evaluate(() => window.__t.find((x) => x[0] === 'inspect' && x[1].startsWith('dsh-film'))[2])
    ok('the next plugin starts only after the host has been quiet for the full pause (400 ms) since its LAST change', next - tBusyEnd >= 380, `${next - tBusyEnd} ms after the last host change`)
    await page.close()
  }
  {
    // A failed run has nothing left to apply: it must not make the user wait for the host.
    const { page } = await boot({ settle: { between: { quietMs: 20, maxMs: 200 }, final: { quietMs: 5000, maxMs: 20000 } }, scenarios: { 'dsh-film': { network: true } }, initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    const t0 = Date.now()
    await clickText(page, '一键安装套装'); await page.waitForSelector('[data-testid=confirm]'); await click(page, '[data-testid=confirm]')
    await page.waitForSelector('[data-testid=fail]', { timeout: 8000 })
    ok('a failed install shows its error at once, without the final wait', Date.now() - t0 < 3000, `${Date.now() - t0} ms`)
    await page.close()
  }

  // 19 ── "does the center itself have a newer version?": the panel reads the allow-list once when it mounts,
    // and again only when the user clicks. Never on a timer, and concurrent clicks share one batch.
  const SELF = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version
  const bumpPatch = (v, d) => { const [a, b, c] = v.split('.').map(Number); return a + '.' + b + '.' + (c + d) }
  const NEWER = bumpPatch(SELF, 1)
  const OLD_PUB = '2026-01-01T00:00:00.000Z'
  const selfBanner = (page) => page.evaluate(() => { const el = document.querySelector('[data-testid=self-update]'); return el ? { kind: el.dataset.kind, text: el.innerText } : null })
  const checkNow = async (page) => { await click(page, '[data-testid=check-update]'); await page.waitForFunction(() => { const el = document.querySelector('[data-testid=self-update]'); return el && el.dataset.kind !== 'checking' }, { timeout: 8000 }) }
  {
    benchState.latest = { ok: true, latest: NEWER, publishedAt: OLD_PUB, sources: [] }; benchState.latestHits = 0; benchState.latestDelay = 0; benchState.updatesHits = 0; benchState.updatesDelay = 0
    const { page } = await boot({ initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    await sleep(3200)
    ok('PRIVACY: opening the panel makes exactly ONE batch of version reads (the four allow-listed packages), and nothing on a timer', benchState.updatesHits === 1, 'hits=' + benchState.updatesHits)
    ok('the header shows which version of the center is running', (await page.evaluate(() => document.querySelector('[data-testid=version]')?.textContent)) === 'v' + SELF)
    ok('there is a "检查更新" button', (await page.evaluate(() => document.querySelector('[data-testid=check-update]')?.textContent)) === '检查更新')
    await page.close()
  }
  {
    benchState.latest = { ok: true, latest: NEWER, publishedAt: OLD_PUB, sources: [] }; benchState.latestHits = 0; benchState.updatesHits = 0
    const { page } = await boot({ initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    await page.evaluate(() => { window.__copied = null; window.__opened = null; Object.defineProperty(navigator, 'clipboard', { value: { writeText: (x) => { window.__copied = x; return Promise.resolve() } }, configurable: true }); window.open = (u) => { window.__opened = u } })
    await checkNow(page)
    const b = await selfBanner(page)
    ok('a newer version on npm is announced with both versions', b.kind === 'newer' && b.text.includes(NEWER) && b.text.includes(SELF), b.text.split('\n')[0])
    ok('it says plainly that the center cannot update itself, and how to update', b.text.includes('不能给自己更新') && b.text.includes('卸载') && b.text.includes('完全退出并重新打开 VibeDev'))
    ok('the package name shown includes the @vibedev-si/ scope (leaving it out is what a user tripped on)', (await page.evaluate(() => document.querySelector('[data-testid=self-pkg]').textContent)) === '@vibedev-si/dsh-ecosystem')
    ok('an old release has NO cooldown warning', !(await page.evaluate(() => !!document.querySelector('[data-testid=self-cooldown]'))))
    await click(page, '[data-testid=copy-self]'); await sleep(100)
    ok('"复制包名" puts exactly the full package name on the clipboard', (await page.evaluate(() => window.__copied)) === '@vibedev-si/dsh-ecosystem')
    ok('...and the button confirms it', (await page.evaluate(() => document.querySelector('[data-testid=copy-self]').textContent)) === '已复制')
    await click(page, '[data-testid=view-self]')
    ok('"查看这个版本" opens that exact tag in the repo', (await page.evaluate(() => window.__opened)) === 'https://github.com/VibeDev-Si/dsh-ecosystem/tree/v' + NEWER, await page.evaluate(() => window.__opened))
    await shot(page, '26-self-update-newer')
    await click(page, '.vdc [data-testid=self-update] .x'); await sleep(100)
    ok('the × dismisses the banner', (await selfBanner(page)) === null)
    await checkNow(page)
    ok('checking again asks again (the mount read plus one per deliberate click, nothing in between)', benchState.updatesHits === 3, 'hits=' + benchState.updatesHits)
    await page.close()
  }
  {
    // A release younger than a day: pnpm's cooldown. Pin the clock so this does not depend on when the test runs.
    const pub = '2026-10-05T14:40:00.000Z'
    benchState.latest = { ok: true, latest: NEWER, publishedAt: pub, sources: [] }
    const { page } = await boot({ initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    await page.evaluate((p) => { Date.now = () => Date.parse(p) + 2 * 3600 * 1000 }, pub)
    await checkNow(page)
    const endText = await page.evaluate((p) => new Date(Date.parse(p) + 24 * 3600 * 1000).toLocaleString(), pub)
    const cd = await page.evaluate(() => document.querySelector('[data-testid=self-cooldown]')?.innerText || null)
    ok('a release under a day old shows the cooldown warning', !!cd && cd.includes('pnpm') && cd.includes('可能被拦住'), cd)
    ok('...with the exact time the cooldown ends', !!cd && cd.includes(endText), endText)
    await shot(page, '27-self-update-cooldown')
    await page.evaluate((p) => { Date.now = () => Date.parse(p) + 25 * 3600 * 1000 }, pub)
    await click(page, '.vdc [data-testid=self-update] .x'); await checkNow(page)
    ok('the same release a day later has no warning', !(await page.evaluate(() => !!document.querySelector('[data-testid=self-cooldown]'))))
    await page.close()
  }
  {
    benchState.latest = { ok: true, latest: SELF, publishedAt: OLD_PUB, sources: [] }
    const { page } = await boot()
    await checkNow(page); const b = await selfBanner(page)
    ok('the same version says it is up to date', b.kind === 'same' && b.text.includes('已是最新版本') && b.text.includes(SELF), b.text)
    await page.close()
    benchState.latest = { ok: true, latest: bumpPatch(SELF, -1), publishedAt: OLD_PUB, sources: [] }
    const q = await boot(); await checkNow(q.page); const c = await selfBanner(q.page)
    ok('a LOWER version on npm (a local build) is never called "newer"', c.kind === 'ahead' && !c.text.includes('有新版本'), c.text)
    await q.page.close()
  }
  {
    // Failures must never be shown as "up to date".
    const cases = [
      ['both registries failed', { ok: false, sources: [{ registry: 'https://registry.npmjs.org/', error: 'timeout' }, { registry: 'https://registry.npmmirror.com/', error: 'HTTP 503' }] }],
      ['the host route itself answered 500', 500],
      ['the host route answered nonsense', { hello: 'world' }],
    ]
    for (const [name, answer] of cases) {
      benchState.latest = answer
      const { page } = await boot()
      await checkNow(page); const b = await selfBanner(page)
      ok('failure "' + name + '": reported as unavailable, NEVER as up to date', b.kind === 'unavailable' && b.text.includes('没能读取最新版本') && !b.text.includes('已是最新版本') && b.text.includes('这不代表你是最新的'), b.text.replace(/\n/g, ' | ').slice(0, 120))
      if (typeof answer === 'object' && answer.sources) ok('...and names which registry failed and why', b.text.includes('registry.npmjs.org (timeout)') && b.text.includes('registry.npmmirror.com (HTTP 503)'))
      await page.close()
    }
  }
  {
    // Hostile content in the answer must not reach the DOM or a link.
    benchState.latest = { ok: true, latest: '9.9.9"><img src=x onerror="window.__pwned=1">', publishedAt: OLD_PUB, sources: [] }
    const { page } = await boot()
    await checkNow(page); await sleep(200)
    ok('SAFETY: a hostile version string is refused, not rendered, and runs nothing', (await selfBanner(page)).kind === 'unavailable' && !(await page.evaluate(() => window.__pwned)) && !(await page.evaluate(() => !!document.querySelector('.vdc img'))))
    await page.close()
    benchState.latest = { ok: true, latest: NEWER, publishedAt: 'whenever <b>', sources: [] }
    const q = await boot(); await checkNow(q.page)
    ok('a garbage publish time is ignored: still announces the version, no warning, no crash', (await selfBanner(q.page)).kind === 'newer' && !(await q.page.evaluate(() => !!document.querySelector('[data-testid=self-cooldown]'))))
    await q.page.close()
  }
  {
    benchState.latest = { ok: true, latest: NEWER, publishedAt: OLD_PUB, sources: [] }; benchState.latestDelay = 500
    const { page } = await boot()
    await click(page, '[data-testid=check-update]'); await sleep(150)
    ok('while checking: a spinner is shown and the button cannot be pressed twice', (await selfBanner(page))?.kind === 'checking' && (await page.evaluate(() => document.querySelector('[data-testid=check-update]').disabled)))
    await page.waitForFunction(() => document.querySelector('[data-testid=self-update]')?.dataset.kind === 'newer', { timeout: 6000 })
    benchState.latestDelay = 0; await page.close()
  }
  {
    benchState.latest = { ok: true, latest: NEWER, publishedAt: OLD_PUB, sources: [] }
    const { page } = await boot({ locale: 'en' })
    const label = await page.evaluate(() => document.querySelector('[data-testid=check-update]').textContent)
    await checkNow(page); const b = await selfBanner(page)
    ok('English UI: button and banner are fully English', label === 'Check for updates' && b.kind === 'newer' && !/[\u4e00-\u9fff]/.test(b.text) && b.text.includes('cannot update itself') && b.text.includes('@vibedev-si/'), label + ' / ' + b.text.split('\n')[0])
    await shot(page, '28-self-update-english'); await page.close()
  }
  {
    // The update confirm: the old sentence claimed the center "installs the exact version". Say what is actually true.
    const VIEWER = '@vibedev-si/dsh-media-viewer'
    const pub = CATALOG.plugins.find((p) => p.id === VIEWER).publishedAt
    const mk = async (offsetH) => {
      const { page } = await boot({ initial: [{ name: VIEWER, version: '0.1.0' }, { name: 'dsh-better-sidebar', version: '0.24.1' }] })
      await page.evaluate((p, h) => { Date.now = () => Date.parse(p) + h * 3600 * 1000 }, pub, offsetH)
      await page.evaluate((id) => document.querySelector('.card[data-id="' + id + '"] .btn.warn').click(), VIEWER)
      await page.waitForSelector('[data-testid=confirm]')
      return page
    }
    const inside = await mk(2)
    const endText = await inside.evaluate((p) => new Date(Date.parse(p) + 24 * 3600 * 1000).toLocaleString(), pub)
    const note = await inside.evaluate(() => document.querySelector('[data-testid=cooldown-note]')?.innerText || null)
    ok('update confirm inside the cooldown: names the plugin and version, explains the duplicate-rule risk, gives the end time', !!note && note.includes('媒体预览与画廊 ' + ver(VIEWER)) && note.includes('同名') && note.includes('可能被拦住') && note.includes(endText), note)
    ok('the old, inaccurate sentence is gone', !(await text(inside)).includes('会按确切版本安装'))
    await shot(inside, '29-update-confirm-cooldown'); await inside.close()
    const outside = await mk(25)
    ok('update confirm after the cooldown: no warning, just the plain reassurance', !(await outside.evaluate(() => !!document.querySelector('[data-testid=cooldown-note]'))) && (await text(outside)).includes('更新不会改动你的工作区里的项目文件'))
    await outside.close()
  }

  // 20 ── the desktop boot crash: a page reloaded after a plugin it had at start was replaced. Warn; never offer a reload.
  const noRefresh = (page) => page.evaluate(() => { const el = document.querySelector('[data-testid=no-refresh]'); return el ? el.innerText : null })
  const bundle = (name, version) => ({ name, version, installed: true, enabled: true })
  const setBundles = (page, list, fire = true) => page.evaluate((l, f) => { const m = window.__pm.bundles; m.clear(); for (const b of l) m.set(b.name, b); if (f) window.__fireChanged() }, list, fire)
  {
    // YOUR run: the four plugins were there when VibeDev started, were all uninstalled, then installed again.
    const four = [bundle(VD, '0.2.0'), bundle('dsh-film', '0.3.0'), bundle('@vibedev-si/dsh-media-viewer', '0.1.0'), bundle('@vibedev-si/dsh-ecosystem', '0.1.1')]
    const { page } = await boot({ initial: four })
    ok('at the start there is no notice (the first look is only a baseline)', (await noRefresh(page)) === null)
    await setBundles(page, []); await sleep(150)
    ok('removing them all raises no alarm yet (a removed plugin is not loaded again)', (await noRefresh(page)) === null)
    await setBundles(page, four); await sleep(200)
    const n = await noRefresh(page)
    ok('putting them back raises the notice, naming every plugin', !!n && n.includes('VibeDev 账号与模型') && n.includes('VibeDev 影视工作台') && n.includes('媒体预览与画廊'), n && n.replace(/\n/g, ' | ').slice(0, 160))
    ok('it says not to reload, why, and to restart', !!n && n.includes('请不要刷新页面') && n.includes('启动那一刻的插件清单') && n.includes('完全退出并重新打开 VibeDev'))
    ok('there is nothing on the page that reloads it', !(await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => /刷新|Reload/.test(b.textContent)))))
    await shot(page, '30-no-refresh-notice'); await page.close()
  }
  {
    // The normal first-time install of the whole suite must stay silent: those plugins were not loaded at start.
    const { page } = await boot({ initial: [bundle('dsh-better-sidebar', '0.24.1')] })
    await clickText(page, '一键安装套装'); await page.waitForSelector('[data-testid=confirm]'); await click(page, '[data-testid=confirm]'); await waitText(page, '安装完成'); await sleep(200)
    ok('a first-time suite install does NOT show the notice (it was safe on the real machine)', (await noRefresh(page)) === null)
    await page.close()
  }
  {
    // An update replaces files of a plugin that was loaded at start.
    const { page } = await boot({ initial: [bundle('dsh-film', '0.2.0'), bundle('dsh-better-sidebar', '0.24.1')] })
    await page.evaluate(() => document.querySelector('.card[data-id=dsh-film] .btn.warn').click()); await page.waitForSelector('[data-testid=confirm]'); await click(page, '[data-testid=confirm]'); await waitText(page, '安装')
    await page.waitForFunction(() => !!document.querySelector('[data-testid=no-refresh]'), { timeout: 8000 })
    ok('an update through the center raises the notice', (await noRefresh(page)).includes('VibeDev 影视工作台'))
    await page.close()
  }
  {
    // The migration: the old package goes away, the new one is new. Neither was "put back".
    const { page } = await boot({ initial: [bundle('dsh-media-viewer', '0.1.0'), bundle('dsh-better-sidebar', '0.24.1')] })
    await clickText(page, '一键切换'); await page.waitForSelector('[data-testid=mig-result]', { timeout: 10000 }); await sleep(200)
    ok('migrating the old package name does NOT show the notice', (await noRefresh(page)) === null)
    await page.close()
  }
  {
    // Disabling and enabling touch no files.
    const { page } = await boot({ initial: [bundle('dsh-film', '0.3.0'), bundle('dsh-better-sidebar', '0.24.1')] })
    await setBundles(page, [{ ...bundle('dsh-film', '0.3.0'), enabled: false }, bundle('dsh-better-sidebar', '0.24.1')]); await sleep(120)
    await setBundles(page, [bundle('dsh-film', '0.3.0'), bundle('dsh-better-sidebar', '0.24.1')]); await sleep(150)
    ok('disabling and enabling a plugin does NOT show the notice', (await noRefresh(page)) === null)
    await page.close()
  }
  {
    // A hostile plugin name is shown as text, never as markup.
    const evil = '<img src=x onerror="window.__pwned=1">'
    const { page } = await boot({ initial: [bundle(evil, '1.0.0')] })
    await setBundles(page, [bundle(evil, '1.0.1')]); await sleep(200)
    ok('a hostile plugin name is rendered as text and runs nothing', (await noRefresh(page)).includes('<img src=x') && !(await page.evaluate(() => window.__pwned)) && !(await page.evaluate(() => !!document.querySelector('[data-testid=no-refresh] img'))))
    await page.close()
  }
  {
    const { page } = await boot({ locale: 'en', initial: [bundle('dsh-film', '0.2.0')] })
    await setBundles(page, [bundle('dsh-film', '0.3.0')]); await sleep(200)
    const n = await noRefresh(page)
    ok('English notice is fully English', !!n && !/[\u4e00-\u9fff]/.test(n) && n.includes('Do not reload the page') && n.includes('quit VibeDev completely'), n && n.slice(0, 90))
    await page.close()
  }

  // Account plugin supplied by the app, enabled by a default layer, not selected in the user profile.
  const providedAccount = (extra = {}) => ({ name: VD, version: ver(VD), installed: false, enabled: false,
    liveEnabled: true, removable: false, optional: false,
    rows: [{ rowId: 'dsh-vibedev', moduleName: VD, entryId: 'include:dsh-vibedev' }], ...extra })
  const accountCard = '.card[data-id="@vibedev-si/dsh-vibedev"]'
  {
    const { page, errs } = await boot({ initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }, providedAccount({ version: '0.2.0' })] })
    const card = await page.$eval(accountCard, (el) => el.innerText)
    ok('built-in account remains visible with the new package name and its actual supplied version', card.includes('VibeDev 账号与模型') && card.includes('@vibedev-si/dsh-vibedev · 0.2.0'))
    ok('built-in enabled through default layers is labelled enabled and has no duplicate install or management button', card.includes('应用内置 · 已启用') && await page.$eval(accountCard, (el) => !el.querySelector('.btn.primary, .btn.idle')))
    ok('suite counts the built-in account as already present', (await text(page)).includes('将安装 2 个插件（已装 2 个）'))
    ok('built-in versions are not offered as separate npm updates', !(await page.evaluate(() => !!document.querySelector('.grid .card[data-id="@vibedev-si/dsh-vibedev"] .btn.warn'))))
    await click(page, '[data-tab=updates]')
    const builtInRow = await page.evaluate(() => { const rows = [...document.querySelectorAll('[data-testid=app-update-row]')]; return { rows: rows.length, buttons: rows.reduce((n, el) => n + el.querySelectorAll('button').length, 0), text: rows[0]?.innerText ?? '' } })
    ok('the app-supplied account is offered as an app update only, with nothing to install', builtInRow.rows === 1 && builtInRow.buttons === 0 && builtInRow.text.includes('升级应用'), JSON.stringify({ rows: builtInRow.rows, buttons: builtInRow.buttons }))
    await click(page, '[data-tab=installed]')
    ok('Installed tab includes the built-in account', await page.$eval(accountCard, (el) => el.innerText.includes('应用内置')))
    await click(page, accountCard)
    await page.waitForSelector('[data-testid=provided-note]')
    const note = await page.$eval('[data-testid=provided-note]', (el) => el.innerText)
    ok('built-in details explain app-managed updates and suppress duplicate installation commands', note.includes('随应用更新') && await page.$eval('[data-testid=drawer]', (el) => !el.querySelector('pre.cmd') && !el.innerText.includes('复制安装命令')))
    ok('built-in inventory rendering has no browser errors', errs.length === 0, errs.join('; '))
    await page.close()
  }
  {
    const { page } = await boot({ initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }, providedAccount()] })
    ok('film recognises its built-in prerequisite as satisfied', (await page.$eval('.card[data-id=dsh-film]', (el) => el.innerText)).includes('已满足'))
    await clickText(page, '一键安装套装'); await page.waitForSelector('[data-testid=confirm]')
    ok('suite confirmation marks the built-in account as skipped', (await text(page)).includes('应用内置 · 已安装，跳过'))
    await click(page, '[data-testid=confirm]'); await waitText(page, '安装完成')
    const c = await calls(page)
    ok('suite installs only film and viewer, never another account plugin', c.filter((x) => x[0] === 'installBundle').map((x) => x[1]).join() === [spec('dsh-film'), spec(MV)].join())
    ok('suite does not toggle or remove the built-in account', !c.some((x) => ['setBundleEnabled', 'removeBundle'].includes(x[0]) && x[1] === VD))
    await page.close()
  }
  {
    const { page } = await boot({ initial: [providedAccount({ liveEnabled: false })] })
    ok('disabled built-in is not presented as enabled', (await page.$eval(accountCard, (el) => el.innerText)).includes('应用内置 · 已停用'))
    await click(page, '.card[data-id=dsh-film] .btn.primary'); await page.waitForSelector('[data-testid=confirm]'); await click(page, '[data-testid=confirm]')
    await page.waitForSelector('[data-testid=fail][data-kind=provided]')
    ok('disabled built-in stops prerequisite installation with actionable settings guidance', (await text(page)).includes('在设置的插件页检查') && !(await calls(page)).some((x) => ['installBundle', 'setBundleEnabled', 'removeBundle'].includes(x[0])))
    ok('built-in failure does not offer pointless retry or duplicate install commands', !(await page.evaluate(() => !!document.querySelector('[data-testid=retry]'))) && !(await text(page)).includes('复制安装命令'))
    await page.close()
  }
  {
    const { page } = await boot({ initial: [providedAccount(), { name: 'dsh-media', version: '0.1.3' }] })
    ok('legacy migration explicitly reuses the already enabled built-in account', (await page.$eval('[data-testid=migrate-banner]', (el) => el.innerText)).includes('只停用、卸载旧外置包'))
    await clickText(page, '一键切换'); await page.waitForSelector('[data-testid=mig-result]')
    const c = await calls(page)
    ok('legacy migration removes only the old external package, not the built-in new package', (await page.evaluate(() => !window.__pm.bundles.has('dsh-media') && window.__pm.bundles.has('@vibedev-si/dsh-vibedev'))) && !c.some((x) => x[0] === 'installBundle' || ['setBundleEnabled','removeBundle'].includes(x[0]) && x[1] === VD))
    await page.close()
  }
  {
    const { page } = await boot({ locale: 'en', initial: [providedAccount()] })
    await click(page, accountCard); await page.waitForSelector('[data-testid=provided-note]')
    const note = await page.$eval('[data-testid=provided-note]', (el) => el.innerText)
    ok('English built-in labels and explanation are fully translated', !( /[\u4e00-\u9fff]/.test(note)) && note.includes('Update the app') && (await text(page)).includes('Built into the app'))
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
