import {
	createStructureDefinition,
	decode,
	type ClientRegistry,
	type StructurePacket,
} from '@synpatico/core'
import { createRegistry } from './registry'
import { isPlainObject, byteLen } from './utils'
import type { LifecycleHooks, IsTargetUrl } from './types'

export function createCore(options: {
	isTargetUrl?: IsTargetUrl
	enableLifecycle: boolean
	lifecycle: LifecycleHooks
}) {
	const { isTargetUrl, enableLifecycle, lifecycle } = options

	const registry = createRegistry()
	const knownSynpaticoOrigins = new Set<string>()
	const originalFetch: typeof fetch =
		typeof window !== 'undefined' && typeof window.fetch === 'function'
			? window.fetch.bind(window)
			: fetch

	lifecycle.onInit?.({ enabled: !!enableLifecycle })

	function acceptIdHint(urlString: string, canOptimize: boolean) {
		try {
			const origin = new URL(urlString).origin
			if (canOptimize && knownSynpaticoOrigins.has(origin)) {
				const sid = registry.requestToStructureId.get(urlString)
				return { structureIdHint: sid, origin }
			}
			return { origin }
		} catch {
			return {}
		}
	}

	function markOrigin(urlString: string) {
		try {
			const origin = new URL(urlString).origin
			knownSynpaticoOrigins.add(origin)
		} catch {}
	}

	async function handleOptimizedPacketResponse(
		resp: Response,
		urlString: string,
	): Promise<Response> {
		const text = await resp.text()
		let packet: StructurePacket
		try {
			packet = JSON.parse(text) as StructurePacket
		} catch (err) {
			lifecycle.onError?.(err, { url: urlString, phase: 'decode' })
			return originalFetch(urlString, {})
		}

		const def = registry.structures.get(packet.structureId)
		if (!def) return originalFetch(urlString, {})

		const compressedSize = byteLen(text)
		const originalSizeHeader = resp.headers.get('X-Synpatico-Original-Size')
		const originalSize =
			originalSizeHeader && !Number.isNaN(Number(originalSizeHeader))
				? Number(originalSizeHeader)
				: undefined

		try {
			let decoded = decode(packet, def)

			lifecycle.onPacketDecoded?.({
				url: urlString,
				structureId: packet.structureId,
				originalSize,
				compressedSize,
			})

			if (typeof lifecycle.transformDecoded === 'function') {
				decoded = lifecycle.transformDecoded({
					url: urlString,
					structureId: packet.structureId,
					wasOptimized: true,
					originalSize,
					compressedSize,
					data: decoded,
				})
			}

			const headers = new Headers(resp.headers)
			headers.set('Content-Type', 'application/json')
			return new Response(JSON.stringify(decoded), {
				status: resp.status,
				statusText: resp.statusText,
				headers,
			})
		} catch (err) {
			lifecycle.onError?.(err, { url: urlString, phase: 'decode' })
			return originalFetch(urlString, {})
		}
	}

	async function learnFromJsonResponse(resp: Response, urlString: string): Promise<Response> {
		const clone = resp.clone()
		try {
			const data = await clone.json()
			if (isPlainObject(data)) {
				const def = createStructureDefinition(data)
				registry.structures.set(def.id, def)
				registry.requestToStructureId.set(urlString, def.id)
				lifecycle.onLearnedStructure?.({ url: urlString, structureId: def.id })

				let out: unknown = data
				if (typeof lifecycle.transformDecoded === 'function') {
					out = lifecycle.transformDecoded({
						url: urlString,
						structureId: def.id,
						wasOptimized: false,
						data,
					})
				}

				const headers = new Headers(resp.headers)
				headers.set('Content-Type', 'application/json')
				return new Response(JSON.stringify(out), {
					status: resp.status,
					statusText: resp.statusText,
					headers,
				})
			}
		} catch {
			// not json; fall through
		}
		return resp
	}

	async function synpaticoFetch(url: string | URL, init: RequestInit = {}): Promise<Response> {
		const urlString = url.toString()
		const method = (init.method || 'GET').toUpperCase()
		const canOptimize = method === 'GET'

		if (isTargetUrl && !isTargetUrl(urlString)) {
			return originalFetch(urlString, init)
		}

		const enhanced: RequestInit = { ...init }
		const headers = new Headers(enhanced.headers)

		let wasOptimized = false
		const { structureIdHint } = acceptIdHint(urlString, canOptimize)
		if (structureIdHint) {
			headers.set('X-Synpatico-Accept-ID', structureIdHint)
			wasOptimized = true
		}

		if (enableLifecycle) {
			try {
				lifecycle.beforeRequest?.({
					url: urlString,
					method,
					headers,
					init: enhanced,
					wasOptimized,
					structureIdHint,
				})
			} catch (err) {
				lifecycle.onError?.(err, { url: urlString, phase: 'request' })
			}
		}

		enhanced.headers = headers
		const resp = await originalFetch(urlString, enhanced)

		if (enableLifecycle) {
			try {
				lifecycle.afterResponse?.({
					url: urlString,
					method,
					response: resp,
					wasOptimized,
				})
			} catch (err) {
				lifecycle.onError?.(err, { url: urlString, phase: 'response' })
			}
		}

		if (resp.status === 409 && wasOptimized) {
			const headersNoOpt = new Headers(init.headers)
			headersNoOpt.delete('X-Synpatico-Accept-ID')
			const retryInit: RequestInit = { ...init, headers: headersNoOpt }
			return originalFetch(urlString, retryInit)
		}

		if (!resp.headers.has('X-Synpatico-Agent')) {
			return resp
		}

		markOrigin(urlString)

		const ct = resp.headers.get('content-type') || ''
		if (ct.includes('application/synpatico-packet+json')) {
			return handleOptimizedPacketResponse(resp, urlString)
		}
		if (ct.includes('application/json')) {
			return learnFromJsonResponse(resp, urlString)
		}
		return resp
	}

	function clearCache() {
		registry.structures.clear()
		registry.requestToStructureId.clear()
		knownSynpaticoOrigins.clear()
		// eslint-disable-next-line no-console
		console.log('[Synpatico] Cache cleared.')
	}

	return {
		fetch: synpaticoFetch,
		clearCache,
		getRegistry: () => registry as Readonly<ClientRegistry>,
		_knownOrigins: knownSynpaticoOrigins,
		_originalFetch: originalFetch,
		_lifecycle: lifecycle,
	}
}

export type Core = ReturnType<typeof createCore>
