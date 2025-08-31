// client/src/synpatico/patch.ts
import type { PatchHandle, SynpaticoClientOptions } from './types'
import { createCore } from './core'
import type { StructurePacket } from '@synpatico/core'
import { decode, createStructureDefinition } from '@synpatico/core'
import { byteLen } from './utils'

type XHROpen = typeof XMLHttpRequest.prototype.open
type XHRSend = typeof XMLHttpRequest.prototype.send

declare global {
	interface XMLHttpRequest {
		_synpaticoUrl?: string
		_synpaticoMethod?: string
	}
	interface Window {
		_synpaticoPatched?: boolean
		_synpaticoUnpatch?: () => void
	}
}

export function patchGlobals(options: SynpaticoClientOptions = {}): PatchHandle {
	if (typeof window === 'undefined') {
		// eslint-disable-next-line no-console
		console.warn('[Synpatico] patchGlobals called outside browser; ignoring.')
		return { isPatched: false, unpatch: () => {} }
	}

	const { isTargetUrl, enableLifecycle = true, lifecycle = {} } = options
	const core = createCore({ isTargetUrl, enableLifecycle, lifecycle })

	// Patch fetch
	const originalWindowFetch = window.fetch.bind(window)
	const boundFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const url = input instanceof Request ? input.url : input.toString()
		const opts = init ?? (input instanceof Request ? (input as unknown as RequestInit) : {})
		return core.fetch(url, opts as RequestInit)
	}

	// Already patched?
	if (window._synpaticoPatched) {
		return { isPatched: true, unpatch: window._synpaticoUnpatch ?? (() => {}) }
	}

	window.fetch = boundFetch

	// XHR patch
	const originalXhrOpen: XHROpen | undefined =
		typeof XMLHttpRequest !== 'undefined' ? XMLHttpRequest.prototype.open : undefined
	const originalXhrSend: XHRSend | undefined =
		typeof XMLHttpRequest !== 'undefined' ? XMLHttpRequest.prototype.send : undefined

	let restoreXhrOpen: XHROpen | undefined
	let restoreXhrSend: XHRSend | undefined

	if (originalXhrOpen && originalXhrSend) {
		restoreXhrOpen = originalXhrOpen
		restoreXhrSend = originalXhrSend

		XMLHttpRequest.prototype.open = function (
			method: string,
			url: string | URL,
			async: boolean = true,
			username?: string | null,
			password?: string | null,
		) {
			this._synpaticoUrl = url.toString()
			this._synpaticoMethod = method
			return originalXhrOpen.apply(this, [method, url, async, username, password])
		}

		XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
			try {
				const url = this._synpaticoUrl
				const method = (this._synpaticoMethod || 'GET').toUpperCase()
				const canOptimize = method === 'GET'

				if (url && (!isTargetUrl || isTargetUrl(url))) {
					try {
						// Accept-ID hint if origin+request known
						const { structureIdHint, origin } = (() => {
							try {
								const origin = new URL(url).origin
								if (canOptimize && core._knownOrigins.has(origin)) {
									const sid = core.getRegistry().requestToStructureId.get(url)
									return { structureIdHint: sid, origin }
								}
								return { origin }
							} catch {
								return {}
							}
						})()

						if (structureIdHint) {
							this.setRequestHeader('X-Synpatico-Accept-ID', structureIdHint)
						}

						const onLoad = () => {
							this.removeEventListener('load', onLoad)
							const agent = this.getResponseHeader('X-Synpatico-Agent')
							if (!agent) return

							// Mark origin as Synpatico-enabled
							if (origin) core._knownOrigins.add(origin)

							const ct = this.getResponseHeader('content-type') || ''

							try {
								if (ct.includes('application/synpatico-packet+json')) {
									const packet = JSON.parse(this.responseText) as StructurePacket
									const def = core.getRegistry().structures.get(packet.structureId)
									if (def) {
										const originalSizeHeader = this.getResponseHeader('X-Synpatico-Original-Size')
										const originalSize =
											originalSizeHeader && !Number.isNaN(Number(originalSizeHeader))
												? Number(originalSizeHeader)
												: undefined
										const compressedSize = byteLen(this.responseText)

										let decoded = decode(packet, def)

										core._lifecycle.onPacketDecoded?.({
											url,
											structureId: packet.structureId,
											originalSize,
											compressedSize,
										})

										if (typeof core._lifecycle.transformDecoded === 'function') {
											decoded = core._lifecycle.transformDecoded({
												url,
												structureId: packet.structureId,
												wasOptimized: true,
												originalSize,
												compressedSize,
												data: decoded,
											})
										}

										const str = JSON.stringify(decoded)
										Object.defineProperty(this, 'responseText', { value: str, writable: true })
										Object.defineProperty(this, 'response', { value: decoded, writable: true })
									}
								} else if (ct.includes('application/json')) {
									const data = JSON.parse(this.responseText)
									if (data && typeof data === 'object' && !Array.isArray(data)) {
										const def = createStructureDefinition(data)
										core.getRegistry().structures.set(def.id, def)
										core.getRegistry().requestToStructureId.set(url, def.id)

										core._lifecycle.onLearnedStructure?.({ url, structureId: def.id })

										let out: unknown = data
										if (typeof core._lifecycle.transformDecoded === 'function') {
											out = core._lifecycle.transformDecoded({
												url,
												structureId: def.id,
												wasOptimized: false,
												data,
											})
										}

										const str = JSON.stringify(out)
										Object.defineProperty(this, 'responseText', { value: str, writable: true })
										Object.defineProperty(this, 'response', { value: out, writable: true })
									}
								}
							} catch (err) {
								core._lifecycle.onError?.(err, { url, phase: 'decode' })
							}
						}

						this.addEventListener('load', onLoad)
					} catch (err) {
						core._lifecycle.onError?.(err, { url, phase: 'request' })
					}
				}
			} catch {
				// swallow—fallback to native behavior
			}

			return (restoreXhrSend as XHRSend).apply(this, [body])
		}
	}

	const unpatch = () => {
		window.fetch = originalWindowFetch
		if (restoreXhrOpen) XMLHttpRequest.prototype.open = restoreXhrOpen
		if (restoreXhrSend) XMLHttpRequest.prototype.send = restoreXhrSend
		window._synpaticoPatched = false
		window._synpaticoUnpatch = undefined
	}

	window._synpaticoPatched = true
	window._synpaticoUnpatch = unpatch
	// eslint-disable-next-line no-console
	console.log('[Synpatico] Patched global fetch and XMLHttpRequest.')

	return { isPatched: true, unpatch }
}

export function patchOnly(
	isTargetUrl?: (u: string) => boolean,
	lifecycle?: SynpaticoClientOptions['lifecycle'],
) {
	return patchGlobals({ isTargetUrl, lifecycle, enableLifecycle: true })
}
