import { describe, it, expect, beforeEach, vi } from 'vitest'
import { patchGlobals } from '../src/patch'

const hasWindow = typeof window !== 'undefined'
const hasXHR = typeof XMLHttpRequest !== 'undefined'

function makeResponse(body: any, init?: ResponseInit, headers?: Record<string, string>) {
	const h = new Headers(init?.headers ?? {})
	if (headers) for (const [k, v] of Object.entries(headers)) h.set(k, v)
	return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
		...init,
		headers: h,
	})
}

;(hasWindow ? describe : describe.skip)('patchGlobals (real environment)', () => {
	const JSON_CT = 'application/json'
	const AGENT_HEADER = 'X-Synpatico-Agent'
	const url = 'https://api.example.com/things'

	beforeEach(() => {
		vi.restoreAllMocks()
		// ensure window.fetch exists (some jsdoms only polyfill global fetch)
		if (hasWindow && typeof window.fetch !== 'function') {
			// @ts-ignore
			window.fetch = globalThis.fetch?.bind(globalThis)
		}
	})

	it('patches and unpatches window.fetch', async () => {
		const JSON_CT = 'application/json'
		const AGENT_HEADER = 'X-Synpatico-Agent'
		const url = 'https://api.example.com/things'

		const globalFetch = vi.fn(
			async (_u: string, _i?: RequestInit) =>
				new Response(JSON.stringify({ ok: true }), {
					status: 200,
					headers: { 'content-type': JSON_CT, [AGENT_HEADER]: '1' },
				}),
		)
		vi.stubGlobal('fetch', globalFetch as unknown as typeof fetch)

		// Capture both refs
		const originalFetch = window.fetch
		const originalFetchBound = window.fetch.bind(window) // what patchGlobals will store/restore

		const { patchGlobals } = await import('../src/patch')
		const handle = patchGlobals({
			isTargetUrl: (u) => u.includes('api.example.com'),
			enableLifecycle: true,
		})

		expect(handle.isPatched).toBe(true)
		expect(window.fetch).not.toBe(originalFetch)

		const res = await window.fetch(url)
		const json = await res.json()
		expect(json).toEqual({ ok: true })

		handle.unpatch()

		// Compare to the bound snapshot (matches what patch restores)
		// eslint-disable-next-line @typescript-eslint/unbound-method
		expect(window.fetch.toString()).toBe(originalFetchBound.toString())
		// And confirm it still works:
		const res2 = await window.fetch(url)
		const json2 = await res2.json()
		expect(json2).toEqual({ ok: true })
	})

	it('patch works alongside an explicit non-patching client', async () => {
		const globalFetch = vi.fn(async (_u: string, _i?: RequestInit) =>
			makeResponse({ a: 1 }, { status: 200 }, { 'content-type': JSON_CT, [AGENT_HEADER]: '1' }),
		)
		vi.stubGlobal('fetch', globalFetch as unknown as typeof fetch)

		const handle = patchGlobals({
			isTargetUrl: (u) => u.includes('api.example.com'),
			enableLifecycle: true,
			lifecycle: {
				transformDecoded: ({ data }) => ({ ...(data as object), via: 'client' }),
			},
		})

		// window.fetch goes through our core, so transformDecoded applies
		const r1 = await window.fetch('https://api.example.com/a')
		const j1 = await r1.json()
		expect(j1).toEqual({ a: 1, via: 'client' })

		// explicit client should behave the same
		const { createSynpaticoClient } = await import('../src/client')
		const client = createSynpaticoClient({
			isTargetUrl: (u) => u.includes('api.example.com'),
			enableLifecycle: true,
			lifecycle: {
				transformDecoded: ({ data }) => ({ ...(data as object), via: 'client' }),
			},
		})
		const r2 = await client.fetch('https://api.example.com/b')
		const j2 = await r2.json()
		expect(j2).toEqual({ a: 1, via: 'client' })

		handle.unpatch()
	})
})
