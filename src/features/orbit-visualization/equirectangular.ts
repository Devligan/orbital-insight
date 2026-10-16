/**
 * Equirectangular projection for the 2D ground-track plot's SVG space.
 * JSX-free so the geometry is unit-tested on its own.
 */

/** SVG viewBox width; longitude −180…180° spans it. */
export const PLOT_WIDTH = 720;
/** Vertical inset so polar track points aren't clipped by the frame. */
export const PLOT_LAT_MARGIN = 8;

/**
 * x linear in longitude (−180° at the left edge), y linear in latitude with
 * north at the top. (An earlier version measured y from the south pole and
 * drew the whole map upside down, labels included.)
 */
export function projectEquirectangular(latitudeDeg: number, longitudeDeg: number, height: number): { x: number; y: number } {
  const usable = height - 2 * PLOT_LAT_MARGIN;
  return {
    x: ((longitudeDeg + 180) / 360) * PLOT_WIDTH,
    y: PLOT_LAT_MARGIN + ((90 - latitudeDeg) / 180) * usable,
  };
}
