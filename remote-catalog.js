/**
 * The online catalog reader: new VibeDev plugins are picked up without shipping a new client.
 *
 * The source is FIXED — the repository's own catalog/catalog.json on the default branch, maintained
 * by committing to main, with no release or tag needed:
 *
 *   https://raw.githubusercontent.com/VibeDev-Si/dsh-ecosystem/main/catalog/catalog.json
 *
 * Nothing a page or a user supplies reaches the request: no url, no package name, no header, no
 * body, no credentials. The reader sends a plain GET, refuses to follow a redirect, stops after 8
 * seconds IN TOTAL — the response body included, and the deadline is enforced with Promise.race as
 * well as the abort signal, so a transport that ignores the signal still cannot hang the panel — and
 * caps the body at 256 KB WHILE it is being read, cancelling the stream the moment it goes over.
 *
 * Whatever arrives is validated with the same rules the bundled catalog obeys (catalog-validator.js)
 * and then REPLACED where it must not be trusted: every entry's install command is regenerated from
 * its own npm name and exact version, so a payload can never smuggle a shell line into the UI. One
 * bad field refuses the WHOLE payload, and a refused payload is never cached: the reader answers
 * with the last good catalog it saw (marked stale) or with the catalog shipped in the package.
 *
 *   const reader = createCatalogReader(doFetch, Date.now, bundledCatalog)
 *   const { catalog, source, checkedAt, error, stale } = await reader.read()
 *
 * `source` is 'online' (fetched now), 'cached' (a fetch from the last 5 minutes, or the last good
 * catalog when the fresh check failed — then `stale` is true) or 'bundled' (the shipped copy).
 * `error` is set whenever a fetch was attempted and did not produce a usable catalog. Nothing is
 * thrown, nothing is installed and nothing outside this module is written.
 */

import { validateCatalog, normalizeCatalog } from './catalog-validator.js'

/** The one source. Committing to catalog/catalog.json on main is the whole publish step. */
export const CATALOG_URL = 'https://raw.githubusercontent.com/VibeDev-Si/dsh-ecosystem/main/catalog/catalog.json'
/** A slow mirror must not hold the panel: after this the whole read — body included — is over. */
export const CATALOG_TIMEOUT_MS = 8000
/** Bigger than the real catalog (about 10 KB) by two orders of magnitude, and still bounded. */
export const CATALOG_MAX_BYTES = 256 * 1024
/** A successful read is reused for this long, so opening the panel repeatedly is not a request storm. */
export const CATALOG_CACHE_MS = 5 * 60 * 1000

const iso = (ms) => new Date(ms).toISOString()
const bytesOf = (text) => (typeof TextEncoder === 'function'
  ? new TextEncoder().encode(text).length
  : (globalThis.Buffer?.byteLength?.(text) ?? text.length)) // no import, no bare global: feature-detected

/** Bytes to text, without assuming TextDecoder or Buffer exist. */
function decodeBody(all) {
  if (typeof TextDecoder === 'function') return new TextDecoder().decode(all)
  if (globalThis.Buffer?.from) return globalThis.Buffer.from(all).toString('utf8')
  let out = ''
  for (let i = 0; i < all.length; i += 4096) out += String.fromCharCode(...all.subarray(i, i + 4096))
  return out
}

/** A bundled catalog passed as the third argument, or inside the options. */
function bundledOf(options) {
  if (options === null || typeof options !== 'object') return undefined
  if (Array.isArray(options.plugins)) return options
  return options.bundled
}

/**
 * Build a reader over one fixed source.
 * @param doFetch - the transport: (url, init) => Promise<Response>. Absent means "bundled only".
 * @param now - () => epoch ms, or a number. Injectable so a test can move the clock.
 * @param options - { bundled, profile, url, timeoutMs, maxBytes, cacheMs, validate, validateOptions }.
 *                  The third argument may also BE the bundled catalog. `url` exists so a test double
 *                  can stand in for the fixed source; it is not a page-facing setting, and the HTTP
 *                  request can never be steered by the caller of read().
 * @returns { read, peek, source }: read() never throws; peek() is the last known state, no request.
 */
export function createCatalogReader(doFetch, now = Date.now, options = {}) {
  const url = options.url ?? CATALOG_URL
  const timeoutMs = options.timeoutMs ?? CATALOG_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? CATALOG_MAX_BYTES
  const cacheMs = options.cacheMs ?? CATALOG_CACHE_MS
  const validate = options.validate ?? validateCatalog
  const profile = options.profile
  const clock = () => (typeof now === 'function' ? now() : Date.now())
  /** Every catalog handed out carries regenerated commands; the caller's object is never modified. */
  const out = (catalog) => (catalog ? normalizeCatalog(catalog, { profile }) : catalog)
  const bundled = out(bundledOf(options))
  /** The last catalog this reader accepted from the network. */
  let good = null
  /** The request in flight, so two callers share one. */
  let inflight = null

  const bundledRead = (error) => ({
    catalog: bundled,
    source: 'bundled',
    checkedAt: iso(clock()),
    ...(error ? { error } : {}),
  })

  /** A deadline that fails even when the transport ignores the abort signal. */
  const deadline = (ms, onExpire) => {
    let timer = null
    const promise = new Promise((_, reject) => {
      timer = setTimeout(() => { try { onExpire?.() } catch { /* aborting is best effort */ } reject(new Error(`timed out after ${ms} ms`)) }, ms)
    })
    promise.catch(() => {}) // the race below may already be over: never an unhandled rejection
    return { promise, done: () => { if (timer) clearTimeout(timer) } }
  }

  /** The body, capped WHILE it is read: over the limit the rest is never downloaded. */
  const readBody = async (answer, message) => {
    const declared = Number(answer?.headers?.get?.('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`${message}: ${declared} bytes declared, over the ${maxBytes} byte limit`)
    const stream = answer?.body?.getReader?.()
    if (!stream) {
      // No stream (a test double, or an old transport): the cap still applies, at the end.
      const text = await answer.text()
      if (bytesOf(text) > maxBytes) throw new Error(`${message}: over the ${maxBytes} byte limit`)
      return text
    }
    const chunks = []
    let total = 0
    for (;;) {
      const { done, value } = await stream.read()
      if (done) break
      total += value?.byteLength ?? value?.length ?? 0
      if (total > maxBytes) {
        try { await stream.cancel() } catch { /* already closed */ }
        throw new Error(`${message}: over the ${maxBytes} byte limit while reading`)
      }
      chunks.push(value)
    }
    const all = new Uint8Array(total)
    let at = 0
    for (const chunk of chunks) { all.set(chunk, at); at += chunk.byteLength ?? chunk.length }
    return decodeBody(all)
  }

  const textOf = async (message) => {
    if (typeof doFetch !== 'function') throw new Error('no transport')
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    // One deadline for the request AND its body: the limit is the whole read, not just the handshake.
    const clockOut = deadline(timeoutMs, () => controller?.abort())
    try {
      const answer = await Promise.race([
        doFetch(url, {
          method: 'GET',
          redirect: 'error', // a redirect is how a catalog source gets swapped underneath us
          credentials: 'omit',
          headers: { accept: 'application/json' }, // never an Authorization header
          ...(controller ? { signal: controller.signal } : {}),
        }),
        clockOut.promise,
      ])
      if (!answer || answer.ok !== true) throw new Error(`${message}: the source answered ${answer?.status ?? 'nothing'}`)
      return await Promise.race([readBody(answer, message), clockOut.promise])
    } finally {
      clockOut.done()
    }
  }

  const fetchOnce = async () => {
    const text = await textOf('could not read the online catalog')
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw new Error(`the online catalog is not JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
    const verdict = validate(parsed, options.validateOptions)
    if (!verdict || verdict.ok !== true) {
      const first = (verdict?.errors ?? ['the validator refused it']).slice(0, 3).join('; ')
      throw new Error(`the online catalog was refused: ${first}`)
    }
    return parsed
  }

  const failure = (error) => {
    const message = error instanceof Error ? error.message : String(error)
    // A failed check is never cached: the last good catalog stands, marked stale, and the next read
    // tries again. When there is none, the shipped catalog answers.
    if (good) return { catalog: good.catalog, source: 'cached', checkedAt: iso(good.at), error: message, stale: true }
    if (bundled) return bundledRead(message)
    return { catalog: undefined, source: 'bundled', checkedAt: iso(clock()), error: message }
  }

  return {
    source: url,
    /**
     * Read the catalog. Takes no arguments by design: no caller can point it anywhere.
     * @returns { catalog, source, checkedAt, error?, stale? } — never rejects.
     */
    async read() {
      const at = clock()
      if (good && at - good.at < cacheMs) return { catalog: good.catalog, source: 'cached', checkedAt: iso(good.at) }
      if (typeof doFetch !== 'function') return bundledRead(undefined)
      if (inflight) return inflight
      inflight = (async () => {
        try {
          const parsed = await fetchOnce()
          good = { catalog: out(parsed), at: clock() }
          return { catalog: good.catalog, source: 'online', checkedAt: iso(good.at) }
        } catch (error) {
          return failure(error)
        } finally {
          inflight = null
        }
      })()
      return inflight
    },
    /** The last known state without touching the network. */
    peek() {
      if (good) return { catalog: good.catalog, source: 'cached', checkedAt: iso(good.at) }
      return bundled ? { catalog: bundled, source: 'bundled', checkedAt: iso(clock()) } : undefined
    },
  }
}
