/**
 * @vibedev-si/dsh-ecosystem: host half.
 *
 * The center talks to the host's `pluginManager` from the browser (via ctx.remote), so this half stays small. It exists
 * because the loader mounts a package through its host entry, for a developer-only self-check channel that is OFF unless
 * a marker file exists, and for the TWO user-facing outbound reads: this package's own latest version, and the fixed
 * allow-list of official plugins plus this center (`catalog-updates.js`).
 *
 *   GET  /vdc/ping        -> {ok:true}
 *   GET  /vdc/config      -> {selfcheck, mount, official}: does <profile>/.vdc/enable-selfcheck exist, and does
 *                            enable-selfcheck-mount (the second, separate opt-in that lets the check switch panels, which
 *                            the user can SEE); and whether this is an app's built-in copy (row config `official: true`)
 *   POST /vdc/selfcheck   -> writes the client's report to <profile>/.vdc/selfcheck.json  (only when enabled)
 *   GET  /vdc/latest      -> the newest version of THIS package on npm. Called only when the user clicks "check for
 *                            updates"; never on load, never on a timer.
 *   GET  /vdc/updates     -> the newest version of each allow-listed package (three official plugins and this center),
 *                            every one of them verified against its package identity, bundle manifest, repository and
 *                            integrity. Never on load, never on a timer: the panel asks when it opens and when the
 *                            user clicks.
 *
 * Every route is loopback-only (same Host/Origin fence as the other routes). The ONLY outbound network use is those two
 * reads: a plain GET of one packument per package, from fixed registries (the official one first, a mirror only when the
 * official read fails at the transport level). Neither takes input from the page (no query, no body), so there is nothing
 * to redirect elsewhere; they send no data about the user or the machine.
 */
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createUpdatesReader } from './catalog-updates.js'
import { createCatalogReader } from './remote-catalog.js'
import { readFileSync } from 'node:fs'
const BUNDLED_CATALOG = JSON.parse(readFileSync(new URL('./catalog/catalog.json', import.meta.url), 'utf8'))

export const name = '@vibedev-si/dsh-ecosystem'
export const inject = ['webServer', 'webRuntime']

const header = (h, k) => (typeof h[k] === 'string' ? h[k] : undefined)
const parseAuthority = (a) => { try { return new URL(`http://${a}`) } catch { return undefined } }
const loopback = (hn) => hn === 'localhost' || hn === '[::1]' || /^127(\.\d{1,3}){3}$/.test(hn)

export function trusted(req, trustedHosts) {
  const host = header(req.headers, 'host')
  const u = host && parseAuthority(host)
  if (!u) return false
  if (!loopback(u.hostname) && !trustedHosts.some((e) => { const x = parseAuthority(e); return x && (x.port === '' ? x.hostname === u.hostname : x.host === u.host) })) return false
  if (header(req.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(req.headers, 'origin')
  if (origin === undefined) return true
  try { return new URL(origin).hostname === u.hostname } catch { return false }
}

const MAX_BODY = 64 * 1024
const profileDir = () => process.env.DSH_PROFILE_DIR ?? process.cwd()
const markerPath = () => join(profileDir(), '.vdc', 'enable-selfcheck')
const mountMarkerPath = () => join(profileDir(), '.vdc', 'enable-selfcheck-mount')
const exists = async (p) => { try { await access(p); return true } catch { return false } }

// ── latest version of this package ────────────────────────────────────────────────────────────────────────────────
// Fixed on purpose: the package name and the two registries are constants, never taken from the request.
const PACKAGE = '@vibedev-si/dsh-ecosystem'
const REGISTRIES = ['https://registry.npmjs.org/', 'https://registry.npmmirror.com/']
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
const TIMEOUT_MS = 8000
const CACHE_MS = 60_000

export function compareVersions(a, b) {
  const pa = a.split('-')[0].split('.').map(Number)
  const pb = b.split('-')[0].split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  return 0
}

/** Read one registry. Never throws; always answers {registry, ms, version?, publishedAt?, error?}. */
export async function readRegistry(base, doFetch) {
  const t0 = Date.now()
  const done = (o) => ({ registry: base, ms: Date.now() - t0, ...o })
  try {
    const r = await doFetch(base + PACKAGE.replace('/', '%2F'), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' })
    if (!r.ok) return done({ error: `HTTP ${r.status}` })
    const j = await r.json()
    const latest = j?.['dist-tags']?.latest
    if (j?.name !== PACKAGE || typeof latest !== 'string' || !SEMVER.test(latest)) return done({ error: 'unexpected answer' })
    const at = j?.time?.[latest]
    const publishedAt = typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : undefined
    return done({ version: latest, ...(publishedAt ? { publishedAt } : {}) })
  } catch (e) {
    return done({ error: e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : String(e?.cause?.code ?? e?.message ?? e).slice(0, 120) })
  }
}

/** Ask both registries at once and keep the highest version any of them reports (a mirror can lag behind npm). */
export async function latestVersion(doFetch) {
  const sources = await Promise.all(REGISTRIES.map((b) => readRegistry(b, doFetch)))
  const ok = sources.filter((s) => s.version)
  if (!ok.length) return { ok: false, name: PACKAGE, sources }
  const best = ok.reduce((a, b) => (compareVersions(b.version, a.version) > 0 ? b : a))
  return { ok: true, name: PACKAGE, latest: best.version, publishedAt: best.publishedAt, from: best.registry, sources }
}

/** Page global telling the client half it is the app's built-in, official copy (see {@link apply}). */
export const OFFICIAL_GLOBAL = '__VDC_OFFICIAL__'

/**
 * @param ctx - the host context.
 * @param config - `official: true` only in an app that ships this center built in (VibeDev Next's web defaults set it on
 *   their own insert row). Then the client half lists the center in the Official group of the Plugins page and reports
 *   that it updates with the app. A user's own install (DeepSeek Harness, `Add plugin`) passes no config: nothing changes.
 */
export function apply(ctx, config) {
  const official = config?.official === true
  if (official) ctx.on('webserver/index-inject', (table) => { table.push({ kind: 'global', name: OFFICIAL_GLOBAL, value: { official: true } }) })
  // `ctx.__vdcFetch` is a test hook; the real host never sets it, so production uses the global fetch.
  const doFetch = (...a) => (ctx.__vdcFetch ?? globalThis.fetch)(...a)
  let cache // {at, body}: a user mashing the button must not hammer the registry
  // The allow-listed live reader owns its own 60-second cache and its own in-flight batch.
  const now = typeof ctx.__vdcNow === 'function' ? ctx.__vdcNow : Date.now
  const catalogs = ctx.__vdcCatalogReader ?? createCatalogReader(doFetch, now, BUNDLED_CATALOG)
  const updates = createUpdatesReader(doFetch, now, catalogs)
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/vdc',
    handler: async (req, res) => {
      const json = (status, body) => { const b = Buffer.from(JSON.stringify(body)); res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': String(b.length), 'cache-control': 'no-store' }); res.end(b) }
      try {
        if (!trusted(req, ctx.webRuntime.trustedHosts)) return json(403, { ok: false })
        const url = new URL(req.url ?? '/', 'http://x')
        if (url.pathname === '/vdc/ping' && req.method === 'GET') return json(200, { ok: true, name })
        if (url.pathname === '/vdc/config' && req.method === 'GET') {
          const on = await exists(markerPath())
          // The visible part only ever applies when the whole self-check is on.
          return json(200, { ok: true, selfcheck: on, mount: on && (await exists(mountMarkerPath())), official })
        }
        if (url.pathname === '/vdc/latest' && req.method === 'GET') {
          if (cache && Date.now() - cache.at < CACHE_MS) return json(200, { ...cache.body, cached: true })
          const body = await latestVersion(doFetch)
          if (body.ok) cache = { at: Date.now(), body } // a failure is never cached: the next click tries again
          return json(200, body)
        }
        if (url.pathname === '/vdc/updates' && req.method === 'GET') return json(200, await updates.read())
        if (url.pathname === '/vdc/selfcheck' && req.method === 'POST') {
          if (!(await exists(markerPath()))) return json(403, { ok: false, error: 'self-check is not enabled' })
          const chunks = []; let size = 0
          for await (const c of req) { size += c.length; if (size > MAX_BODY) return json(413, { ok: false }); chunks.push(c) }
          let body
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return json(400, { ok: false }) }
          const dir = join(profileDir(), '.vdc')
          await mkdir(dir, { recursive: true })
          await writeFile(join(dir, 'selfcheck.json'), JSON.stringify({ at: new Date().toISOString(), ...body }, null, 2))
          return json(200, { ok: true })
        }
        return json(404, { ok: false })
      } catch (e) {
        return json(500, { ok: false, error: String(e?.message ?? e) })
      }
    },
  }), '@vibedev-si/dsh-ecosystem: /vdc routes')
}
