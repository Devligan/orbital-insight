/**
 * Unit bridge between our position samples and Cesium. JSX-free and tested.
 *
 * Our samples carry Earth-fixed positions in **kilometres** (sample-types.ts);
 * Cesium's Cartesian3 is in **metres**. Passing the km values straight
 * through once placed the followed satellite, its orbit line, and its 3D
 * model ~6.8 km from the centre of the Earth - invisible, for as long as the
 * globe existed.
 */

export const METERS_PER_KM = 1_000;

export function ecfKmToMeters(ecf: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return { x: ecf.x * METERS_PER_KM, y: ecf.y * METERS_PER_KM, z: ecf.z * METERS_PER_KM };
}
