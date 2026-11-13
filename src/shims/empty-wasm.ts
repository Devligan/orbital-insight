/**
 * Stands in for satellite.js's bundled WASM builds (aliased in
 * next.config.ts). The app propagates with the JavaScript SGP4 path, and the
 * inlined WASM string once minified into invalid JavaScript in production.
 */
const noWasmModule = null;

export default noWasmModule;
