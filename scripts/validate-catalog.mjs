#!/usr/bin/env node
/** Validate the bundled/online listing with the same rules used by the Host and client. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { catalogErrors } from '../catalog-validator.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const online = process.argv.includes('--online')
const catalog = JSON.parse(readFileSync(join(root, 'catalog', 'catalog.json'), 'utf8'))
const errors = catalogErrors(catalog)
const err = message => errors.push(message)

if (online && errors.length === 0) {
  for (const p of catalog.plugins) {
    try {
      const r = await fetch(`https://registry.npmjs.org/${p.npm.replace('/', '%2F')}`, { signal: AbortSignal.timeout(8000), redirect: 'error' })
      if (!r.ok) { err(`${p.id}: registry answered ${r.status}`); continue }
      const j = await r.json()
      const v = j.versions?.[p.version]
      if (!v) { err(`${p.id}: version ${p.version} does not exist on npm`); continue }
      if (v.name !== p.npm || v.version !== p.version) err(`${p.id}: registry identity does not match`)
      if (!v.dsh?.bundle) err(`${p.id}@${p.version}: no dsh.bundle manifest, the plugin manager would refuse it`)
      const npmTime = j.time?.[p.version]
      if (!npmTime) err(`${p.id}@${p.version}: npm has no publish time for it`)
      else if (new Date(npmTime).getTime() !== new Date(p.publishedAt).getTime()) err(`${p.id}@${p.version}: publishedAt ${p.publishedAt} differs from npm's ${new Date(npmTime).toISOString()}`)
      const size = Math.round((v.dist?.unpackedSize ?? 0) / 1024)
      if (size && Math.abs(size - p.sizeKB) / Math.max(size, 1) > 0.25) err(`${p.id}: sizeKB ${p.sizeKB} differs from npm unpackedSize ${size} KB by more than 25%`)
      console.log(`  ok  ${p.id}@${p.version}  (npm ${size} KB, latest ${j['dist-tags']?.latest})`)
    } catch (e) {
      err(`${p.id}: could not reach the registry (${e.message})`)
    }
  }
}
if (errors.length) {
  console.error(`catalog INVALID (${errors.length}):\n - ${errors.join('\n - ')}`)
  process.exit(1)
}
console.log(`catalog ok: ${catalog.plugins.length} plugins, ${catalog.suites.length} suite(s)${online ? ', verified against npm' : ''}`)
