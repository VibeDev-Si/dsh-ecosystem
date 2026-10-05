import puppeteer from 'puppeteer-core'
import { mkdirSync } from 'node:fs'
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
    ok('first screen explains what this is', t.includes('VibeDev 团队出品的插件'))
    ok('shows 3 official cards + 2 companions', (await page.evaluate(() => document.querySelectorAll('.card').length)) === 5)
    ok('suite says it will install 3 (sidebar already there)', t.includes('将安装 3 个插件（已装 1 个）'))
    ok('account + billing is visible on the card', t.includes('需要 VibeDev 账号') && t.includes('按用量计费'))
    ok('community plugins are labelled as such', (await page.evaluate(() => [...document.querySelectorAll('.card[data-id=dshmarket] .tag')].map((x) => x.textContent))).includes('社区插件'))
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
    ok('installed exactly the 3 missing, with exact versions', installs.map((x) => x[1]).join() === 'dsh-media@0.1.3,dsh-film@0.3.0,@vibedev-si/dsh-media-viewer@0.1.0', installs.map((x) => x[1]).join())
    ok('every install was requested NOT enabled', installs.every((x) => x[2].enabled === false))
    ok('each plugin enabled only after its own install', (() => { const seq = c.map((x) => x[0] + ':' + x[1]); return ['dsh-media', 'dsh-film', MV].every((n) => seq.indexOf('setBundleEnabled:' + n) > seq.findIndex((s) => s.startsWith('installBundle:' + n))) })())
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
    ok('prerequisite installed before the plugin', (await calls(page)).filter((x) => x[0] === 'installBundle').map((x) => x[1]).join() === `dsh-better-sidebar@0.24.1,${MV}@0.1.0`)
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
    ok(`failure "${name}" leaves the failed plugin out and keeps the finished one`, !has.includes('dsh-film') && has.includes('dsh-media') && !has.includes('@vibedev-si/dsh-media-viewer'), has.join())
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
    ok('after approval, the remaining plugins continue', (await calls(page)).some((c) => c[0] === 'installBundle' && c[1] === `${MV}@0.1.0`))
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
    await waitText(page, '正在安装'); await sleep(500)
    await click(page, '[data-testid=cancel]')
    await page.waitForFunction(() => /安装未完成|安装完成/.test(document.body.innerText), { timeout: 15000 })
    const has = await page.evaluate(() => [...window.__pm.bundles.keys()])
    ok('cancel stops before the later plugins', !has.includes('@vibedev-si/dsh-media-viewer') && !has.includes('dsh-film'), has.join())
    ok('cancel asks the host to cancel the running request', (await calls(page)).some((c) => c[0] === 'cancelInstall'), (await calls(page)).map((c) => c[0]).join(','))
    await page.close()
  }

  // 8 ── management: disable / enable / uninstall (clean), uninstall (half-removed: the real incident)
  {
    const { page } = await boot({ initial: [{ name: 'dsh-media', version: '0.1.3' }, { name: 'dsh-better-sidebar', version: '0.24.1' }], delay: 20 })
    await page.evaluate(() => document.querySelector('.card[data-id=dsh-media] .btn.idle').click())
    await sleep(100); await shot(page, '11-manage-menu')
    await clickText(page, '停用（保留数据）', '.menu'); await sleep(250)
    ok('disable calls setBundleEnabled(false) and the card shows Enable', (await calls(page)).some((c) => c[0] === 'setBundleEnabled' && c[1] === 'dsh-media' && c[2] === false) && (await page.evaluate(() => document.querySelector('.card[data-id=dsh-media] .ft').innerText.includes('启用'))))
    await page.evaluate(() => document.querySelector('.card[data-id=dsh-media] .btn.idle').click()); await sleep(80)
    await clickText(page, '卸载', '.menu'); await sleep(300)
    ok('clean uninstall removes it and the card returns to Install', !(await page.evaluate(() => window.__pm.bundles.has('dsh-media'))) && (await page.evaluate(() => document.querySelector('.card[data-id=dsh-media] .ft').innerText.includes('安装'))))
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

  // 10 ── updates
  {
    const { page } = await boot({ initial: [{ name: 'dsh-media', version: '0.1.2' }, { name: 'dshmarket', version: '1.0.0' }, { name: 'dsh-better-sidebar', version: '0.24.1' }] })
    const badge = await page.evaluate(() => document.querySelector('[data-tab=updates] .n')?.textContent)
    ok('updates tab counts only center-managed plugins (the market updates itself)', badge === '1', String(badge))
    ok('card offers "update to 0.1.3"', (await text(page)).includes('更新到 0.1.3'))
    await page.evaluate(() => document.querySelector('.card[data-id=dsh-media] .btn.warn').click())
    await page.waitForSelector('[data-testid=confirm]')
    ok('update confirm shows from -> to and the fresh-release note', (await text(page)).includes('0.1.2 → 0.1.3') && (await text(page)).includes('这个版本刚发布'))
    await shot(page, '15-update-confirm')
    await click(page, '[data-testid=confirm]'); await waitText(page, '安装完成')
    ok('update installs the exact catalog version', (await calls(page)).some((c) => c[0] === 'installBundle' && c[1] === 'dsh-media@0.1.3'))
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

  // 14 ── English + dark
  {
    const { page } = await boot({ locale: 'en', initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }] })
    const t = await text(page)
    ok('English UI uses the catalog English text', t.includes('VibeDev Plugin Center') && t.includes('Install the suite') && t.includes('Needs a VibeDev account') && !/[\u4e00-\u9fff]/.test(t), (t.match(/[\u4e00-\u9fff]+/g) || []).slice(0, 5).join('|'))
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
    ok('REAL locale shape: a zh user gets the Chinese UI (it rendered English in the real GUI)', t.includes('VibeDev 插件中心') && t.includes('一键安装套装') && !t.includes('Install the suite'))
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
    const { page } = await boot({ scenarios: { 'dsh-media': { inspect: realAnswer } } })
    await page.evaluate(() => document.querySelector('.card[data-id=dsh-media] .btn.primary').click()); await page.waitForSelector('[data-testid=confirm]'); await click(page, '[data-testid=confirm]')
    await page.waitForSelector('[data-testid=fail]')
    const t = await text(page)
    ok('network text reports ONE registry honestly and shows the host reason', t.includes('没能连上 npm 源') && t.includes('timed out after 20000ms') && !t.includes('已依次尝试'), t.match(/没能连上[^\n]*/)?.[0])
    await shot(page, '22-network-honest'); await page.close()
  }
  {
    const two = { status: 'refused', problem: 'network', reason: 'ETIMEDOUT', registries: [null, 'https://registry.npmmirror.com'] }
    const { page } = await boot({ scenarios: { 'dsh-media': { inspect: two } } })
    await page.evaluate(() => document.querySelector('.card[data-id=dsh-media] .btn.primary').click()); await page.waitForSelector('[data-testid=confirm]'); await click(page, '[data-testid=confirm]')
    await page.waitForSelector('[data-testid=fail]')
    ok('when the host really tried two registries, the text says so', (await text(page)).includes('已依次尝试 2 个源'))
    await page.close()
  }
  // 16 ── found when a user could not see the entry, and by reading the real screenshot
  {
    const { page } = await boot({ locale: 'zh' })
    const label = await page.evaluate(() => window.__reg.slots.filter((s) => s.decl && s.decl.name === 'sidebar.panellist')[0].decl.label())
    ok('sidebar entry is labelled "VibeDev 插件中心", not a bare "VibeDev" that hides next to the brand name', label === 'VibeDev 插件中心', label)
    await page.evaluate(() => window.__setLocale('en'))
    ok('the sidebar label follows the language', (await page.evaluate(() => window.__reg.slots.filter((s) => s.decl && s.decl.name === 'sidebar.panellist')[0].decl.label())) === 'VibeDev Plugin Center')
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
    const { page } = await boot({ settle: { between: { quietMs: 20, maxMs: 200 }, final: { quietMs: 500, maxMs: 4000 } }, initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }, { name: 'dsh-media', version: '0.1.3' }, { name: 'dsh-film', version: '0.3.0' }] })
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
    const { page } = await boot({ settle: { between: { quietMs: 20, maxMs: 200 }, final: { quietMs: 300, maxMs: 900 } }, initial: [{ name: 'dsh-better-sidebar', version: '0.24.1' }, { name: 'dsh-media', version: '0.1.3' }, { name: 'dsh-film', version: '0.3.0' }] })
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
    await page.waitForFunction(() => window.__t.some((x) => x[0] === 'setBundleEnabled' && x[1] === 'dsh-media'), { timeout: 8000 })
    const tEnabled = await page.evaluate(() => window.__t.find((x) => x[0] === 'setBundleEnabled' && x[1] === 'dsh-media')[2])
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
} catch (e) {
  ok('test run completed without throwing', false, String(e && e.stack || e))
} finally {
  await browser.close(); server.close()
}
const bad = results.filter((x) => !x).length
console.log(`\n${results.length - bad}/${results.length} passed`)
process.exit(bad ? 1 : 0)
