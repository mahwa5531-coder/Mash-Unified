import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["react-syntax-highlighter"],
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
