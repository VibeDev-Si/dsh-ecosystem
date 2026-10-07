#!/usr/bin/env node
/**
 * Builds client.js: ONE self-contained file in the official ModuleLoader shape.
 *
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ...; return module.exports } })
 *
 * No bundler: the sources are plain ES modules with simple `import`/`export` statements, so we strip those
 * and concatenate in dependency order. The build then PARSES the result (new Function) so a syntax slip
 * fails here and not in a user's browser.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const pkg = JSON.parse(read('package.json'))
const ID = pkg.name

// Strip ES module syntax from one source; return {code, exports[]}
function strip(src) {
  const exportsFound = []
  const code = src
    .replace(/^import\s+[^;]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+(async\s+function|function|const|let|class)\s+([A-Za-z0-9_$]+)/gm, (m, kind, name) => { exportsFound.push(name); return `${kind} ${name}` })
  return { code, exportsFound }
}

const validator = strip(read('catalog-validator.js'))
const engine = strip(read('src/engine.js'))
const strings = strip(read('src/strings.js'))
const ui = strip(read('src/ui.js'))
const selfcheck = strip(read('src/selfcheck.js'))

// ui.js refers to the engine as the namespace E; give it one.
const engineNs = `const E = { ${engine.exportsFound.join(', ')} };`

const catalog = JSON.stringify(JSON.parse(read('catalog/catalog.json')))

const body = `
"use strict";
var React = require("react");
${validator.code}
${engine.code}
${engineNs}
${strings.code}
${ui.code}
${selfcheck.code}

var CATALOG = ${catalog};
var VERSION = ${JSON.stringify(pkg.version)};
var LOAD_ERRORS = watchErrors();

var PANEL_ID = "vibedev-center";
var inject = ["slots", "locale", "remote", "remote.pluginManager", "layout"];
var primitives; try { primitives = require("@deepseek-ai/dsh-client-ui-primitives"); } catch (e) { primitives = null; }

function PanelIcon(size) {
  var h = React.createElement;
  return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" },
    h("path", { d: "M10 3H5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h1a2 2 0 1 1 0 4H5a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h5v-2a2 2 0 1 1 4 0v2h5a2 2 0 0 0 2-2v-5h-2a2 2 0 1 1 0-4h2V5a2 2 0 0 0-2-2h-5v1a2 2 0 1 1-4 0z" }));
}

function currentLocale(ctx) { try { var l = ctx.locale.getLocale(); return (l && (l.active || l.id)) || "zh"; } catch (e) { return "zh"; } }

function apply(ctx) {
  // The registry probe is optional: the center works without it, so a missing service must not stop the plugin loading.
  // (Reading it without declaring it throws "cannot get property ... without inject", seen in a live self-check.)
  var probeHolder = { probe: undefined };
  try { ctx.inject(["remote.pluginRegistryProbe"], function (scoped) { try { probeHolder.probe = scoped.remote.pluginRegistryProbe; } catch (e) {} }); } catch (e) {}

  var Center = createCenter(React, CATALOG, {
    get pm() { try { return ctx.remote.pluginManager; } catch (e) { return undefined; } },
    // The real getLocale() returns { active: "zh", locales: [...], revision } (read from a live self-check), not { id }.
    locale: function () { return currentLocale(ctx); },
    onLocale: function (fn) { try { return ctx.locale.subscribe(fn); } catch (e) { return function () {}; } },
    // Same rule as the official Plugins page: only consider the China mirror when pnpm defaults to the official registry.
    chooseRegistry: function () { return E.chooseRegistry(ctx.remote.pluginManager, probeHolder.probe); },
    onChanged: function (fn) { try { return ctx.remote.$on("plugin-manager/changed", fn); } catch (e) { return function () {}; } },
    openUrl: function (u) { window.open(u, "_blank", "noopener"); },
    copy: function (t) { try { navigator.clipboard && navigator.clipboard.writeText(t); } catch (e) {} },
    // Test hook only: the real host never sets ctx.__vdcSettle, so production always uses the built-in timings.
    settle: function () { return ctx.__vdcSettle || null; },
    // The version of THIS center, shown in the header and compared with npm's latest when the user clicks "check for updates".
    version: function () { return VERSION; },
    // One user-initiated read of npm's latest version, made by the host half (index.js /vdc/latest). Resolves to undefined on any failure.
    checkLatest: function () {
      var ctl = typeof AbortController === "function" ? new AbortController() : null;
      var timer = ctl ? setTimeout(function () { ctl.abort(); }, 20000) : null;
      return fetch("/vdc/latest", { cache: "no-store", signal: ctl ? ctl.signal : undefined })
        .then(function (r) { return r.ok ? r.json() : undefined; })
        .catch(function () { return undefined; })
        .then(function (v) { if (timer) clearTimeout(timer); return v; });
    },
    // Read the four fixed VibeDev releases when this panel opens or the user checks again. The host caches successes.
    checkUpdates: function (signal) {
      var ctl = new AbortController();
      var abort = function () { ctl.abort(); };
      if (signal && signal.aborted) return Promise.resolve(undefined);
      if (signal) signal.addEventListener('abort', abort, { once: true });
      var timer = setTimeout(abort, 35000);
      return fetch('/vdc/updates', { cache: 'no-store', signal: ctl.signal })
        .then(function (r) { return r.ok ? r.json() : undefined; })
        .catch(function () { return undefined; })
        .finally(function () { clearTimeout(timer); if (signal) signal.removeEventListener('abort', abort); });
    },
    renderMarket: function () { try { var m = ctx.reflect && ctx.reflect.get && ctx.reflect.get("market"); return m && m.render ? m.render() : null; } catch (e) { return null; } }
  });
  var Panel = function () { return React.createElement(Center); };

  ctx.effect(function () { return ctx.locale.register("vibedevCenter", { zh: {}, en: {} }); }, "vibedev-center: dictionaries");

  ctx.slots.inject("main", function* () {
    yield ctx.slots.register({ name: "main", key: PANEL_ID, locale: "vibedevCenter", inject: function () { return {}; } }, Panel);
  });
  ctx.slots.inject("sidebar.panellist", function () {
    return ctx.slots.register({
      name: "sidebar.panellist", id: PANEL_ID, order: 5,
      // Spelled out on purpose: a bare "VibeDev" sits next to the brand name and is easy to miss (a user did).
      label: function () { return STR[pick(currentLocale(ctx))].title; }, locale: "vibedevCenter"
    }, function (p) { return PanelIcon((p && p.size) || 18); });
  });
  setTimeout(function () { try { runSelfCheck(ctx, PANEL_ID, CATALOG, LOAD_ERRORS, VERSION, probeHolder, E.chooseRegistry, E); } catch (e) {} }, 2500);
}

module.exports = { inject: inject, apply: apply, name: ${JSON.stringify(ID)} };
`

const out = `/*! ${ID} ${pkg.version} client half. GENERATED by scripts/build.mjs, do not edit. */
window.__ModuleLoader__.load({
  id: ${JSON.stringify(ID)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${body}
    return module.exports;
  }
});
`

// Parse check: a syntax error must fail the build, not a user's page.
try { new Function(out) } catch (e) { console.error('client.js does not parse:', e.message); process.exit(1) }
// Do not rewrite an identical file: a changed mtime makes the host hot-reload the plugin's client in every open window,
// so a no-op rebuild used to flash the UI for anyone running a linked (file:) install.
const target = join(root, 'client.js')
let same = false
try { same = readFileSync(target, 'utf8') === out } catch { /* first build */ }
if (!same) writeFileSync(target, out)
console.log(`client.js ${same ? 'unchanged' : 'built'}: ${(out.length / 1024).toFixed(1)} KB (engine ${engine.exportsFound.length} exports, catalog ${(catalog.length / 1024).toFixed(1)} KB)`)
