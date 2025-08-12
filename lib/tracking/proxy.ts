import { createProxy, affectedToPathList, markToTrack } from 'proxy-compare'
export { createProxy, affectedToPathList, markToTrack } 

export type Tracker = {
	wrap<T extends object>(value: T): { value: T; getPaths(): (string | symbol)[][] }
}

export function makeProxyTracker(): Tracker {
	return {
		wrap<T extends object>(value: T) {
			const affected = new WeakMap<object, unknown>()
			const proxied = createProxy(value, affected)
			return {
				value: proxied,
				getPaths: () => affectedToPathList(proxied, affected, true),
			}
		},
	}
};
