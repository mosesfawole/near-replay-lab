import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  webpack(config) {
    // The shared core uses .js ESM specifiers for the compiled local runner.
    // Resolve those same specifiers to source TypeScript in the browser build.
    config.resolve ??= {};
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default config;
