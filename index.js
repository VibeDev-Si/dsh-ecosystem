/**
 * @vibedev-si/dsh-ecosystem: host half.
 *
 * The center talks to the host's `pluginManager` from the browser (via ctx.remote), so this half does very
 * little on purpose. It exists because the loader mounts a package through its host entry, and for a tiny
 * developer-only self-check channel that is OFF unless a marker file exists:
 *
 *   GET  /vdc/ping        -> {ok:true}
 *   GET  /vdc/config      -> {selfcheck: <does <profile>/.vdc/enable-selfcheck exist>}
 *   POST /vdc/selfcheck   -> writes the client's report to <profile>/.vdc/selfcheck.json  (only when enabled)
 *
 * All routes are loopback-only (same Host/Origin fence as the other routes). Nothing leaves the machine.
 */
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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
const exists = async (p) => { try { await access(p); return true } catch { return false } }

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/vdc',
    handler: async (req, res) => {
      const json = (status, body) => { const b = Buffer.from(JSON.stringify(body)); res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': String(b.length), 'cache-control': 'no-store' }); res.end(b) }
      try {
        if (!trusted(req, ctx.webRuntime.trustedHosts)) return json(403, { ok: false })
        const url = new URL(req.url ?? '/', 'http://x')
        if (url.pathname === '/vdc/ping' && req.method === 'GET') return json(200, { ok: true, name })
        if (url.pathname === '/vdc/config' && req.method === 'GET') return json(200, { ok: true, selfcheck: await exists(markerPath()) })
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
