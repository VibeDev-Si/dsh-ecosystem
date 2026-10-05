// Mutation tests: the validator must REJECT each of these. A validator that only ever says "ok" is worthless.
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const good = JSON.parse(readFileSync(join(root, 'catalog', 'catalog.json'), 'utf8'))

function run(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'cat-'))
  mkdirSync(join(dir, 'catalog')); mkdirSync(join(dir, 'scripts'))
  cpSync(join(root, 'scripts', 'validate-catalog.mjs'), join(dir, 'scripts', 'validate-catalog.mjs'))
  const c = structuredClone(good); mutate(c)
  writeFileSync(join(dir, 'catalog', 'catalog.json'), JSON.stringify(c))
  const r = spawnSync(process.execPath, [join(dir, 'scripts', 'validate-catalog.mjs')], { encoding: 'utf8' })
  return { code: r.status, out: (r.stderr + r.stdout).trim() }
}
const cases = [
  ['install from a URL instead of a package name', (c) => { c.plugins[0].npm = 'https://evil.example/x.tgz'; c.plugins[0].id = c.plugins[0].npm }],
  ['git spec as package name', (c) => { c.plugins[0].npm = 'github:evil/x'; c.plugins[0].id = c.plugins[0].npm }],
  ['version range instead of exact version', (c) => { c.plugins[0].version = '^0.1.3' }],
  ['dist-tag instead of exact version', (c) => { c.plugins[0].version = 'latest' }],
  ['community entry pretending to be official', (c) => { c.plugins[3].role = 'official' }],
  ['official claim on an unscoped, non-grandfathered name', (c) => { c.plugins[3].origin = 'official'; c.plugins[3].role = 'official' }],
  ['official claim on the retired unscoped name dsh-media', (c) => { c.plugins[0].npm = 'dsh-media'; c.plugins[0].id = 'dsh-media'; c.plugins[0].cmd = 'dsh plugin add dsh-media'; c.suites[0].items = c.suites[0].items.filter((i) => !i.endsWith('dsh-vibedev')); c.plugins[1].requires = [] }],
  ['community entry without the disclaimer', (c) => { c.plugins[3].capabilities = c.plugins[3].capabilities.filter((x) => x.key !== 'community') }],
  ['missing English text', (c) => { c.plugins[1].tagline.en = '' }],
  ['zh/en feature lists out of step', (c) => { c.plugins[1].does.en.pop() }],
  ['dependency on an unknown plugin', (c) => { c.plugins[2].requires = ['not-in-catalog'] }],
  ['dependency cycle', (c) => { c.plugins[3].requires = ['@vibedev-si/dsh-media-viewer'] }],
  ['suite item not in catalog', (c) => { c.suites[0].items.push('ghost') }],
  ['http (not https) link', (c) => { c.plugins[0].links.repo = 'http://x.example' }],
  ['no capabilities listed', (c) => { c.plugins[0].capabilities = [] }],
  ['duplicate plugin', (c) => { c.plugins.push(structuredClone(c.plugins[0])) }],
  ['publish time missing', (c) => { delete c.plugins[0].publishedAt }],
  ['publish time not a date', (c) => { c.plugins[0].publishedAt = 'yesterday' }],
  ['publish time without a timezone', (c) => { c.plugins[0].publishedAt = '2026-10-05T14:40:00' }],
  ['publish time impossible', (c) => { c.plugins[0].publishedAt = '2026-13-45T99:99:99Z' }],
]
let bad = 0
for (const [name, m] of cases) {
  const { code, out } = run(m)
  const ok = code === 1
  if (!ok) bad++
  console.log(`${ok ? 'REJECTED ' : 'ACCEPTED!'}  ${name}${ok ? '' : '   <-- validator missed this'}`)
}
const base = run(() => {})
console.log(`${base.code === 0 ? 'ACCEPTED ' : 'REJECTED!'}  (control) the real catalog`)
if (base.code !== 0) bad++
console.log(bad ? `\n${bad} problem(s)` : `\nall ${cases.length} bad catalogs rejected, control accepted`)
process.exit(bad ? 1 : 0)
