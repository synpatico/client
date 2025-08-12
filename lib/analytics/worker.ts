/// <reference lib="webworker" />
import type {
  AnalyticsEvent,
  AnalyticsInitOptions,
  MetricsSnapshot,
  WorkerEnvelope,
} from "./types";

declare const self: DedicatedWorkerGlobalScope;

let enabled = true;
let endpoint = "";
let batchIntervalMs = 2000;
let maxBatchSize = 500;
let transport: "noop" | "fetch" = "noop";

let buffer: AnalyticsEvent[] = [];
let timer: number | undefined;

const metrics: MetricsSnapshot = {
  totalRequests: 0,
  optimizedRequests: 0,
  bandwidthSaved: 0,
  propertyAccesses: new Map(),
};

function schedule() {
  if (timer !== undefined) return;
  timer = self.setTimeout(flush, batchIntervalMs) as unknown as number;
}

function record(e: AnalyticsEvent) {
  // metrics aggregation
  if (e.kind === "request") {
    metrics.totalRequests += 1;
    if (e.wasOptimized) {
      metrics.optimizedRequests += 1;
      if (typeof e.originalSize === "number" && typeof e.compressedSize === "number") {
        const delta = Math.max(0, e.originalSize - e.compressedSize);
        metrics.bandwidthSaved += delta;
      }
    }
  } else if (e.kind === "property_access") {
    const key = e.propertyPath;
    metrics.propertyAccesses.set(key, (metrics.propertyAccesses.get(key) ?? 0) + 1);
  }

  buffer.push(e);
  if (buffer.length >= maxBatchSize) {
    flush();
  } else {
    schedule();
  }
}

async function flush() {
  if (!enabled || buffer.length === 0) {
    clearTimer();
    return;
  }

  const toSend = buffer;
  buffer = [];

  try {
    if (transport === "fetch" && endpoint) {
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: toSend }),
        keepalive: true,
      });
    }
  } catch {
    // swallow errors; keep analytics fire-and-forget
  } finally {
    clearTimer();
  }
}

function clearTimer() {
  if (timer !== undefined) {
    self.clearTimeout(timer);
    timer = undefined;
  }
}

function reset() {
  buffer = [];
  metrics.totalRequests = 0;
  metrics.optimizedRequests = 0;
  metrics.bandwidthSaved = 0;
  metrics.propertyAccesses.clear();
}

self.onmessage = (evt: MessageEvent<WorkerEnvelope>) => {
  const { type, payload } = evt.data || {};
  switch (type) {
    case "init": {
      const opts = (payload ?? {}) as AnalyticsInitOptions;
      enabled = opts.enabled ?? true;
      endpoint = opts.endpoint ?? "";
      batchIntervalMs = opts.batchIntervalMs ?? 2000;
      maxBatchSize = opts.maxBatchSize ?? 500;
      transport = opts.transport ?? (endpoint ? "fetch" : "noop");
      return;
    }
    case "events": {
      if (!enabled) return;
      const events = (payload as AnalyticsEvent[]) || [];
      for (const e of events) record(e);
      return;
    }
    case "flush":
      void flush();
      return;
    case "metrics": {
      // send a shallow copy of metrics (Map -> array)
      const snapshot = {
        totalRequests: metrics.totalRequests,
        optimizedRequests: metrics.optimizedRequests,
        bandwidthSaved: metrics.bandwidthSaved,
        propertyAccesses: Array.from(metrics.propertyAccesses.entries()),
      };
      self.postMessage({ type: "metrics", payload: snapshot });
      return;
    }
    case "reset":
      reset();
      return;
  }
};
