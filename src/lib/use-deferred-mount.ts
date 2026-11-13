"use client";

/**
 * Mount heavy content only once it is substantially on screen and the
 * browser has a moment to spare.
 *
 * Measured on the home page (production build, 4× CPU throttle): starting
 * the ~1.3 MB Cesium globe at load froze a phone's main thread for ~2.4–3.8 s
 * - exactly when people tap "Show me tonight's passes". On phones only the
 * globe's top edge peeks into the first screen, so "near the viewport" is
 * not enough: it starts once `visibleFraction` of it is visible (the user
 * scrolled to it), then waits for idle. On desktop the globe is fully in
 * view, so it still starts within a moment of load.
 */

import { useEffect, useState, type RefObject } from "react";

export function useDeferredMount(
  ref: RefObject<Element | null>,
  // 0.75: a phone's first screen shows ~40% of the globe's top edge, and 0.4
  // still let Cesium start there (tap → response measured at 4.4 s).
  { visibleFraction = 0.75, idleTimeoutMs = 1_500 }: { visibleFraction?: number; idleTimeoutMs?: number } = {},
): boolean {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (mounted || !element) return;

    let cancelIdle: (() => void) | null = null;
    const startWhenIdle = () => {
      if (typeof window.requestIdleCallback === "function") {
        const handle = window.requestIdleCallback(() => setMounted(true), { timeout: idleTimeoutMs });
        cancelIdle = () => window.cancelIdleCallback(handle);
      } else {
        const handle = window.setTimeout(() => setMounted(true), 200);
        cancelIdle = () => window.clearTimeout(handle);
      }
    };

    if (typeof IntersectionObserver !== "function") {
      startWhenIdle();
      return () => cancelIdle?.();
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= visibleFraction - 0.01)) {
          observer.disconnect();
          startWhenIdle();
        }
      },
      { threshold: [visibleFraction] },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelIdle?.();
    };
  }, [ref, mounted, visibleFraction, idleTimeoutMs]);

  return mounted;
}
