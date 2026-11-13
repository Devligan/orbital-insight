/**
 * Stand-in for `@spz-loader/core` in the client bundle.
 *
 * Cesium 1.146 imports it to decode Gaussian-splat (SPZ) 3D Tiles. The
 * package embeds an Emscripten WASM binary in a JS string that Next's
 * minifier re-emits as a template literal containing `\0`+digit sequences -
 * an octal escape, which is a SyntaxError in template literals. The whole
 * lazy globe chunk then fails to parse and the 3D view never starts.
 *
 * This app never loads splat tilesets, so the decoder is aliased away
 * (next.config.ts). If that ever changes, this throws instead of failing
 * silently.
 */
export function loadSpz(): never {
  throw new Error("SPZ (Gaussian splat) decoding is not bundled in Orbital Insight");
}
