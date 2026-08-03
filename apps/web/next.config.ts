import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// A stray package-lock.json in the home dir makes Next infer the wrong workspace
// root, which degrades dev Fast Refresh (edits stop hot-applying). Pin the root
// to the monorepo so file-watching tracks this repo, not the home directory.
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: repoRoot,
  transpilePackages: ['@company-brain/ui', '@company-brain/types'],
  eslint: {
    // Linting runs via `pnpm lint` (shared flat config), not next build.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
