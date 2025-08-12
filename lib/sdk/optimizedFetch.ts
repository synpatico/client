import type { StructureDefinition, StructurePacket } from '@synpatico/core';
import { decode } from '@synpatico/core';
import { makeProxyTracker, type TrackerInstance } from '../tracking';

type TelemetryMsg = {
  structureId: string;
  endpoint: string;
  timestamp: number;
  paths: Array<Array<string | symbol>>;
};

const tracker = makeProxyTracker();

// A shared web worker for batching (we’ll implement next)
const worker = new Worker(new URL('./usageWorker.js', import.meta.url), { type: 'module' });

export async function optimizedFetch<T = unknown>(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  structureDef: StructureDefinition,
): Promise<T> {
  const res = await fetch(input, init);
  const packet = (await res.json()) as StructurePacket;

  // Decode to a plain JS object (with your Date/Map/Set restoring)
  const decoded = decode(packet, structureDef) as T;

  // Wrap with proxy tracker
  const tracked = tracker.wrap(decoded as object) as TrackerInstance<object>;

  // Schedule usage report flush on microtask or user-triggered boundary
  queueMicrotask(() => {
    // NOTE: don’t send immediately; we only capture when app actually reads something.
    // `getPaths()` later will be empty if nothing was touched.
  });

  // Attach a lightweight handle so callers can explicitly flush if they want.
  // We don’t mutate the object; instead, return alongside.
  return new Proxy(decoded as object, {
    get(target, prop, receiver) {
      if (prop === Symbol.for('synpatico.flushUsage')) {
        return () => {
          const paths = tracked.getPaths();
          if (paths.length > 0) {
            const msg: TelemetryMsg = {
              structureId: structureDef.id,
              endpoint: typeof input === 'string' ? input : (input as URL).toString(),
              timestamp: Date.now(),
              paths,
            };
            worker.postMessage(msg);
          }
          tracked.clear();
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as T;
}
