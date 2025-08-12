import type { URLString } from "@synpatico/core"

export type TransportMode = "noop" | "fetch"
export type EventKind = "request" | "property_access"

export interface AnalyticsInitOptions {
  enabled?: boolean
  endpoint?: string              // where to POST batches (e.g. /synpatico/metrics)
  batchIntervalMs?: number       // default 2000
  maxBatchSize?: number          // default 500
  useWorker?: boolean            // default true
  transport?: TransportMode      // default "noop" unless endpoint provided
  onBatch?: <T = unknown>(toBatch?: T) => void
  flushIntervalMs?: number
}

export interface AnalyticsMetrics {
  totalRequests: number
  optimizedRequests: number
  bandwidthSaved: number
  propertyAccesses: Map<string, number>
}

export interface RequestEvent {
  kind: EventKind
  url: URLString
  wasOptimized: boolean
  originalSize?: number
  compressedSize?: number
  timestamp: number
}

export interface PropertyAccessEvent<A = void, B = void> {
  kind: EventKind
  url: URLString
  structureId: string
  propertyPath: string   // e.g. "data.users[0].id" or "support.url[has]"
  dataType: string | number | object | Array<A> | boolean | bigint | symbol | Date | Map<A, B> | Set<A>
  depth: number
  wasOptimized: boolean
  originalSize?: number
  compressedSize?: number
  timestamp: number
}

export type AnalyticsEvent = RequestEvent | PropertyAccessEvent

export interface MetricsSnapshot {
  totalRequests: number
  optimizedRequests: number
  bandwidthSaved: number // sum(original - compressed) where available & optimized
  propertyAccesses: Map<string, number> // path -> count
}

export interface WorkerEnvelope {
  type: "init" | "events" | "flush" | "metrics" | "reset"
  payload?: unknown
}

export interface AnalyticsAPI {
  init: (opts?: AnalyticsInitOptions) => void
  isEnabled: () => boolean
  setEnabled: (on: boolean) => void
  trackPropertyAccess: (e: PropertyAccessEvent) => void
  trackRequest: (
    url: URLString,
    optimized: boolean,
    originalSize?: number,
    compressedSize?: number,
  ) => void
  getMetrics: () => AnalyticsMetrics
  reset: () => void
  flushNow: () => void
}