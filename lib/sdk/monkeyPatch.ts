/**
 * Synpatico Monkey Patch (Functional Edition)
 * - Patches fetch() and XMLHttpRequest prototype methods
 * - Learning phase: derive structureId & cache per endpoint
 * - Optimized phase: send Accept-ID; decode values-only packets
 * - Per-property usage tracking via proxy tracker + worker/main-thread batching
 *
 * Usage:
 *   import { patch, unpatch, configure, enable, disable, FLUSH_SYMBOL } from './synpatico-monkey'
 *   configure({ include: (u) => u.startsWith('/api/') })
 *   patch()
 */

///////////////////////////
// Minimal core contracts //
///////////////////////////
// Replace with real imports from @synpatico/core in your repo.
import {
  createStructureDefinitionOptimized as createStructureDefinition,
  createStructureDefinitionWithPaths,
  decode,
} from '@synpatico/core'
import type { StructureDefinition, StructurePacket, URLString } from '@synpatico/core'

// Your tiny tracker wrapper from earlier (functional inside)
import { makeProxyTracker } from '../tracking'

// ------------------ Config/state (module-scope) ------------------

export type MonkeyConfig = {
  agentBase?: string
  include?: (url: string) => boolean
  exclude?: (url: string) => boolean
  workerUrl?: string
  headerAccept?: string
  headerAgent?: string
  sampleRate?: number // 0..1
  pathsMode?: 'strings' | 'ordinals'
}

const DEFAULTS = {
  headerAccept: 'X-Synpatico-Accept-ID',
  headerAgent: 'X-Synpatico-Agent',
  sampleRate: 1,
  pathsMode: 'strings' as const,
}

let ENABLED = true
let CONFIG: Required<Omit<MonkeyConfig, 'agentBase' | 'workerUrl' | 'include' | 'exclude'>> & {
  agentBase?: string
  workerUrl?: string
  include?: (url: string) => boolean
  exclude?: (url: string) => boolean
} = {
  ...DEFAULTS,
  include: () => true,
  exclude: () => false,
}

const FLUSH_SYMBOL = Symbol.for('synpatico.flushUsage')
const tracker = makeProxyTracker()

// Registry: endpointKey -> { def, pathOrdinals? }
type RegEntry = { def: StructureDefinition; pathOrdinals?: Map<string, number> }
const registry = new Map<string, RegEntry>()

// Native handles for unpatch
const Native = {
  fetch: globalThis.fetch.bind(globalThis),
  XHR: globalThis.XMLHttpRequest,
  xhrOpen: globalThis.XMLHttpRequest?.prototype?.open,
  xhrSend: globalThis.XMLHttpRequest?.prototype?.send,
  xhrSetHeader: globalThis.XMLHttpRequest?.prototype?.setRequestHeader,
}

type BaseMessage = {
  structureId: string,
  endpoint: string,
  timestamp: number,
}

type MsgStrings = BaseMessage & {
  kind: 'paths-strings'
  paths: string[]
}

type MsgOrdinals = BaseMessage & {
  kind: 'paths-ordinals'
  ordinals: number[]
}

type TelemetryMsg = MsgStrings | MsgOrdinals

const reporterState: {
  worker?: Worker
  buffer: TelemetryMsg[]
  timerId: number | null
} = { worker: undefined, buffer: [], timerId: null }

const initReporter = (cfg = CONFIG) => {
  if (reporterState.timerId != null) {
    clearInterval(reporterState.timerId)
    reporterState.timerId = null
  }
  reporterState.buffer = []
  reporterState.worker = undefined

  if (cfg.workerUrl) {
    try {
      reporterState.worker = new Worker(new URL(cfg.workerUrl, import.meta.url), { type: 'module' })
    } catch {
      // ignore; fallback to main-thread buffer
    }
  }

  const flush = async () => {
    if (!reporterState.buffer.length) return
    const payload = reporterState.buffer.splice(0, reporterState.buffer.length)
    try {
      const ok =
        'sendBeacon' in navigator &&
        navigator.sendBeacon('/synpatico/telemetry/paths', JSON.stringify(payload))
      if (!ok) {
        await fetch('/synpatico/telemetry/paths', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true,
        })
      }
    } catch {
      // swallow; next interval will retry
    }
  }

  reporterState.timerId = window.setInterval(flush, 10_000)
  const onHide = () => flush()
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHide()
  })
  addEventListener('pagehide', onHide)

  const post = (msg: TelemetryMsg) => {
    if (reporterState.worker) {
      reporterState.worker.postMessage(msg)
      return
    }
    reporterState.buffer.push(msg)
  }

  return { post }
}

let reporter = initReporter()

const shouldOptimize = (url: URLString) => {
  if (!ENABLED) return false
  if (CONFIG.exclude?.(url)) return false
  if (CONFIG.include?.(url)) return false
  
  const rate = CONFIG.sampleRate ?? 1;
  if (rate < 1 && Math.random() > rate) return false

  return true
}

const registryKey = (input: RequestInfo | URL) => {
  try {
    const u = typeof input === 'string' ? new URL(input, location.origin) : new URL(String(input))
    return u.origin + u.pathname
  } catch {
    return String(input)
  }
}

const parseJsonSafely = async (res: Response): Promise<StructurePacket | null> => {
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('application/json')) return null
  try {
    return await res.clone().json()
  } catch {
    try {
      const text = await res.clone().text()
      return JSON.parse(text)
    } catch {
      return null
    }
  }
}

const toPathString = (path: Array<string | symbol>) =>
  path.map((seg) => (typeof seg === 'symbol' ? seg.toString() : String(seg))).join('.')

const handleDecoded = async <T>(
  decoded: T,
  endpointKey: string,
  reg: RegEntry,
): Promise<T> => {
  // Wrap with tracker and attach flush function
  const inst = tracker.wrap(decoded as object)
  const proxied = inst.value as unknown as T

  Object.defineProperty(proxied as object, FLUSH_SYMBOL, {
    enumerable: false,
    configurable: true,
    value: () => {
      if (CONFIG.pathsMode === 'ordinals' && reg.pathOrdinals) {
        const ords: number[] = []
        const paths = inst.getPaths()
        for (const p of paths) {
          const k = toPathString(p)
          const idx = reg.pathOrdinals.get(k)
          if (idx !== undefined) ords.push(idx)
        }
        if (ords.length) {
          reporter.post({
            kind: 'paths-ordinals',
            structureId: reg.def.id,
            endpoint: endpointKey,
            timestamp: Date.now(),
            ordinals: ords,
          })
        }
      } else {
        const paths = inst.getPaths().map(toPathString)
        if (paths.length) {
          reporter.post({
            kind: 'paths-strings',
            structureId: reg.def.id,
            endpoint: endpointKey,
            timestamp: Date.now(),
            paths,
          })
        }
      }
      inst.clear()
    },
  })

  // microtask auto-flush (optional; keeps early reads captured)
  queueMicrotask(() => proxied[FLUSH_SYMBOL]?.())
  return proxied
}


// ------------------ Fetch patch (functional) ------------------
let fetchPatched = false

const installFetch = () => {
  if (fetchPatched) return
  fetchPatched = true

  const patchedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr= typeof input === 'string' ? input as URLString : String(input) as URLString
    const endpointKey = registryKey(input)
    const reg = registry.get(endpointKey)

    // Include Accept-ID if known
    const reqInit = { ...init }
    if (shouldOptimize(urlStr) && reg) {
      const headers = new Headers(reqInit.headers || {})
      headers.set(CONFIG.headerAccept, reg.def.id)
      reqInit.headers = headers
    }

    // Optional agent rewrite
    let finalInput: RequestInfo | URL = input
    if (CONFIG.agentBase) {
      try {
        const original = new URL(urlStr, location.origin)
        const agent = new URL(CONFIG.agentBase)
        agent.pathname = original.pathname
        agent.search = original.search
        finalInput = agent.toString()
      } catch {
        finalInput = input
      }
    }

    const res = await Native.fetch(finalInput, reqInit)
    const maybeJson = await parseJsonSafely(res)

    if (maybeJson == null) {
      return res;
    }

    // Optimized packet path
    if (maybeJson && typeof maybeJson === 'object' && maybeJson.type === 'values-only') {
      const packet = maybeJson as StructurePacket
      const useReg = reg || registry.get(endpointKey) || registry.get(packet.structureId)
      if (useReg) {
        const decoded = decode(packet, useReg.def)
        const proxied = await handleDecoded(decoded, endpointKey, useReg)
        return new Response(JSON.stringify(proxied), {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
        })
      }
      // fallback pass through if no def
      return new Response(JSON.stringify(maybeJson), {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      })
    }

    // Learning phase: cache def + (optional) ordinals
    const agentHeader = res.headers.get(CONFIG.headerAgent)
    if (agentHeader || shouldOptimize(urlStr)) {
      const def = createStructureDefinition(maybeJson)
      let ords: Map<string, number> | undefined
      if (CONFIG.pathsMode === 'ordinals') {
        const withPaths = createStructureDefinitionWithPaths(maybeJson)
        ords = new Map(withPaths.paths.map((p, i) => [p.join('.'), i]))
      }
      registry.set(endpointKey, { def, pathOrdinals: ords })
    }

    const regB = registry.get(endpointKey)
    if (!regB) {
      throw new Error()
    }
    const proxied = await handleDecoded(maybeJson, endpointKey, regB)
    return new Response(JSON.stringify(proxied), {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    })
  }

  // @ts-ignore
  globalThis.fetch = patchedFetch
}

const uninstallFetch = () => {
  if (!fetchPatched) return
  fetchPatched = false
  // @ts-ignore
  globalThis.fetch = Native.fetch
}

// ------------------ XHR patch (functional) ------------------

let xhrPatched = false

const installXHR = () => {
  if (xhrPatched || !Native.XHR) return
  xhrPatched = true

  // Track last open() URL to compute endpoint and inject header
  const open = function (
			this: XMLHttpRequest & { __syn_url__?: URLString },
			method: string,
			url: URLString,
			async = true,
			user?: string | null,
			password?: string | null,
		) {
			this.__syn_url__ = url;
			if (CONFIG.agentBase) {
				try {
					const original = new URL(url, location.origin);
					const agent = new URL(CONFIG.agentBase);
					agent.pathname = original.pathname;
					agent.search = original.search;
					this.__syn_url__ = agent.toString() as URLString;
					return Native.xhrOpen.call(
						this,
						method,
						this.__syn_url__,
						async,
						user,
						password,
					);
				} catch {
					// fall through to native with original url
				}
			}
			return Native.xhrOpen.call(this, method, url, async, user, password);
		}

  function send (
    this: XMLHttpRequest & { __syn_url__?: URLString },
    body?: Document | BodyInit | null
  ) {
    const finalUrl = this.__syn_url__ as URLString
    const key = registryKey(finalUrl || '')
    const reg = registry.get(key)
    if (reg && shouldOptimize(finalUrl)) {
      try {
        Native.xhrSetHeader.call(this, CONFIG.headerAccept, reg.def.id)
      } catch {
        // ignore
      }
    }

    // Attach a read-only listener to learn structures (best-effort)
    const onload = () => {
      try {
        const ct = this.getResponseHeader('content-type') || ''
        if (!ct.includes('application/json')) return
        const txt = this.responseText
        if (!txt) return
        const json = JSON.parse(txt)
        if (json && json.type === 'values-only') {
          // Optimized: nothing to do here; fetch path handles decoding
          return
        }
        // Learning:
        if (shouldOptimize(finalUrl)) {
          const def = createStructureDefinition(json)
          let ords: Map<string, number> | undefined
          if (CONFIG.pathsMode === 'ordinals') {
            const withPaths = createStructureDefinitionWithPaths(json)
            ords = new Map(withPaths.paths.map((p, i) => [p.join('.'), i]))
          }
          registry.set(key, { def, pathOrdinals: ords })
        }
      } catch {
        // ignore
      } finally {
        this.removeEventListener('load', onload)
      }
    }
    this.addEventListener('load', onload)

    return Native.xhrSend.call(this, body)
  }

  // Patch prototype methods
  XMLHttpRequest.prototype.open = open
  XMLHttpRequest.prototype.send = send
}

const uninstallXHR = () => {
  if (!xhrPatched || !Native.XHR) return
  xhrPatched = false
  XMLHttpRequest.prototype.open = Native.xhrOpen
  XMLHttpRequest.prototype.send = Native.xhrSend
}

// ------------------ Public API (functional) ------------------

export const configure = (cfg: Partial<MonkeyConfig>) => {
  CONFIG = { ...CONFIG, ...cfg, headerAccept: cfg.headerAccept ?? CONFIG.headerAccept, headerAgent: cfg.headerAgent ?? CONFIG.headerAgent, pathsMode: (cfg.pathsMode ?? CONFIG.pathsMode), sampleRate: cfg.sampleRate ?? CONFIG.sampleRate }
  reporter = initReporter(CONFIG)
}

export const enable = () => {
  ENABLED = true
}

export const disable = () => {
  ENABLED = false
}

export const patch = () => {
  installFetch()
  installXHR()
}

export const unpatch = () => {
  uninstallFetch()
  uninstallXHR()
}

export { FLUSH_SYMBOL }

// (optional) expose for tests/debug
export const __registry = registry
