/**
 * Client entry (source form). `scripts/build.mjs` inlines engine.js, strings.js, ui.js and the catalog
 * into ONE file, `client.js`, in the official ModuleLoader shape, because plugin client bundles run with
 * no module system of their own.
 *
 * Registration mirrors the official Plugins page exactly (read from @deepseek-ai/dsh-client-ui-plugin-manager):
 *   ctx.slots.inject('main', ...)              the panel body, keyed by PANEL_ID
 *   ctx.slots.inject('sidebar.panellist', ...) the sidebar icon
 *   ctx.layout.selectPanel(PANEL_ID)           how the panel is opened
 */
export const PANEL_ID = 'vibedev-center'
export const inject = ['slots', 'locale', 'remote', 'remote.pluginManager', 'layout']

export function makeApply(React, CatalogData, createCenter, ui) {
  return function apply(ctx) {
    const Center = createCenter(React, CatalogData, {
      get pm() { return ctx.remote?.pluginManager },
      locale: () => { try { return ctx.locale.getLocale().id ?? ctx.locale.getLocale() } catch { return 'zh' } },
      onChanged: (fn) => { try { return ctx.remote.$on('plugin-manager/changed', fn) } catch { return () => {} } },
      openUrl: (u) => window.open(u, '_blank', 'noopener'),
      copy: (t) => navigator.clipboard?.writeText(t),
      reload: () => window.location.reload(),
      renderMarket: () => { try { const m = ctx.reflect?.get?.('market'); return m?.render?.() } catch { return null } },
    })

    ctx.effect(() => ctx.locale.register('vibedevCenter', { zh: {}, en: {} }), 'vibedev-center: dictionaries')
    const t = ctx.locale.bind('vibedevCenter')

    ctx.slots.inject('main', function* () {
      yield ctx.slots.register({ name: 'main', key: PANEL_ID, locale: 'vibedevCenter', inject: () => ({}) }, () => React.createElement(Center))
    })
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist', id: PANEL_ID, order: 5, label: () => ui.title(), locale: 'vibedevCenter',
    }, ({ size }) => ui.icon(size)))
  }
}
