// client/src/proxy.ts
/**
 * Synpatico Proxy Factory
 * Creates proxies that track property access for usage analytics
 */

import { trackAccess } from "../lib/analytics/analytics-hooks";
import type { PropertyAccessEvent } from "../lib/analytics/types";
import type { URLString } from "@synpatico/core";

export interface ProxyContext {
  url: string;
  structureId: string;
  wasOptimized: boolean;
  originalSize?: number;
  compressedSize?: number;
  rootPath?: string;
}

export interface ProxyOptions {
  trackArrayAccess?: boolean;
  trackMethodCalls?: boolean;
  maxDepth?: number;
  excludePaths?: string[];
}

const DEFAULT_OPTIONS: Required<ProxyOptions> = {
  trackArrayAccess: true,
  trackMethodCalls: false,
  maxDepth: 10,
  excludePaths: ["constructor", "prototype", "__proto__", "valueOf", "toString"],
};

/**
 * Creates a proxy that tracks property access and sends analytics
 */
export function createTrackingProxy<T extends object>(
  target: T,
  context: ProxyContext,
  options: ProxyOptions = {},
  currentPath = "",
  depth = 0,
): T {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (depth > opts.maxDepth) return target;
  if (typeof target !== "object" || target === null) return target;
  if (target instanceof Date || target instanceof RegExp || target instanceof Error) return target;

  const fullPath = currentPath
    ? context.rootPath
      ? `${context.rootPath}.${currentPath}`
      : currentPath
    : context.rootPath || "";

  return new Proxy(target, {
    get(obj: T, prop: string | symbol): unknown {
      if (typeof prop === "symbol" || opts.excludePaths.includes(prop.toString())) {
        return Reflect.get(obj, prop);
      }

      const propertyPath = fullPath ? `${fullPath}.${prop.toString()}` : prop.toString();
      const value = Reflect.get(obj, prop);

      const event: PropertyAccessEvent = {
        kind: "property_access",
        url: context.url as URLString,
        structureId: context.structureId,
        propertyPath,
        timestamp: Date.now(),
        depth,
        dataType: Array.isArray(value) ? "array" : typeof value,
        wasOptimized: context.wasOptimized,
        originalSize: context.originalSize,
        compressedSize: context.compressedSize,
      };

      trackAccess(event);

      if (typeof value === "object" && value !== null) {
        if (Array.isArray(value)) {
          if (opts.trackArrayAccess) {
            return createTrackingProxy(value, context, options, propertyPath, depth + 1);
          }
          return value;
        }

        if (value.constructor === Object || value.constructor === undefined) {
          return createTrackingProxy(value, context, options, propertyPath, depth + 1);
        }
      }

      return value;
    },

    set(obj: T, prop: string | symbol, value: unknown): boolean {
      if (typeof prop !== "symbol") {
        const propertyPath = fullPath ? `${fullPath}.${prop.toString()}` : prop.toString();
        const event: PropertyAccessEvent = {
          kind: "property_access",
          url: context.url as URLString,
          structureId: context.structureId,
          propertyPath: `${propertyPath}[write]`,
          timestamp: Date.now(),
          depth,
          dataType: "write",
          wasOptimized: context.wasOptimized,
          originalSize: context.originalSize,
          compressedSize: context.compressedSize,
        };

        trackAccess(event);
      }

      return Reflect.set(obj, prop, value);
    },

    has(obj: T, prop: string | symbol): boolean {
      if (typeof prop !== "symbol") {
        const propertyPath = fullPath ? `${fullPath}.${prop.toString()}` : prop.toString();
        const event: PropertyAccessEvent = {
          kind: "property_access",
          url: context.url as URLString,
          structureId: context.structureId,
          propertyPath: `${propertyPath}[has]`,
          timestamp: Date.now(),
          depth,
          dataType: "has",
          wasOptimized: context.wasOptimized,
          originalSize: context.originalSize,
          compressedSize: context.compressedSize,
        };

        trackAccess(event);
      }

      return Reflect.has(obj, prop);
    },

    ownKeys(obj: T): ArrayLike<string | symbol> {
      const event: PropertyAccessEvent = {
        kind: "property_access",
        url: context.url as URLString,
        structureId: context.structureId,
        propertyPath: `${fullPath}[keys]`,
        timestamp: Date.now(),
        depth,
        dataType: "keys",
        wasOptimized: context.wasOptimized,
        originalSize: context.originalSize,
        compressedSize: context.compressedSize,
      };

      trackAccess(event);

      return Reflect.ownKeys(obj);
    },

    getOwnPropertyDescriptor(obj: T, prop: string | symbol): PropertyDescriptor | undefined {
      if (typeof prop !== "symbol") {
        const propertyPath = fullPath ? `${fullPath}.${prop.toString()}` : prop.toString();
        const event: PropertyAccessEvent = {
          kind: "property_access",
          url: context.url as URLString,
          structureId: context.structureId,
          propertyPath: `${propertyPath}[descriptor]`,
          timestamp: Date.now(),
          depth,
          dataType: "descriptor",
          wasOptimized: context.wasOptimized,
          originalSize: context.originalSize,
          compressedSize: context.compressedSize,
        };

        trackAccess(event);
      }

      return Reflect.getOwnPropertyDescriptor(obj, prop);
    },
  });
}

/**
 * Creates a proxy with optimized settings for API responses
 */
export function createApiResponseProxy<T extends object>(
  target: T,
  context: ProxyContext,
  options: ProxyOptions = {},
): T {
  const apiOptions: ProxyOptions = {
    trackArrayAccess: true,
    trackMethodCalls: false,
    maxDepth: 5,
    excludePaths: [
      "constructor",
      "prototype",
      "__proto__",
      "valueOf",
      "toString",
      "toJSON",
      "hasOwnProperty",
      "isPrototypeOf",
      "propertyIsEnumerable",
    ],
    ...options,
  };

  return createTrackingProxy(target, context, apiOptions);
}

/**
 * Utility to check if an object is already proxied (best-effort heuristic)
 */
export function isProxied(obj: unknown): boolean {
  try {
    return (
      typeof obj === "object" &&
      obj !== null &&
      Object.hasOwn(obj, "__synpatico_proxied")
    );
  } catch {
    return false;
  }
}

/**
 * Marks an object as proxied to avoid double-proxying
 */
export function markAsProxied(obj: object): void {
  try {
    Object.defineProperty(obj, "__synpatico_proxied", {
      value: true,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  } catch {
    // Ignore if cannot define
  }
}
