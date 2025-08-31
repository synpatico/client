import type { ClientRegistry } from '@synpatico/core'

export type IsTargetUrl = (url: string) => boolean

export interface LifecycleHooks {
	onInit?: (ctx: { enabled: boolean }) => void
	beforeRequest?: (ctx: {
		url: string
		method: string
		headers: Headers
		init: RequestInit
		wasOptimized: boolean
		structureIdHint?: string
	}) => void
	afterResponse?: (ctx: {
		url: string
		method: string
		response: Response
		wasOptimized: boolean
	}) => void
	transformDecoded?: (ctx: {
		url: string
		structureId?: string
		wasOptimized: boolean
		originalSize?: number
		compressedSize?: number
		data: unknown
	}) => unknown
	onPacketDecoded?: (ctx: {
		url: string
		structureId: string
		originalSize?: number
		compressedSize: number
	}) => void
	onLearnedStructure?: (ctx: { url: string; structureId: string }) => void
	onError?: (
		err: unknown,
		ctx: { url?: string; phase: 'request' | 'response' | 'decode' | 'learn' },
	) => void
}

export interface SynpaticoClientOptions {
	isTargetUrl?: IsTargetUrl
	enableLifecycle?: boolean
	lifecycle?: LifecycleHooks
}

export interface SynpaticoClient {
	fetch: (url: string | URL, options?: RequestInit) => Promise<Response>
	clearCache: () => void
	getRegistry: () => Readonly<ClientRegistry>
}

export interface PatchHandle {
	readonly isPatched: boolean
	unpatch: () => void
}
