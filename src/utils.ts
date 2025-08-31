export function isPlainObject(x: unknown): x is Record<string, unknown> {
	return typeof x === 'object' && x !== null && !Array.isArray(x)
}

export function byteLen(s: string): number {
	if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length
	try {
		const g: any = globalThis as any
		if (g.Buffer?.byteLength) return g.Buffer.byteLength(s)
	} catch {}
	return s.length
}
