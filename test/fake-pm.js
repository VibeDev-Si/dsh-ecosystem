/**
 * A fake of the host's `pluginManager`, faithful to the shapes in @deepseek-ai/dsh-plugin-manager's
 * schema. Scenarios are injected per package so tests can force every failure the real one can produce.
 *
 * It also models the REAL non-atomic uninstall: remove = disable -> uninstall runtime -> pnpm remove,
 * and a failure in the last step leaves the bundle disabled-but-installed (we got bitten by this).
 */
export function createFakePm(initial = [], scenarios = {}, options = {}) {
  const bundles = new Map(initial.map((b) => [b.name, { enabled: true, installed: true, version: '1.0.0', ...b }]))
  const calls = []
  const sc = (name) => scenarios[name] ?? {}
  const ok = (value) => ({ ok: true, value })
  const output = (s) => ({ exitCode: 1, output: s, truncated: false, logPath: 'x' })
  const wait = () => (options.delay ? new Promise((r) => setTimeout(r, options.delay)) : undefined)

  const pm = {
    calls,
    bundles,
    async inspect(spec, opts) {
      await wait()
      calls.push(['inspect', spec, opts])
      const at = spec.lastIndexOf('@')
      const name = at > 0 ? spec.slice(0, at) : spec
      const version = at > 0 ? spec.slice(at + 1) : undefined
      const s = sc(name)
      if (s.inspectThrows) return { ok: false, error: { code: 'rpc', message: 'connection lost' } }
      if (s.inspect) return ok(s.inspect)
      if (bundles.get(name)?.installed) return ok({ status: 'refused', problem: 'already-installed', reason: 'already installed' })
      // The host answers with the registry that actually answered. For the default it answers null, NOT a url:
      // seen in a live self-check ("registry": null).
      return ok({ status: 'accepted', kind: 'registry', name: s.nameOverride ?? name, version: s.versionOverride ?? version, bundle: s.notBundle ? false : true, registry: opts?.registry ?? null })
    },
    async installBundle(spec, opts) {
      await wait()
      calls.push(['installBundle', spec, opts])
      const name = spec.slice(0, spec.lastIndexOf('@'))
      const version = spec.slice(spec.lastIndexOf('@') + 1)
      const s = sc(name)
      if (s.installRpcLost) return { ok: false, error: { code: 'rpc', message: 'lost' } }
      if (s.network) return ok({ changed: false, application: 'failed', stage: 'install', target: name, error: { code: 'operation-error', diagnostic: 'ETIMEDOUT' }, packageResult: output('ETIMEDOUT registry.npmjs.org'), ...{ packageResult: { ...output('ETIMEDOUT'), kind: 'network' } } })
      if (s.notFound) return ok({ changed: false, application: 'failed', stage: 'install', target: name, packageResult: { ...output('ERR_PNPM_FETCH_404'), kind: 'not-found' } })
      if (s.incompat) return ok({ changed: false, application: 'failed', stage: 'install', target: name, error: { code: 'incompatible-version', incompatible: [{ name, version, runtimeVersion: '0.1.7', peers: { '@deepseek-ai/dsh-tools': '>=0.2.0-rc.2' } }] } })
      if (s.builds && !opts?.approvedBuilds?.length) return ok({ changed: false, application: 'failed', stage: 'install', target: name, pendingBuilds: ['esbuild', 'protobufjs'], packageResult: { ...output('Ignored build scripts'), kind: 'build-blocked' } })
      if (s.cooldown) return ok({ changed: false, application: 'failed', stage: 'install', target: name, packageResult: output(`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION 1 lockfile entries failed verification:\n  dsh-film@0.3.0 was published at 2026-10-05T08:47:54.172Z, within the minimumReleaseAge cutoff`) })
      bundles.set(name, { name, version, installed: true, enabled: !!opts?.enabled })
      return ok({ changed: true, application: s.restartOnInstall ? 'restart-required' : 'applied', stage: 'install', target: name, bundle: name, version, enabled: !!opts?.enabled, ...(opts?.approvedBuilds ? { approvedBuilds: opts.approvedBuilds } : {}) })
    },
    async setBundleEnabled(name, enabled) {
      await wait()
      calls.push(['setBundleEnabled', name, enabled])
      const s = sc(name)
      if (s.enableFails && enabled) return ok({ changed: false, application: 'failed', stage: 'enable', target: name, error: { code: 'operation-error', diagnostic: 'could not load' } })
      const b = bundles.get(name)
      if (!b) return { ok: false, error: { code: 'unknown-plugin', message: 'unknown plugin' } }
      b.enabled = enabled
      return ok({ changed: true, application: s.restartOnEnable && enabled ? 'restart-required' : 'applied', stage: 'enable', target: name, enabled })
    },
    async removeBundle(name) {
      calls.push(['removeBundle', name])
      const s = sc(name)
      const b = bundles.get(name)
      if (!b) return { ok: false, error: { code: 'unknown-plugin', message: 'unknown plugin' } }
      b.enabled = false // step 1 always happens
      if (s.removeFailsLast) return ok({ changed: true, application: 'failed', stage: 'remove', target: name, packageResult: output('ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION 1 lockfile entries failed verification:\n  dsh-film@0.3.0 was published at 2026-10-05T08:47:54.172Z, within the minimumReleaseAge cutoff') })
      bundles.delete(name)
      return ok({ changed: true, application: 'applied', stage: 'remove', target: name })
    },
    async listBundles() { calls.push(['listBundles']); return ok([...bundles.values()].map((b) => ({ name: b.name, version: b.version, enabled: b.enabled, installed: b.installed, optional: false, removable: true, rows: [], overrides: [] }))) },
    async cancelInstall(requestId) { calls.push(['cancelInstall', requestId]); return ok({ status: 'cancelled' }) },
    // The REAL shape (read from a live self-check): { registry, fallbackRegistries, resolved }.
    // `resolved` defaults to the official registry; options.resolved = 'https://registry.npmmirror.com' reproduces a user whose pnpm already uses the mirror.
    async registries() { calls.push(['registries']); return ok({ registry: null, fallbackRegistries: ['https://registry.npmmirror.com/'], resolved: options.resolved ?? 'https://registry.npmjs.org' }) },
  }
  return pm
}
