import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  turbopack: {},
  typescript: {
    // Note: TypeScript verification is enforced via 'tsc --noEmit' in the build script
    // to bypass the known Windows Next.js worker crash (exit code 3221226505).
    ignoreBuildErrors: true,
  },
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
