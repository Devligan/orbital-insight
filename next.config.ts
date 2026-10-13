import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // CesiumJS ships large CommonJS worker bundles that must stay unbundled.
  serverExternalPackages: ["@cesium/engine"],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        // Keep Cesium out of the server bundle graph entirely.
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
