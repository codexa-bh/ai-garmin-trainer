import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Load the rasterizer from node_modules at runtime (one Wasm singleton) and
  // ship its Wasm file, which the renderer reads instead of importing.
  serverExternalPackages: ["@resvg/resvg-wasm"],
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/@resvg/resvg-wasm/index_bg.wasm"],
  },
  experimental: {},
};

export default nextConfig;
