// Ensure window exists (jsdom) and provide window.fetch if it's missing.
if (typeof window !== 'undefined' && typeof window.fetch !== 'function') {
	// Bind from global fetch (Node 18+/Vitest provides undici fetch on globalThis)
	// @ts-ignore
	if (typeof globalThis.fetch === 'function') {
		// @ts-ignore
		window.fetch = globalThis.fetch.bind(globalThis)
	}
}

// Only stub XHR if the environment truly doesn't provide it (jsdom usually does).
if (typeof XMLHttpRequest === 'undefined') {
	class XHRStub {
		open(
			_method: string,
			_url: string,
			_async = true,
			_username?: string | null,
			_password?: string | null,
		) {}
		send(_body?: Document | XMLHttpRequestBodyInit | null) {}
		setRequestHeader(_k: string, _v: string) {}
		addEventListener(_type: string, _listener: EventListenerOrEventListenerObject) {}
		removeEventListener(_type: string, _listener: EventListenerOrEventListenerObject) {}
		getResponseHeader(_name: string): string | null {
			return null
		}
	}
	// @ts-ignore
	globalThis.XMLHttpRequest = XHRStub as any
}
