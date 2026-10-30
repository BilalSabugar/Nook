import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Avoid Windows junction creation issues under Turbopack while preserving container packaging
  serverExternalPackages: process.platform === 'win32' ? [] : ["playwright"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
