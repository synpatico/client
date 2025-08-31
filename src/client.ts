import type { SynpaticoClient, SynpaticoClientOptions } from './types'
import { createCore } from './core'

export function createSynpaticoClient(options: SynpaticoClientOptions = {}): SynpaticoClient {
	const { isTargetUrl, enableLifecycle = true, lifecycle = {} } = options
	const core = createCore({ isTargetUrl, enableLifecycle, lifecycle })
	return {
		fetch: core.fetch,
		clearCache: core.clearCache,
		getRegistry: core.getRegistry,
	}
}
