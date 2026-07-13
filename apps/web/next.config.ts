import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@company-brain/ui', '@company-brain/types'],
  eslint: {
    // Linting runs via `pnpm lint` (shared flat config), not next build.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
