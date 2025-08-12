// client/src/analytics-hooks/index.ts
import { getAnalytics } from "..";
import type { PropertyAccessEvent } from "../types";
import type { URLString } from "@synpatico/core";

/**
 * Thin indirection layer so app code calls small functions that we can
 * easily mock in tests, while production resolves the shared singleton.
 */

export const trackRequestEvent = (
  url: URLString,
  optimized: boolean,
  originalSize?: number,
  compressedSize?: number,
): void => {
  getAnalytics().trackRequest(url, optimized, originalSize, compressedSize);
};

const analytics = getAnalytics()

export const trackAccess = (e: PropertyAccessEvent): void => {
  analytics.trackPropertyAccess(e);
};
