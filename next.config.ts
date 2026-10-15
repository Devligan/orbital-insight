import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // CesiumJS ships large CommonJS worker bundles that must stay unbundled.
  serverExternalPackages: ["@cesium/engine"],
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
