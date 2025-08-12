import {
  affectedToPathList,
  createProxy,
  markToTrack,
} from './proxy'

export type Path = Array<string | symbol>

export type TrackerInstance<T extends object> = {
  value: T;                   // the proxied object you give back to app code
  getPaths(): Path[];         // collect what was read
  clear(): void;              // release references after reporting
}

export type Tracker = {
  wrap<T extends object>(value: T): TrackerInstance<T>
  markToTrack(obj: object, mark?: boolean): void
}

export function makeProxyTracker(): Tracker {
  return {
    wrap<T extends object>(value: T): TrackerInstance<T> {
      const affected = new WeakMap<object, unknown>();
      const proxied = createProxy(value, affected);
      let released = false;

      return {
        value: proxied,
        getPaths(): Path[] {
          if (released) return [];
          return affectedToPathList(proxied, affected, true);
        },
        clear() {
          released = true;
        },
      }
    },
    markToTrack,
  }
}
