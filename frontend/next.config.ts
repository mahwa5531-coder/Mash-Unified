import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  turbopack: {},
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
