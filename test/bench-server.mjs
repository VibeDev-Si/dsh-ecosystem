import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const vendor = process.env.VENDOR_DIR ?? 'C:/Users/Administrator/AppData/Local/Temp/mv-harness/node_modules'

/** Stand-in for the host half's /vdc routes: tests set `state.config`, and read the reports the client POSTs. */
export const state = { config: { selfcheck: false, mount: false }, reports: [], configHits: 0 }

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
