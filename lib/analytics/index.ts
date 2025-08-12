// client/lib/analytics/index.ts
import type { URLString } from "@synpatico/core";
import type {
  AnalyticsAPI,
  AnalyticsInitOptions,
  AnalyticsMetrics,
  PropertyAccessEvent,
} from "./types";

/**
 * Functional analytics singleton (no classes).
 * Holds simple counters and a batched event sink for property-access events.
 */
function createAnalytics(): AnalyticsAPI {
  let enabled = true;

  const metrics: AnalyticsMetrics = {
    totalRequests: 0,
    optimizedRequests: 0,
    bandwidthSaved: 0,
    propertyAccesses: new Map<string, number>(),
  };

  let batch: PropertyAccessEvent[] = [];
  let onBatch: AnalyticsInitOptions["onBatch"] | undefined;
  let flushIntervalMs = 2000;
  let maxBatchSize = 200;
  let timer: ReturnType<typeof setInterval> | null = null;

  const flushNow = () => {
    if (!enabled) { batch = []; return; }
    if (batch.length === 0) return;
    const toSend = batch;
    batch = [];
    onBatch?.(toSend);
  };

  const startTimer = () => { if (!timer) timer = setInterval(flushNow, flushIntervalMs); };
  const stopTimer  = () => { if (timer) { clearInterval(timer); timer = null; } };

  const init = (opts?: AnalyticsInitOptions) => {
    if (!opts) return;
    if (typeof opts.enabled === "boolean") enabled = opts.enabled;
    if (typeof opts.flushIntervalMs === "number" && opts.flushIntervalMs > 0) {
      flushIntervalMs = opts.flushIntervalMs;
      if (timer) { stopTimer(); startTimer(); }
    }
    if (typeof opts.maxBatchSize === "number" && opts.maxBatchSize > 0) {
      maxBatchSize = opts.maxBatchSize;
    }
    if (opts.onBatch) onBatch = opts.onBatch;
    if (enabled) startTimer(); else stopTimer();
  };

  const isEnabled = () => enabled;
  const setEnabled = (on: boolean) => { enabled = on; if (on) startTimer(); else stopTimer(); };

  const trackAccess = (e: PropertyAccessEvent) => {
    if (!enabled) return;
    const current = metrics.propertyAccesses.get(e.propertyPath) || 0;
    metrics.propertyAccesses.set(e.propertyPath, current + 1);
    batch.push(e);
    if (batch.length >= maxBatchSize) flushNow();
  };

  const trackRequest = (
    _url: URLString,
    optimized: boolean,
    originalSize?: number,
    compressedSize?: number,
  ) => {
    if (!enabled) return;
    metrics.totalRequests += 1;
    if (optimized) {
      metrics.optimizedRequests += 1;
      if (
        typeof originalSize === "number" &&
        typeof compressedSize === "number" &&
        originalSize >= 0 &&
        compressedSize >= 0
      ) {
        metrics.bandwidthSaved += Math.max(0, originalSize - compressedSize);
      }
    }
  };

  const getMetrics = (): AnalyticsMetrics => metrics;

  const reset = () => {
    metrics.totalRequests = 0;
    metrics.optimizedRequests = 0;
    metrics.bandwidthSaved = 0;
    metrics.propertyAccesses.clear();
    batch = [];
  };

  return {
    init,
    isEnabled,
    setEnabled,
    trackPropertyAccess: trackAccess,
    trackRequest,
    getMetrics,
    reset,
    flushNow,
  };
}

// Singleton instance and accessor (keep both for convenience)
const singleton = createAnalytics();

export const getAnalytics = (): AnalyticsAPI => singleton;
export const analytics = singleton;

export * from "./types";
