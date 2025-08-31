import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createSynpaticoClient } from '../src/client'
import { createStructureDefinition, decode, encode } from '@synpatico/core'

const AGENT_HEADER = 'X-Synpatico-Agent'
const JSON_CT = 'application/json'
const PACKET_CT = 'application/synpatico-packet+json'

// Small helper to create a Response with headers.
function makeResponse(body: any, init?: ResponseInit, headers?: Record<string, string>) {
	const h = new Headers(init?.headers ?? {})
	if (headers) for (const [k, v] of Object.entries(headers)) h.set(k, v)
	return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
		...init,
		headers: h,
	})
}

describe('Synpatico core (using real @synpatico/core)', () => {
	const url = 'https://api.example.com/users?limit=5'

	beforeEach(() => {
		vi.restoreAllMocks()
	})

	it('learns a structure from JSON + agent header, and applies transformDecoded', async () => {
		const learned: Array<{ url: string; structureId: string }> = []
		const transformed: any[] = []

		// First call returns JSON with agent header ⇒ learning path.
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_u: string, _i?: RequestInit) =>
				makeResponse({ a: 1 }, { status: 200 }, { 'content-type': JSON_CT, [AGENT_HEADER]: '1' }),
			) as unknown as typeof fetch,
		)

		const client = createSynpaticoClient({
			isTargetUrl: (u) => u.startsWith('https://api.example.com'),
			enableLifecycle: true,
			lifecycle: {
				onLearnedStructure: (ctx) => learned.push(ctx),
				transformDecoded: ({ data, url, structureId, wasOptimized }) => {
					const out = { ...(data as object), __meta: { url, structureId, wasOptimized } }
					transformed.push(out)
					return out
				},
			},
		})

		const res = await client.fetch(url)
		const json = await res.json()

		expect(learned.length).toBe(1)
		expect(learned[0].url).toBe(url)
		expect(typeof learned[0].structureId).toBe('string')

		expect(json).toEqual({
			a: 1,
			__meta: {
				url,
				structureId: learned[0].structureId,
				wasOptimized: false,
			},
		})
	})

	it('adds X-Synpatico-Accept-ID on subsequent GET when origin is known and URL is mapped', async () => {
		const calls: Array<{ u: string; headers: Record<string, string> }> = []

		vi.stubGlobal(
			'fetch',
			vi.fn(async (u: string, init?: RequestInit) => {
				calls.push({
					u,
					headers: Object.fromEntries(new Headers(init?.headers).entries()),
				})
				// Always return JSON with the agent header (keeps origin "synpatico-aware")
				return makeResponse(
					{ ok: true },
					{ status: 200 },
					{ 'content-type': JSON_CT, [AGENT_HEADER]: '1' },
				)
			}) as unknown as typeof fetch,
		)

		const client = createSynpaticoClient({
			isTargetUrl: (u) => u.includes('api.example.com'),
			enableLifecycle: true,
		})

		// 1st call: no Accept-ID expected; it will learn and mark origin known.
		await client.fetch(url)

		// 2nd call: should include X-Synpatico-Accept-ID
		const res2 = await client.fetch(url)
		await res2.json()

		const headers2 = calls[1].headers
		const hint = headers2['X-Synpatico-Accept-ID'] || headers2['x-synpatico-accept-id']
		expect(typeof hint).toBe('string')
		expect(hint!.length).toBeGreaterThan(0)
	})

	it('retries once without the X-Synpatico-Accept-ID header on 409', async () => {
		const url = 'https://api.example.com/users?limit=5'
		const AGENT_HEADER = 'X-Synpatico-Agent'
		const JSON_CT = 'application/json'

		const calls: Array<{ headers: string[] }> = []

		// Our mock fetch:
		// 1) First call: learning response (JSON + agent) so the client maps the URL and marks origin known.
		// 2) Second call (attempt 1 for the same URL): client sends Accept-ID -> we return 409
		// 3) Second call (retry attempt 2): no Accept-ID -> we return 200 JSON
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_u: string, init?: RequestInit) => {
				const headerKeys = [...new Headers(init?.headers).keys()].map((k) => k.toLowerCase())
				calls.push({ headers: headerKeys })

				// call #1: learn
				if (calls.length === 1) {
					return new Response(JSON.stringify({ learned: true }), {
						status: 200,
						headers: {
							'content-type': JSON_CT,
							[AGENT_HEADER]: '1',
						},
					})
				}

				// call #2: should include Accept-ID -> conflict
				if (calls.length === 2) {
					return new Response('', {
						status: 409,
						headers: { [AGENT_HEADER]: '1' },
					})
				}

				// call #3: retry without Accept-ID -> success
				return new Response(JSON.stringify({ ok: true }), {
					status: 200,
					headers: {
						'content-type': JSON_CT,
						[AGENT_HEADER]: '1',
					},
				})
			}) as unknown as typeof fetch,
		)

		const { createSynpaticoClient } = await import('../src/client')

		const client = createSynpaticoClient({
			isTargetUrl: () => true,
			enableLifecycle: true,
		})

		// 1) learning call
		await (await client.fetch(url)).json()

		// 2) now the client will add Accept-ID automatically; on 409 it should auto-retry
		const res = await client.fetch(url)
		const json = await res.json()
		expect(json).toEqual({ ok: true })

		// Ensure the second attempt had Accept-ID and the retry removed it
		expect(calls[1].headers).toContain('x-synpatico-accept-id')
		expect(calls[2].headers).not.toContain('x-synpatico-accept-id')
	})

	it('non-synpatico origin is pass-through (no learning, no transformation)', async () => {
		const fetchSpy = vi.fn(async (_u: string, _i?: RequestInit) =>
			makeResponse(
				{ raw: true },
				{ status: 200 },
				{ 'content-type': JSON_CT /* note: no agent header */ },
			),
		)
		vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch)

		const client = createSynpaticoClient({
			isTargetUrl: () => true,
			enableLifecycle: true,
			lifecycle: {
				onLearnedStructure: () => {
					throw new Error('should not learn from non-agent response')
				},
				transformDecoded: () => {
					throw new Error('should not transform on non-agent response')
				},
			},
		})

		const res = await client.fetch('https://other.example.com/anything')
		const json = await res.json()
		expect(json).toEqual({ raw: true })
	})

	// ---------- Optional packet decode test ----------
	// Runs only if you can produce a valid StructurePacket for decode().
	// If your server/core lib provides an encoder, import it here and remove the skip.
	it.skip('decodes an optimized packet using real decode (enable when encoder is available)', async () => {
		// Example (pseudo):

		// const def = createStructureDefinition({ a: 1 })
		// const packet = encode({ a: 2 }, def) // produces a valid StructurePacket
		// vi.stubGlobal(
		// 	'fetch',
		// 	vi.fn(async () =>
		// 		makeResponse(
		// 			packet,
		// 			{ status: 200 },
		// 			{
		// 				'content-type': PACKET_CT,
		// 				[AGENT_HEADER]: '1',
		// 				'X-Synpatico-Original-Size': '123',
		// 			},
		// 		),
		// 	) as unknown as typeof fetch,
		// )

		// const client = createSynpaticoClient({ isTargetUrl: () => true })
		// const res = await client.fetch(url)
		// expect(await res.json()).toEqual({ a: 2 })
		//
		// Note: If you wire this up, also ensure the URL had previously learned/registered `def.id`
		// or the client will re-fetch unoptimized by design.
		expect(decode).toBeDefined()
		expect(createStructureDefinition).toBeDefined()
	})
})
