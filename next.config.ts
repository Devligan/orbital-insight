import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Opt-in separate output for production verification: `next dev` shares
  // `.next` and overwrites a production build mid-run (the source of the
  // "no production build" / "Cannot find module './887.js'" errors). Gate
  // runs set NEXT_DIST_DIR=.next-prod; everything else keeps the default.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // CesiumJS ships large CommonJS worker bundles that must stay unbundled.
  serverExternalPackages: ["@cesium/engine"],
  // The whole-sky route reads the deployment's own catalog snapshot from disk
  // (src/server/sky-catalog.ts); file tracing can't see a runtime path.
  outputFileTracingIncludes: {
    "/api/sky/catalog": ["./data/sky-catalog.snapshot.json"],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        // Keep Cesium out of the server bundle graph entirely.
      };
      // satellite.js v7 re-exports an optional WASM/pthreads runtime that
      // would statically reference `node:worker_threads`; the pure-JS SGP4
      // the sky worker actually uses never executes that path. Alias the
      // WASM entry points to an inert stub so the worker chunk compiles
      // without the Node-only module in the graph.
      config.resolve.alias = {
        ...config.resolve.alias,
        "#wasm-single-thread": path.resolve(__dirname, "src/shims/empty-wasm.ts"),
        "#wasm-multi-thread": path.resolve(__dirname, "src/shims/empty-wasm.ts"),
        // Cesium's Gaussian-splat decoder: its embedded WASM string minifies
        // into invalid JS and breaks the whole globe chunk. Unused here.
        "@spz-loader/core": path.resolve(__dirname, "src/shims/no-spz-loader.ts"),
      };
    }
    return config;
  },
  eslint: {
    // Lint is a separate explicit step (`npm run lint`).
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
