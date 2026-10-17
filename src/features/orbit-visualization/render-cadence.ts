/**
 * How often the globe redraws for the passage of time — pure, JSX-free,
 * unit-tested.
 *
 * The globe renders on demand (Cesium `requestRenderMode`): camera input
 * redraws by itself; the clock redraws once simulated time has moved
 * `simSecondsPerRedraw` seconds. That step is sized so the fastest common
 * object (low Earth orbit, ~7.8 km/s) moves under a pixel per redraw at the
 * current zoom — no visible stepping, and no redraws nobody could see:
 *
 *   whole-Earth view, live  → about one redraw every 2 s
 *   whole-Earth view, 60×   → ~25 redraws/s
 *   zoomed in close         → up to 30 redraws/s
 *
 * (Before: a fixed ~7 clock redraws/s plus ~7 more for whole-sky batches,
 * whether or not anything had visibly moved — a laptop's main thread spent
 * a quarter of its time redrawing an unchanged picture.)
 */

/** Fastest common motion on the globe: low-Earth-orbit speed, m/s. */
const LEO_SPEED_M_PER_S = 7_800;
/** Largest jump a moving dot may make between redraws, screen pixels. */
const MAX_JUMP_PX = 0.75;
/** Clock-driven redraw ceiling, per wall second (camera input is separate). */
const MAX_REDRAWS_PER_WALL_SECOND = 30;
/** Clock-driven redraw floor: at least one every this many wall seconds. */
const MAX_WALL_SECONDS_PER_REDRAW = 2;
/** Nearest a low-orbit object plausibly is to the camera, m (low camera heights). */
const MIN_VIEW_DISTANCE_M = 300_000;

/** Size of one screen pixel at `distanceM` from a perspective camera. */
export function metersPerPixelAt(distanceM: number, fovyRad: number, canvasHeightPx: number): number {
  const distance = Math.max(distanceM, MIN_VIEW_DISTANCE_M);
  return (2 * distance * Math.tan(fovyRad / 2)) / Math.max(canvasHeightPx, 1);
}

/** Simulated seconds between clock-driven redraws (Cesium `maximumRenderTimeChange`). */
export function simSecondsPerRedraw(metersPerPixel: number, rate: number): number {
  const r = Math.max(rate, 1);
  const smooth = (MAX_JUMP_PX * metersPerPixel) / LEO_SPEED_M_PER_S;
  return Math.min(Math.max(smooth, r / MAX_REDRAWS_PER_WALL_SECOND), r * MAX_WALL_SECONDS_PER_REDRAW);
}

/**
 * Whole-sky dots move at most this often per wall second. Moving all ~10.6k
 * costs the main thread several milliseconds; zoomed in (or following a
 * satellite) the camera redraws every frame, and moving every dot every
 * frame took ~70% of a laptop's main thread. The followed satellite itself
 * still moves every redraw.
 */
const MAX_CLOUD_UPDATES_PER_WALL_SECOND = 10;

/** Screen angle of one pixel, radians (pixel size per metre of distance). */
export function pixelAngle(fovyRad: number, canvasHeightPx: number): number {
  return (2 * Math.tan(fovyRad / 2)) / Math.max(canvasHeightPx, 1);
}

/** Smallest on-screen move worth re-uploading a whole-sky dot for, pixels. */
const MIN_DOT_MOVE_PX = 0.5;

/**
 * Whether a dot that moved √moveSq metres, √distanceSq metres from the
 * camera, shifts by at least half a pixel. Close up (following a satellite)
 * most of the sky is thousands of km away and barely moves on screen;
 * skipping those dots keeps the update to the ones you can see move.
 */
export function dotMoveVisible(moveSq: number, distanceSq: number, pixelAngleRad: number): boolean {
  const minMove = MIN_DOT_MOVE_PX * pixelAngleRad;
  return moveSq >= minMove * minMove * distanceSq;
}

/** Simulated seconds between whole-sky dot updates, given the redraw step. */
export function simSecondsPerCloudUpdate(redrawStepSeconds: number, rate: number): number {
  return Math.max(redrawStepSeconds, Math.max(rate, 1) / MAX_CLOUD_UPDATES_PER_WALL_SECOND);
}
