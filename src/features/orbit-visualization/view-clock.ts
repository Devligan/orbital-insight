/**
 * The explorer's single simulation clock — what instant the globe shows.
 *
 * Everything on the globe (the followed satellite, its 3D model, the
 * whole-sky cloud) and the time slider read this one clock, so they can
 * never disagree. (Before it existed the slider moved only a text readout,
 * the satellite sat frozen at page-load time, and the cloud ran on its own
 * clock.)
 *
 *   simTime(wall) = baseSimMs + (wall − baseWallMs) × rate
 *
 * rate 1 = live (real time), 0 = paused at a chosen instant (slider scrub),
 * 60 = fast-forward. Pure and unit-tested; JSX-free.
 */

export interface ViewClock {
  /** Simulated instant (epoch ms) at `baseWallMs`. */
  baseSimMs: number;
  /** Wall-clock instant (epoch ms) the clock was last re-based. */
  baseWallMs: number;
  /** Simulated ms per wall ms: 0 paused, 1 real time, 60 fast-forward. */
  rate: number;
}

export const FAST_FORWARD_RATE = 60;

export function liveClock(nowMs: number): ViewClock {
  return { baseSimMs: nowMs, baseWallMs: nowMs, rate: 1 };
}

export function pausedAt(simMs: number, nowMs: number): ViewClock {
  return { baseSimMs: simMs, baseWallMs: nowMs, rate: 0 };
}

export function simTimeAt(clock: ViewClock, wallMs: number): number {
  return clock.baseSimMs + (wallMs - clock.baseWallMs) * clock.rate;
}

/** Same instant, new rate — re-based so the shown time doesn't jump. */
export function withRate(clock: ViewClock, rate: number, nowMs: number): ViewClock {
  return { baseSimMs: simTimeAt(clock, nowMs), baseWallMs: nowMs, rate };
}

/** Live = running in real time at (within a few seconds of) the real now. */
export function isLive(clock: ViewClock, nowMs: number): boolean {
  return clock.rate === 1 && Math.abs(simTimeAt(clock, nowMs) - nowMs) < 5_000;
}

/** Slider step (sample index) nearest a simulated instant, clamped to the window. */
export function sliderIndexFor(simMs: number, windowStartMs: number, stepMs: number, count: number): number {
  if (count <= 0 || stepMs <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round((simMs - windowStartMs) / stepMs)));
}

/** "+1 h 15 m" / "+40 m" / "−3 m" relative to the real now — for the readout. */
export function offsetLabel(simMs: number, nowMs: number): string {
  const minutes = Math.round((simMs - nowMs) / 60_000);
  if (minutes === 0) return "now";
  const sign = minutes > 0 ? "+" : "−";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return h > 0 ? `${sign}${h} h ${String(m).padStart(2, "0")} m` : `${sign}${m} m`;
}
