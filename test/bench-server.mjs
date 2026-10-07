import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const vendor = process.env.VENDOR_DIR ?? 'C:/Users/Administrator/AppData/Local/Temp/mv-harness/node_modules'

/** Stand-in for the host half's /vdc routes: tests set `state.config`, and read the reports the client POSTs. */
export const state = { config: { selfcheck: false, mount: false }, reports: [], configHits: 0, latest: undefined, latestHits: 0, latestDelay: 0, updates: undefined, updatesHits: 0, updatesDelay: 0 }

export function startBench(port) {
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x')
    const send = (type, body) => { res.writeHead(200, { 'content-type': type }); res.end(body) }
    if (u.pathname === '/') return send('text/html; charset=utf-8', readFileSync(join(here, 'bench.html')))
    if (u.pathname === '/vendor/react.js') return send('text/javascript', readFileSync(resolve(vendor, 'react/umd/react.development.js')))
    if (u.pathname === '/vendor/react-dom.js') return send('text/javascript', readFileSync(resolve(vendor, 'react-dom/umd/react-dom.development.js')))
    if (u.pathname === '/fake-pm.js') return send('text/javascript', readFileSync(join(here, 'fake-pm.js')))
    if (u.pathname === '/client.js') return send('text/javascript; charset=utf-8', readFileSync(join(root, 'client.js')))
    if (u.pathname === '/vdc/config') { state.configHits++; return send('application/json', JSON.stringify({ ok: true, ...state.config })) }
    if (u.pathname === '/vdc/updates') {
      state.updatesHits++
      const answer = () => {
        if (typeof state.updates === 'number' || typeof state.latest === 'number' && state.updates === undefined) {
          res.writeHead(typeof state.updates === 'number' ? state.updates : state.latest); res.end(); return
        }
        if (state.updates !== undefined) return send('application/json', JSON.stringify(state.updates))
        const catalog = JSON.parse(readFileSync(join(root, 'catalog/catalog.json'), 'utf8'))
        const selfVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
        return send('application/json', JSON.stringify({ ok: true, partial: false, checkedAt: new Date().toISOString(),
          plugins: catalog.plugins.filter(p => p.origin === 'official').map(p => ({ name: p.npm, ok: true,
            version: p.version, publishedAt: p.publishedAt, registry: 'https://registry.npmjs.org/', sizeKB: p.sizeKB })),
          self: state.latest ?? { ok: true, latest: selfVersion, publishedAt: '2026-01-01T00:00:00.000Z', registry: 'https://registry.npmjs.org/' },
        }))
      }
      const delay = state.updatesDelay || state.latestDelay
      return delay ? setTimeout(answer, delay) : answer()
    }
    if (u.pathname === '/vdc/latest') {
      // Scripted answer of the host half: tests set state.latest to an object (JSON) or a number (HTTP status).
      state.latestHits++
      const answer = () => { if (typeof state.latest === 'number') { res.writeHead(state.latest); res.end(); return } send('application/json', JSON.stringify(state.latest ?? { ok: false, sources: [] })) }
      return state.latestDelay ? setTimeout(answer, state.latestDelay) : answer()
    }
    if (u.pathname === '/vdc/selfcheck' && req.method === 'POST') {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => { try { state.reports.push(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { /* ignore */ } send('application/json', '{"ok":true}') })
      return
    }
    res.writeHead(404); res.end()
  })
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)))
}
