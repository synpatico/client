// client/src/index.ts
/**
 * Synpatico Client SDK (Analytics-Decoupled)
 * ------------------------------------------
 * - Focuses on GET request optimization for MVP.
 * - Always returns a `Response` object (compat with existing code).
 * - Handles streaming safely by re-wrapping decoded payloads.
 * - Provides cooperative XHR patch.
 * - Analytics decoupled via ./analytics-hooks (optional + mockable).
 */

import {
  createStructureDefinition,
  decode,
  type ClientRegistry,
  type StructureDefinition,
  type StructurePacket,
  type URLString,
} from "@synpatico/core";
import { createApiResponseProxy, type ProxyContext, type ProxyOptions } from "./proxy";
import { trackRequestEvent } from "../lib/analytics/analytics-hooks";
import { getAnalytics } from "../lib/analytics";
import type { AnalyticsInitOptions } from "../lib/analytics/types";

// Augment the XMLHttpRequest interface to store our custom state.
declare global {
  interface XMLHttpRequest {
    _synpaticoUrl?: string;
    _synpaticoMethod?: string;
  }
}

export interface SynpaticoClientOptions {
  isTargetUrl?: (url: string) => boolean;
  enableAnalytics?: boolean;
  proxyOptions?: ProxyOptions;
  analyticsOptions?: AnalyticsInitOptions;
}

export interface SynpaticoClient {
  fetch: (url: string | URL, options?: RequestInit) => Promise<Response>;
  patchGlobal: () => void;
  clearCache: () => void;
}

/**
 * Factory function to create a new Synpatico client instance.
 */
export function createSynpaticoClient(options: SynpaticoClientOptions = {}): SynpaticoClient {
  const { isTargetUrl, enableAnalytics = true, proxyOptions = {}, analyticsOptions } = options;

  if (enableAnalytics) {
    getAnalytics().init({
      enabled: true,
      ...analyticsOptions,
    });
  }

  const registry: ClientRegistry = {
    structures: new Map<string, StructureDefinition>(),
    patterns: new Map(),
    requestToStructureId: new Map<string, string>(),
  };

  const knownSynpaticoOrigins = new Set<string>();
  let isPatched = false;

  const originalFetch: typeof fetch =
    typeof window !== "undefined" && window.fetch ? window.fetch : fetch;

  const originalXhrOpen =
    typeof XMLHttpRequest !== "undefined" ? XMLHttpRequest.prototype.open : undefined;
  const originalXhrSend =
    typeof XMLHttpRequest !== "undefined" ? XMLHttpRequest.prototype.send : undefined;

  /**
   * The main fetch wrapper function. Always returns a `Response`.
   */
  async function synpaticoFetch(url: string | URL, fetchOptions: RequestInit = {}): Promise<Response> {
    const urlString = url.toString();

    if (isTargetUrl && !isTargetUrl(urlString)) {
      return originalFetch(url, fetchOptions);
    }

    const method = (fetchOptions.method || "GET").toUpperCase();
    const canOptimize = method === "GET";

    const enhancedOptions: RequestInit = { ...fetchOptions };
    const headers = new Headers(enhancedOptions.headers);
    let wasOptimizedRequest = false;

    // If we already know the origin and structureId, hint it.
    try {
      const origin = new URL(urlString).origin;
      if (canOptimize && knownSynpaticoOrigins.has(origin)) {
        const knownStructureId = registry.requestToStructureId.get(urlString);
        if (knownStructureId) {
          headers.set("X-Synpatico-Accept-ID", knownStructureId);
          wasOptimizedRequest = true;
        }
      }
    } catch {
      // ignore invalid URL formats
    }

    enhancedOptions.headers = headers;

    const response = await originalFetch(urlString, enhancedOptions);

    // Retry once without optimization on 409.
    if (response.status === 409 && wasOptimizedRequest) {
      const headersNoOpt = new Headers(fetchOptions.headers);
      headersNoOpt.delete("X-Synpatico-Accept-ID");
      const retryOptions: RequestInit = { ...fetchOptions, headers: headersNoOpt };
      return originalFetch(urlString, retryOptions);
    }

    // Not a Synpatico origin → pass through.
    if (!response.headers.has("X-Synpatico-Agent")) {
      return response;
    }

    // Mark origin as Synpatico-enabled
    try {
      const origin = new URL(urlString).origin;
      knownSynpaticoOrigins.add(origin);
    } catch { /* noop */ }

    const contentType = response.headers.get("content-type") || "";

    // Optimized packet path
    if (contentType.includes("application/synpatico-packet+json")) {
      const responseText = await response.text();
      const packet = JSON.parse(responseText) as StructurePacket;
      const structureDef = registry.structures.get(packet.structureId);

      if (!structureDef) {
        // Unknown structure; re-request without optimization.
        return originalFetch(urlString, fetchOptions);
      }

      // analytics: record request
      const compressedSize = byteLen(responseText);
      const originalSizeHeader = response.headers.get("X-Synpatico-Original-Size");
      const originalSize =
        originalSizeHeader && !Number.isNaN(Number(originalSizeHeader))
          ? Number(originalSizeHeader)
          : undefined;
      trackRequestEvent(urlString as URLString, true, originalSize, compressedSize);

      // Decode; optionally wrap with property-tracking proxy
      let decodedData = decode(packet, structureDef);
      if (enableAnalytics && typeof decodedData === "object" && decodedData !== null) {
        const ctx: ProxyContext = {
          url: urlString,
          structureId: packet.structureId,
          wasOptimized: true,
          originalSize,
          compressedSize,
        };
        decodedData = createApiResponseProxy(decodedData as object, ctx, proxyOptions);
      }

      const newHeaders = new Headers(response.headers);
      newHeaders.set("Content-Type", "application/json");
      return new Response(JSON.stringify(decodedData), {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }

    // Learning path (JSON response)
    if (contentType.includes("application/json")) {
      const clone = response.clone();
      try {
        const data = await clone.json();
        if (isPlainObject(data)) {
          const structureDef = createStructureDefinition(data);
          registry.structures.set(structureDef.id, structureDef);
          registry.requestToStructureId.set(urlString, structureDef.id);

          // analytics: learning request
          trackRequestEvent(urlString as URLString, false);

          // If analytics enabled, return proxied data for property tracking
          if (enableAnalytics) {
            const ctx: ProxyContext = {
              url: urlString,
              structureId: structureDef.id,
              wasOptimized: false,
            };
            const proxiedData = createApiResponseProxy(data, ctx, proxyOptions);
            const newHeaders = new Headers(response.headers);
            newHeaders.set("Content-Type", "application/json");
            return new Response(JSON.stringify(proxiedData), {
              status: response.status,
              statusText: response.statusText,
              headers: newHeaders,
            });
          }
        }
      } catch {
        // fall through
      }
    }

    return response;
  }

  /**
   * Monkey-patch `window.fetch` and XHR cooperatively.
   */
  function patchGlobal(): void {
    if (isPatched || typeof window === "undefined") return;
    isPatched = true;
    // eslint-disable-next-line no-console
    console.log("[Synpatico] Patching global fetch and XMLHttpRequest.");

    // Patch fetch
    const boundFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input instanceof Request ? input.url : input.toString();
      const options = init ?? (input instanceof Request ? (input as unknown as RequestInit) : {});
      return synpaticoFetch(url, options as RequestInit);
    };
    window.fetch = boundFetch;

    // Patch XHR if available
    if (originalXhrOpen && originalXhrSend) {
      XMLHttpRequest.prototype.open = function (
        method: string,
        url: string | URL,
        async: boolean = true,
        username?: string | null,
        password?: string | null,
      ) {
        this._synpaticoUrl = url.toString();
        this._synpaticoMethod = method;
        return originalXhrOpen.apply(this, [method, url, async, username, password]);
      };

      XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
        const url = this._synpaticoUrl;
        const method = (this._synpaticoMethod || "GET").toUpperCase();
        const canOptimize = method === "GET";

        if (url && (!isTargetUrl || isTargetUrl(url))) {
          try {
            const origin = new URL(url).origin;

            if (canOptimize && knownSynpaticoOrigins.has(origin)) {
              const knownStructureId = registry.requestToStructureId.get(url);
              if (knownStructureId) {
                this.setRequestHeader("X-Synpatico-Accept-ID", knownStructureId);
              }
            }

            const onLoad = () => {
              this.removeEventListener("load", onLoad);

              const agentHeader = this.getResponseHeader("X-Synpatico-Agent");
              if (!agentHeader) return;

              knownSynpaticoOrigins.add(origin);

              const ct = this.getResponseHeader("content-type") || "";

              try {
                if (ct.includes("application/synpatico-packet+json")) {
                  const packet = JSON.parse(this.responseText) as StructurePacket;
                  const def = registry.structures.get(packet.structureId);
                  if (def) {
                    const originalSizeHeader = this.getResponseHeader("X-Synpatico-Original-Size");
                    const originalSize =
                      originalSizeHeader && !Number.isNaN(Number(originalSizeHeader))
                        ? Number(originalSizeHeader)
                        : undefined;
                    const compressedSize = byteLen(this.responseText);
                    trackRequestEvent(url as URLString, true, originalSize, compressedSize);

                    let decoded = decode(packet, def);
                    if (enableAnalytics && typeof decoded === "object" && decoded !== null) {
                      const ctx: ProxyContext = {
                        url,
                        structureId: packet.structureId,
                        wasOptimized: true,
                        originalSize,
                        compressedSize,
                      };
                      decoded = createApiResponseProxy(decoded as object, ctx, proxyOptions);
                    }

                    const str = JSON.stringify(decoded);
                    Object.defineProperty(this, "responseText", { value: str, writable: true });
                    Object.defineProperty(this, "response", { value: decoded, writable: true });
                  }
                } else if (ct.includes("application/json")) {
                  const data = JSON.parse(this.responseText);
                  if (isPlainObject(data)) {
                    const def = createStructureDefinition(data);
                    registry.structures.set(def.id, def);
                    registry.requestToStructureId.set(url, def.id);

                    trackRequestEvent(url as URLString, false);

                    if (enableAnalytics) {
                      const ctx: ProxyContext = {
                        url,
                        structureId: def.id,
                        wasOptimized: false,
                      };
                      const proxied = createApiResponseProxy(data, ctx, proxyOptions);
                      const str = JSON.stringify(proxied);
                      Object.defineProperty(this, "responseText", { value: str, writable: true });
                      Object.defineProperty(this, "response", { value: proxied, writable: true });
                    }
                  }
                }
              } catch {
                // ignore decode/parsing failure
              }
            };

            this.addEventListener("load", onLoad);
          } catch {
            // ignore URL parse or header errors
          }
        }

        return originalXhrSend.apply(this, [body]);
      };
    }
  }

  return {
    fetch: synpaticoFetch,
    patchGlobal,
    clearCache: () => {
      registry.structures.clear();
      registry.requestToStructureId.clear();
      knownSynpaticoOrigins.clear();
      // eslint-disable-next-line no-console
      console.log("[Synpatico] Cache cleared.");
    },
  };
}

/* --------------------------------- helpers -------------------------------- */

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function byteLen(s: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(s).length;
  }
  try {
    return Buffer.byteLength(s);
  } catch {
    return s.length;
  }
}
